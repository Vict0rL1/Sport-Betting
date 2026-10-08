"""La app real sobre datos ficticios, para capturas de pantalla (ítem 0.6).

    python -m tests.fixtures.servidor_demo --escenario normal --puerto 8000

Arranca el backend de verdad (FastAPI) con el servicio de datos falso del
paquete de casos extremos y una base TEMPORAL — nunca `backend/data/app.db`.
Lo usa `frontend/scripts/capturas.ts`, que levanta uno por escenario.

Escenarios:

- `normal`: una cartera con una posición en dólares, otra en dólares canadienses
  y otra con el stop perforado; ACME con dos análisis (hace dos meses y hoy) y un
  evento de resultados; la lista diaria del S&P 500 con candidatas.
- `cartera_vacia`: sin posiciones ni efectivo.
- `sin_candidatas`: la lista diaria sin ninguna compra, con cartera.
- `empresa_sin_datos`: lo mismo que `normal`; la captura abre VACIA.
- `con_ia`: lo mismo que `normal` con un proveedor de IA de demostración (el
  contenido generado se ve en violeta, con su modelo y su aviso).

Todo es inventado: ninguna cifra es de una empresa real.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import tempfile
from datetime import timedelta

_BASE = tempfile.mkdtemp(prefix="demo-")
os.environ["DATABASE_PATH"] = os.path.join(_BASE, "demo.db")

import time_machine  # noqa: E402

from app.llm.base import LLMProvider  # noqa: E402
from app.providers.base import DataNotFoundError  # noqa: E402
from tests.fakes_empresa import trimestre  # noqa: E402
from tests.fixtures import extremos as ex  # noqa: E402
from tests.fixtures.servicio_pantallas import ServicioPantallas  # noqa: E402

ESCENARIOS = ("normal", "cartera_vacia", "sin_candidatas", "empresa_sin_datos", "con_ia")


class ServicioDemo(ServicioPantallas):
    """El servicio de las pantallas, completado para que TODAS tengan algo que
    enseñar: cotizaciones y fundamentales para símbolos que el paquete no
    conoce (los del screener, los ETF), series de FRED, noticias generales y la
    lista diaria entera.

    `ausentes`: empresas del paquete que existen para enseñar el estado «sin un
    solo dato». Para ellas no se inventa nada: antes la captura de VACIA salía
    con precio 254 y PER 34 inventados, y el estado vacío no se veía nunca."""

    def __init__(self, lista: ex.ServicioLista, ausentes: frozenset[str] = frozenset()):
        super().__init__(ex.AHORA)
        self.lista = lista
        self.ausentes = ausentes

    @staticmethod
    def _semilla(texto: str) -> int:
        return sum(ord(c) * (i + 1) for i, c in enumerate(texto))

    def get(self, tipo, **kw):
        symbol = kw.get("symbol")
        if tipo == "bulk_momentum":
            return self.lista.get(tipo, **kw)
        if symbol in self.ausentes:
            return super().get(tipo, **kw)
        if tipo == "fundamentals" and symbol not in self.fundamentales:
            return self.lista.get(tipo, **kw)
        if tipo == "quote" and symbol not in self.quotes:
            precio = 20.0 + self._semilla(symbol) % 400
            self.quotes[symbol] = {"symbol": symbol, "price": precio, "currency": "USD", "source": "finnhub",
                                   "as_of": self.ahora.isoformat(), "estado": "valido",
                                   "change_pct": (self._semilla(symbol) % 7 - 3) / 2}
        if tipo == "profile" and symbol not in self.quotes:
            self.get("quote", symbol=symbol)
        if tipo == "macro" and kw.get("series_id") not in self.macro:
            return self._macro(kw["series_id"])
        if tipo == "news" and symbol is None:
            return {"items": [{"headline": f"Titular de demostración {i}", "summary": "Texto ficticio.",
                               "published_at": (self.ahora - timedelta(hours=3 * i)).isoformat(),
                               "url": f"https://example.com/demo/{i}", "source": "Demo", "symbol": "ACME"}
                              for i in range(1, 6)], "source": "finnhub", "as_of": self.ahora.isoformat()}
        return super().get(tipo, **kw)

    def _macro(self, serie: str) -> dict:
        base = {"UNRATE": 4.1, "FEDFUNDS": 4.33, "CPIAUCSL": 320.0, "T10Y2Y": 0.35}.get(serie)
        if base is None and serie.startswith("DGS"):
            plazo = serie[3:]
            base = {"1MO": 4.6, "3MO": 4.5, "6MO": 4.4, "1": 4.2, "2": 4.0, "5": 3.9, "10": 4.2, "30": 4.5}.get(plazo, 4.0)
        if base is None:
            raise DataNotFoundError(f"sin serie {serie}")
        hoy = self.ahora.date()
        crece = serie == "CPIAUCSL"
        puntos = [{"ts": (hoy - timedelta(days=d)).isoformat(),
                   "value": round(base * (1 - 0.03 * d / 365) if crece else base + 0.05 * math.sin(d / 20), 3)}
                  for d in range(400, 0, -1)]
        return {"series_id": serie, "points": puntos, "source": "fred", "as_of": self.ahora.isoformat()}


class IADemo(LLMProvider):
    """Proveedor de IA de demostración: texto fijo, marcado como generado."""

    name = "demo"

    def interpret(self, system: str, prompt: str) -> dict:
        return {"content": "**Lectura de demostración.** Este párrafo lo genera un proveedor de IA ficticio "
                           "para enseñar cómo se marca el contenido generado: en violeta, con el modelo y su aviso.",
                "model": "modelo-de-demostracion"}

    def contar_tokens(self, system: str, prompt: str) -> int | None:
        return 1200


def _historia_acme(session_factory, sv: ServicioDemo) -> None:
    """Dos análisis de ACME (hace dos meses y hoy) con cambios materiales entre medias."""
    from app import expectativas as seg
    from app.routers.empresa import analizar_y_congelar

    antes = ex.AHORA - timedelta(days=60)
    with session_factory() as s:
        ex.tesis_con_punto(s, "ACME")
    sv.ahora = antes
    sv.quotes["ACME"]["as_of"] = antes.isoformat()
    with time_machine.travel(antes, tick=False), session_factory() as s:
        analizar_y_congelar("ACME", sv, s, ahora=antes, con_pares=False)
        evento = seg.crear_evento(s, "ACME", "earnings", periodo="2026-Q2", fecha_prevista="2026-07-30", ahora=antes)
        sv.calendario = [{"symbol": "ACME", "date": "2026-07-30", "eps_estimate": 0.5, "revenue_estimate": 300.0,
                          "eps_actual": None, "revenue_actual": None}]
        seg.capturar(s, sv, evento, antes)
        evento_id = evento.id
    sv.ahora = ex.AHORA
    sv.quotes["ACME"].update(price=92.0, as_of=ex.AHORA.isoformat())
    sv.financials["ACME"]["quarters"].append(
        trimestre(2026, 2, "2026-07-30", revenue=310.0, operating_income=310.0 * 0.12, gross_profit=124.0,
                  net_income=31.0, eps_diluted=0.051, cfo=40.0, capex=15.0))
    with session_factory() as s:
        from app.db.models import CatalystEvent

        seg.registrar_reales(s, sv, s.get(CatalystEvent, evento_id), ex.AHORA)
    sv.calendario = [{"symbol": "ACME", "date": (ex.AHORA + timedelta(days=24)).date().isoformat(),
                      "eps_estimate": 0.52, "revenue_estimate": 320.0, "eps_actual": None, "revenue_actual": None}]


def montar(escenario: str):
    from app.db.engine import SessionLocal, init_db

    init_db()
    sv = ServicioDemo(ex.servicio_lista("dia_sin_candidatas" if escenario == "sin_candidatas" else "dia_completo_502"))
    for caso in ("completa", "todo_ausente", "deuda_parcial", "stop_perforado"):
        _, symbol = ex.montar_empresa(caso, sv)
        if caso == "todo_ausente":
            sv.ausentes = frozenset({symbol})
    if escenario != "cartera_vacia":
        with SessionLocal() as s:
            ex.montar_cartera("cad_en_usd", s, sv)
            ex._historia_larga(sv, "STOP", 104.0, 0.0015, 7)
            ex._posicion(s, ex._instrumento(s, "STOP", "Technology"), 50, 90.0, 110.0)
            s.commit()
    else:
        with SessionLocal() as s:
            ex.montar_cartera("vacia", s, sv)
    with time_machine.travel(ex.AHORA, tick=False):
        _historia_acme(SessionLocal, sv)
        # La lista diaria del S&P 500, completa desde la primera carga (en vivo
        # se completa por tandas). Pisa la caché de ese mercado, así que las
        # puntuaciones de las empresas de demostración se dejan en otra lista:
        # la ficha las busca en todos los mercados.
        from app.routers.signals import _today

        with SessionLocal() as s:
            _today("us_sp500", True, 600, sv, s)
        for symbol in ("ACME", "PARC", "STOP"):
            sv.senal(symbol, 0.6, as_of=ex.AHORA, mercado="canada")
    return sv


def main(argv: list[str]) -> int:
    import uvicorn

    from app.deps import get_limiter, get_llm, get_service
    from app.main import app

    p = argparse.ArgumentParser(description="Backend de demostración con datos ficticios.")
    p.add_argument("--escenario", choices=ESCENARIOS, default="normal")
    p.add_argument("--puerto", type=int, default=8000)
    args = p.parse_args(argv)

    sv = montar(args.escenario)

    class _Router:  # el contador de llamadas de la barra lateral
        limiter = get_limiter()

    sv.router = _Router()
    app.dependency_overrides[get_service] = lambda: sv
    app.dependency_overrides[get_llm] = (lambda: IADemo()) if args.escenario == "con_ia" else (lambda: None)
    # El reloj queda congelado en AHORA mientras sirve: lo que se captura es
    # siempre igual, día tras día.
    with time_machine.travel(ex.AHORA, tick=False):
        uvicorn.run(app, host="127.0.0.1", port=args.puerto, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
