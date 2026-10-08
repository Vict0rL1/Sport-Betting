"""Respuestas REALES de la API sobre el paquete de casos extremos, para los tests
del frontend (ítem 0.5).

Los componentes del frontend se prueban con lo que de verdad les manda el
backend, no con objetos escritos a mano que se desactualizan solos. Este módulo
levanta la app con el servicio falso, recorre unos escenarios con el reloj
congelado y guarda cada respuesta bajo la URL exacta que pide el cliente:

    frontend/src/test/fixtures/<escenario>.json  →  {"rutas": {url: {"status", "json"}}}

    python -m tests.fixtures.exportar_frontend            # escribe
    python -m tests.fixtures.exportar_frontend --comprobar  # ¿están al día?

`tests/test_fixtures_frontend.py` falla si los ficheros no coinciden con lo que
produce el backend hoy: un cambio de texto en el backend obliga a reexportar en
el mismo commit, y el frontend se prueba siempre contra la versión vigente.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

# Se ASIGNA, como en conftest.py: con DATABASE_PATH exportado en la shell, un
# `setdefault` dejaría al motor conectado a la base de verdad.
os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(prefix="export-"), "export.db")

import time_machine  # noqa: E402

from tests.fakes_empresa import trimestre  # noqa: E402
from tests.fixtures import extremos as ex  # noqa: E402
from tests.fixtures.servicio_pantallas import ServicioPantallas  # noqa: E402
from tests.golden import motor  # noqa: E402

DESTINO = Path(__file__).resolve().parents[3] / "frontend" / "src" / "test" / "fixtures"
MAX_SENALES = 12


def _sesion():
    from app.db.engine import get_session
    from app.main import app

    return next(app.dependency_overrides[get_session]())


def _pedir(c, rutas: dict, url: str) -> dict:
    r = c.get(url)
    rutas[url] = {"status": r.status_code, "json": r.json()}
    return rutas[url]["json"]


def _empresa(caso: str, cartera: str, con_historia: bool) -> dict:
    from app import expectativas as seg

    # Con las respuestas completas que piden las pantallas (frescura, velas…),
    # sin inventar nada que el paquete no defina.
    sv, symbol = ex.montar_empresa(caso, ServicioPantallas(ex.AHORA))
    rutas: dict = {}
    with motor._cliente(sv) as c:
        with _sesion() as s:
            ex.montar_cartera(cartera, s, sv)
            if con_historia:
                ex.tesis_con_punto(s, symbol)
        if con_historia:
            # Un análisis de hace dos meses; entre medias baja el precio,
            # desaparece la puntuación y sale un trimestre con el margen por
            # debajo del umbral de la tesis.
            antes = ex.AHORA - timedelta(days=60)
            sv.ahora = antes  # lo que el servicio falso fecha (cotización, calendario) es de entonces
            sv.quotes[symbol]["as_of"] = antes.isoformat()
            with time_machine.travel(antes, tick=False):
                c.get(f"/api/empresa/{symbol}/analisis")
                with _sesion() as s:
                    e = seg.crear_evento(s, symbol, "earnings", periodo="2026-Q2", fecha_prevista="2026-07-30",
                                         ahora=antes)
                    sv.calendario = [{"symbol": symbol, "date": "2026-07-30", "eps_estimate": 0.5,
                                      "revenue_estimate": 300.0, "eps_actual": None, "revenue_actual": None}]
                    seg.capturar(s, sv, e, antes)
            sv.ahora = ex.AHORA
            sv.quotes[symbol].update(price=92.0, as_of=ex.AHORA.isoformat())
            sv.cache.set("daily_picks", {"v": 6, "market": "us_sp500"}, {"signals": [], "as_of": ex.AHORA.isoformat()})
            sv.financials[symbol]["quarters"].append(
                trimestre(2026, 2, "2026-07-30", revenue=310.0, operating_income=310.0 * 0.12, gross_profit=124.0,
                          net_income=31.0, eps_diluted=0.051, cfo=40.0, capex=15.0))
            with _sesion() as s:
                seg.registrar_reales(s, sv, s.get(type(e), e.id), ex.AHORA)
        _pedir(c, rutas, f"/api/empresa/{symbol}/analisis")
        historial = _pedir(c, rutas, f"/api/empresa/{symbol}/historial")
        for d in historial.get("decisiones") or []:
            _pedir(c, rutas, f"/api/snapshots/{d['id']}/replay")
        _pedir(c, rutas, f"/api/empresa/{symbol}/calidad")
        eventos = _pedir(c, rutas, f"/api/expectativas/eventos?symbol={symbol}")
        for e in eventos.get("eventos") or []:
            _pedir(c, rutas, f"/api/expectativas/eventos/{e['id']}")
        _pedir(c, rutas, f"/api/expectativas/calibracion?symbol={symbol}")
        _pedir(c, rutas, "/api/portfolio/contribucion?descargar=false")
        _pedir(c, rutas, "/api/portfolio/efectivo")
        # La cabecera de la ficha, el informe, la valoración y la cartera: lo que
        # pinta el test de fugas además de las secciones de arriba.
        for url in (f"/api/stocks/{symbol}/quote", f"/api/stocks/{symbol}/profile",
                    f"/api/stocks/{symbol}/fundamentals", f"/api/stocks/{symbol}/history?range=1Y",
                    "/api/meta/llm", f"/api/deep-dive/{symbol}?history_years=10",
                    f"/api/stocks/{symbol}/valuation/defaults", "/api/portfolio",
                    "/api/portfolio/historial?descargar=false"):
            _pedir(c, rutas, url)
    return {"symbol": symbol, "rutas": rutas}


def _hoy(caso: str, con_cartera: bool = False) -> dict:
    rutas: dict = {}
    with motor._cliente(ex.servicio_lista(caso)) as c:
        if con_cartera:
            with _sesion() as s:
                ex.sembrar_cartera_lista(s)
        _pedir(c, rutas, "/api/signals/markets")
        for url in ("/api/signals/today?market=us_sp500", "/api/signals/today?market=us_sp500&refresh=true"):
            d = _pedir(c, rutas, url)
            # Las 502 filas pesan ~1 MB: se guardan las de la lista corta y las primeras.
            corta = {i["symbol"] for i in (d.get("shortlist") or {}).get("ideas") or []}
            d["signals"] = [x for x in d["signals"] if x["symbol"] in corta] + \
                [x for x in d["signals"] if x["symbol"] not in corta][:MAX_SENALES]
    return {"rutas": rutas}


ESCENARIOS = {
    "empresa_completa": lambda: _empresa("completa", "una_posicion", con_historia=True),
    "empresa_vacia": lambda: _empresa("todo_ausente", "vacia", con_historia=False),
    "empresa_deuda_parcial": lambda: _empresa("deuda_parcial", "fx_invertido", con_historia=False),
    "hoy_completo": lambda: _hoy("dia_completo_502"),
    "hoy_sin_candidatas": lambda: _hoy("dia_sin_candidatas", con_cartera=True),
}


def exportar() -> dict[str, str]:
    salida = {}
    with motor.reloj_fijo():
        for nombre, f in ESCENARIOS.items():
            salida[nombre] = json.dumps(f(), ensure_ascii=False, sort_keys=True, indent=1) + "\n"
    return salida


def main(argv: list[str]) -> int:
    import logging

    logging.disable(logging.WARNING)
    textos = exportar()
    if "--comprobar" in argv:
        malos = [n for n, t in textos.items()
                 if not (DESTINO / f"{n}.json").exists() or (DESTINO / f"{n}.json").read_text(encoding="utf-8") != t]
        print("desactualizados:", malos or "ninguno")
        return 1 if malos else 0
    DESTINO.mkdir(parents=True, exist_ok=True)
    for n, t in textos.items():
        (DESTINO / f"{n}.json").write_text(t, encoding="utf-8")
        print(f"escrito {n}.json ({len(t) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
