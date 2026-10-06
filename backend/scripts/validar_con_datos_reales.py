"""Comprobaciones de coherencia con datos REALES, para correr con tus claves.

    python scripts/validar_con_datos_reales.py                 # AAPL MSFT JPM, CAD y EUR
    python scripts/validar_con_datos_reales.py NVDA KO --monedas CAD
    python scripts/validar_con_datos_reales.py --solo-cache    # sin descargar nada
    python scripts/validar_con_datos_reales.py --json > validacion.json

Los tests prueban el código con datos fabricados; esto prueba lo que los tests
no pueden ver: que los datos reales cuadren entre sí. Ninguna comprobación
necesita una «verdad» externa:

- los cuatro trimestres suman el año (ingresos, beneficio, flujo operativo);
- cada periodo se publicó después de cerrar, no en el futuro, y a tiempo de ser
  la primera publicación;
- el consenso del calendario está en la escala de los trimestres publicados
  (la misma regla que decide si se registra);
- el tipo de cambio de FRED está en su banda de cordura y es reciente;
- la cotización no se aleja del último cierre del histórico;
- analizar → congelar → reproducir devuelve lo mismo, con la huella intacta y
  nada fechado después de la decisión;
- un análisis a una fecha PASADA no contiene nada publicado después.

Cada fila sale PASS, FAIL o UNKNOWN (no se pudo comprobar, y por qué). Sale con
código 1 si hay algún FAIL.

**Qué toca de tu base.** Usa la caché y el registro de llamadas de la app, como
la app misma: así comparte la cuota diaria de cada proveedor en vez de gastarla
dos veces. NO congela nada en tu base: el análisis de ida y vuelta se hace en
una base en memoria que desaparece al terminar.

Coste aproximado por símbolo, sin caché: cotización, histórico de un año,
estados de EDGAR y noticias (el análisis), más un calendario de resultados
compartido y una serie de FRED por moneda.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import coherencia as co  # noqa: E402
from app.providers.base import DataNotFoundError  # noqa: E402
from app.providers.router import AllProvidersFailedError  # noqa: E402

SIMBOLOS_POR_DEFECTO = ["AAPL", "MSFT", "JPM"]
MONEDAS_POR_DEFECTO = ["CAD", "EUR"]
DIAS_CALENDARIO = 90
DIAS_PASADO = 120

# Los parámetros EXACTOS con los que la app cachea cada dato: con otros, la
# lectura de solo caché no los encontraría.
PARAMS_HISTORIA = {"interval": "1day", "outputsize": 252}


def _traer(service, tipo: str, solo_cache: bool, **kw) -> tuple[dict | None, str | None]:
    try:
        if solo_cache:
            payload = service.cache.get(tipo, kw)
            return payload, None if payload else "no está en caché"
        return service.get(tipo, **kw), None
    except (DataNotFoundError, AllProvidersFailedError) as exc:
        return None, str(exc)[:200]


def _base_en_memoria():
    """Una base desechable: la ida y vuelta congela, y eso no va a tu base."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.db import models  # noqa: F401  (registra las tablas)
    from app.db.engine import Base

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def _ida_y_vuelta(service, simbolo: str, ahora: datetime, dias_pasado: int) -> list[dict]:
    from app import analisis_empresa
    from app import snapshots as sn
    from app.db.models import DecisionSnapshot
    from app.routers.empresa import analizar_y_congelar

    fabrica = _base_en_memoria()
    filas = []
    with fabrica() as s:
        try:
            r = analizar_y_congelar(simbolo, service, s, ahora=ahora, con_pares=False)
        except Exception as exc:  # el análisis entero falló: es un resultado, no un cuelgue
            return [co._fila("replay", simbolo, co.FAIL, f"el análisis falló: {type(exc).__name__}: {exc}"[:300])]
        snap = s.get(DecisionSnapshot, r["instantanea"]["id"])
        filas += co.ida_y_vuelta(simbolo, r["analisis"], sn.reproducir(snap))
        momento = ahora - timedelta(days=dias_pasado)
        try:
            pasado = analisis_empresa.analizar(simbolo, service, s, ahora=momento, con_pares=False)
        except Exception as exc:
            return filas + [co._fila("pasado:sin_anticipacion", simbolo, co.FAIL,
                                     f"el análisis a {momento.date()} falló: {type(exc).__name__}: {exc}"[:300])]
        filas += co.sin_anticipacion_en_el_pasado(simbolo, pasado, momento)
    return filas


def validar(service, simbolos: list[str], monedas: list[str], *, ahora: datetime | None = None,
            solo_cache: bool = False, con_replay: bool = True, con_fred: bool = True,
            dias_pasado: int = DIAS_PASADO) -> list[dict]:
    ahora = ahora or datetime.now(timezone.utc)
    hoy = ahora.date()
    filas: list[dict] = []

    desde, hasta = hoy.isoformat(), (hoy + timedelta(days=DIAS_CALENDARIO)).isoformat()
    calendario, fallo_cal = _traer(service, "earnings_calendar", solo_cache, start=desde, end=hasta)
    eventos = {e.get("symbol"): e for e in (calendario or {}).get("events") or []}

    for simbolo in simbolos:
        fin, fallo = _traer(service, "financials", solo_cache, symbol=simbolo)
        if fin is None:
            filas.append(co._fila("financieros", simbolo, co.UNKNOWN, f"sin estados de EDGAR: {fallo}"))
        else:
            filas += co.trimestres_frente_al_ano(simbolo, fin)
            filas += co.fechas_de_publicacion(simbolo, fin, hoy)
        if calendario is None:
            filas.append(co._fila("escala_del_consenso", simbolo, co.UNKNOWN, f"sin calendario: {fallo_cal}"))
        else:
            filas += co.escala_del_consenso(simbolo, eventos.get(simbolo), (fin or {}).get("quarters") or [])

        quote, _ = _traer(service, "quote", solo_cache, symbol=simbolo)
        historia, _ = _traer(service, "price_history", solo_cache, symbol=simbolo, **PARAMS_HISTORIA)
        filas += co.cotizacion_frente_a_cierre(simbolo, quote, (historia or {}).get("bars"), hoy)

        if not con_replay:
            filas.append(co._fila("replay", simbolo, co.UNKNOWN, "desactivado (--sin-replay)"))
        elif solo_cache:
            filas.append(co._fila("replay", simbolo, co.UNKNOWN, "con --solo-cache no se analiza: el análisis descarga"))
        else:
            filas += _ida_y_vuelta(service, simbolo, ahora, dias_pasado)

    for moneda in monedas:
        filas += co.tipo_de_cambio(moneda, _tipo(service, moneda, solo_cache) if con_fred else None)
    return filas


def _tipo(service, moneda: str, solo_cache: bool) -> dict | None:
    """El tipo como lo obtiene la cartera (`routers.portfolio.tipos_de_cambio`)."""
    from app.analysis import fx

    if moneda not in fx.SERIES:
        return None
    payload, fallo = _traer(service, "macro", solo_cache, series_id=fx.SERIES[moneda]["serie"],
                            start=fx.inicio_de_ventana())
    if payload is None:
        return {"por_usd": None, "error": f"FRED {fx.SERIES[moneda]['serie']}: {fallo}"}
    try:
        return fx.tipo_desde_observaciones(moneda, payload.get("points") or [])
    except fx.SinTipo as exc:
        return {"por_usd": None, "error": str(exc)[:200]}


def _imprimir(filas: list[dict]) -> None:
    ancho = max((len(f["comprobacion"]) for f in filas), default=20)
    actual = object()
    for f in filas:
        if f["simbolo"] != actual:
            actual = f["simbolo"]
            print(f"\n== {actual or 'cartera'} ==")
        print(f"  {f['estado']:<7} {f['comprobacion']:<{ancho}}  {f['detalle']}")
    c = co.resumen(filas)
    print(f"\n{c[co.PASS]} PASS · {c[co.FAIL]} FAIL · {c[co.UNKNOWN]} UNKNOWN"
          " (UNKNOWN no es PASS: no se pudo comprobar)")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Coherencia interna de los datos reales.")
    p.add_argument("simbolos", nargs="*", default=SIMBOLOS_POR_DEFECTO)
    p.add_argument("--monedas", default=",".join(MONEDAS_POR_DEFECTO),
                   help="monedas a comprobar contra FRED, separadas por comas (vacío: ninguna)")
    p.add_argument("--solo-cache", action="store_true", help="no descarga nada; lo que no esté en caché, UNKNOWN")
    p.add_argument("--sin-replay", action="store_true", help="no analiza ni reproduce (ahorra llamadas)")
    p.add_argument("--dias-pasado", type=int, default=DIAS_PASADO,
                   help="antigüedad del análisis a fecha pasada (por defecto 120 días)")
    p.add_argument("--json", action="store_true", help="salida en JSON")
    args = p.parse_args(argv)

    from app.config import settings
    from app.db.engine import init_db
    from app.deps import get_service
    from app.registro import configurar as configurar_registro

    configurar_registro()
    init_db()
    service = get_service()
    monedas = [m.strip().upper() for m in args.monedas.split(",") if m.strip()]
    filas = validar(service, [s.upper() for s in args.simbolos], monedas, solo_cache=args.solo_cache,
                    con_replay=not args.sin_replay, con_fred=bool(settings.fred_api_key),
                    dias_pasado=args.dias_pasado)
    if args.json:
        print(json.dumps({"cuando": datetime.now(timezone.utc).isoformat(), "resumen": co.resumen(filas),
                          "filas": filas}, ensure_ascii=False, indent=2, default=str))
    else:
        _imprimir(filas)
    return 1 if any(f["estado"] == co.FAIL for f in filas) else 0


if __name__ == "__main__":
    raise SystemExit(main())
