"""Comprobaciones de coherencia con datos REALES, para correr con tus claves.

    python scripts/validar_con_datos_reales.py                 # AAPL MSFT JPM, CAD y EUR
    python scripts/validar_con_datos_reales.py NVDA KO --monedas CAD
    python scripts/validar_con_datos_reales.py --solo-cache    # sin descargar nada
    python scripts/validar_con_datos_reales.py --json > validacion.json
    python scripts/validar_con_datos_reales.py --grabar        # graba respuestas para los tests de contrato
    python scripts/validar_con_datos_reales.py --informe       # además, informe en data/validacion/
    ./start.sh validar                                         # lo mismo, desde la raíz, con informe

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


# Qué mirar a mano en cada familia de comprobación (ítem 1.13). Sale en el
# informe junto a cada fila: un FAIL dice qué no cuadra; esto dice dónde
# comprobarlo con tus propios ojos.
A_MANO = {
    "trimestres_suman_el_ano": "Abre el 10-K y los tres 10-Q del ejercicio en EDGAR: los trimestres deben sumar el "
                               "año. El CFO del 2.º y 3.er trimestre se deriva del acumulado; el 4.º es el año menos "
                               "nueve meses.",
    "fechas_de_publicacion": "En EDGAR, la «Filing date» del periodo: tiene que ser posterior al cierre y no futura.",
    "escala_del_consenso": "Compara el consenso con la cifra del último 10-Q: ¿unidades, miles o millones? Finnhub "
                           "mezcla escalas entre empresas.",
    "cotizacion_frente_a_cierre": "Mira la cotización en tu broker: misma acción, misma moneda, ¿hubo un split?",
    "tipo_de_cambio": "1 USD vale hoy ~1,3–1,4 CAD y ~0,9 EUR; un CAD a ~0,7 es la serie leída del revés.",
    "replay": "En la ficha, «Decisiones y replay»: misma decisión, huella íntegra, nada fechado después.",
    "pasado": "Un análisis a esa fecha no puede traer noticias ni trimestres publicados después.",
    "financieros": "Sin estados de EDGAR: ¿la empresa presenta a la SEC? (las canadienses, no).",
}

# Lo que ningún script puede comprobar por ti (§13 de la revisión general).
COMPROBACIONES_MANUALES = [
    "Trimestres de EDGAR contra un 10-Q real de una empresa que conozcas (CFO del 2.º y 3.er trimestre "
    "derivado; 4.º = año − nueve meses).",
    "Unidades del consenso de Finnhub: el BPA y los ingresos esperados en la misma escala que el 10-Q.",
    "Dirección del tipo de cambio: 1 USD ≈ 1,3–1,4 CAD, no ≈ 0,7.",
    "Un análisis completo de una empresa real y su replay al día siguiente: misma decisión y huella íntegra.",
]


def _a_mano(comprobacion: str) -> str:
    familia = comprobacion.split(":")[0]
    return A_MANO.get(familia, "")


def _celda(texto: str) -> str:
    return str(texto).replace("|", "\\|").replace("\n", " ")


def informe_markdown(filas: list[dict], *, cuando: datetime, simbolos: list[str], monedas: list[str],
                     opciones: str = "") -> str:
    """El informe de una validación: cada PASS, FAIL y UNKNOWN con lo que se
    comparó y dónde mirarlo a mano, más la lista de lo que el script no puede
    comprobar. UNKNOWN no se cuenta como PASS: se dice que no se pudo mirar."""
    from app.formato import fmt_fecha

    c = co.resumen(filas)
    lineas = [
        f"# Validación con datos reales · {fmt_fecha(cuando, hora=True, zona='UTC')}",
        "",
        f"**{c[co.PASS]} PASS · {c[co.FAIL]} FAIL · {c[co.UNKNOWN]} UNKNOWN.** UNKNOWN no es PASS: "
        "no se pudo comprobar, y la fila dice por qué.",
        "",
        f"Empresas: {', '.join(simbolos) or '—'} · monedas: {', '.join(monedas) or '—'}"
        + (f" · opciones: {opciones}" if opciones else ""),
    ]
    actual = object()
    for f in filas:
        if f["simbolo"] != actual:
            actual = f["simbolo"]
            lineas += ["", f"## {actual or 'Cartera'}", "",
                       "| Estado | Comprobación | Lo comparado | Qué mirar a mano |", "|---|---|---|---|"]
        lineas.append(f"| {f['estado']} | {_celda(f['comprobacion'])} | {_celda(f['detalle'])} | "
                      f"{_celda(_a_mano(f['comprobacion']))} |")
    lineas += ["", "## Comprobaciones a mano", "",
               "Lo que ningún script puede ver por ti (§13 de `docs/REVISION_GENERAL.md`):", ""]
    lineas += [f"- [ ] {x}" for x in COMPROBACIONES_MANUALES]
    return "\n".join(lineas) + "\n"


def escribir_informe(texto: str, carpeta: Path, cuando: datetime) -> Path:
    carpeta.mkdir(parents=True, exist_ok=True)
    ruta = carpeta / f"validacion_{cuando:%Y%m%d}.md"
    ruta.write_text(texto, encoding="utf-8")
    return ruta


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


# Empresas por defecto para grabar: una grande de EE. UU., una con mucha deuda y
# una canadiense (sin registro en la SEC: la grabación dice qué falla).
GRABAR_POR_DEFECTO = ["AAPL", "T", "RY.TO"]


def grabar(simbolos: list[str], destino=None, sesiones_cuota=None) -> list:
    """Graba las respuestas reales de cada proveedor (ítem 0.7 del plan).

    Cada empresa va a su casete en tests/fixtures/reales/, más uno común con el
    calendario de resultados y los tipos de cambio. Se descarga TODO de nuevo
    (caché en memoria) para que cada petición quede grabada; la cuota se cuenta
    en el registro de llamadas de la app, como siempre.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.analysis import fx
    from app.cache.cache import CacheStore, MarketDataService
    from app.db import models  # noqa: F401
    from app.db.engine import Base, SessionLocal
    from app.deps import build_providers
    from app.providers.router import DataRouter, RateLimiter
    from tests.fixtures import reales

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    memoria = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    proveedores = build_providers()
    servicio = MarketDataService(DataRouter(proveedores, RateLimiter(sesiones_cuota or SessionLocal)),
                                 CacheStore(memoria))
    destino = destino or reales.DIR
    rutas = []

    def pedir(casete, tipo, **kw):
        try:
            servicio.get(tipo, **kw)
            casete.setdefault("pedidos", []).append({"tipo": tipo, "kwargs": kw, "ok": True})
        except (DataNotFoundError, AllProvidersFailedError) as exc:
            casete.setdefault("pedidos", []).append({"tipo": tipo, "kwargs": kw, "ok": False, "motivo": str(exc)[:200]})

    for simbolo in simbolos:
        casete = reales.casete_vacio(simbolo, list(proveedores))
        with reales.grabar(casete, recortar_tickers={simbolo.split(".")[0]}):
            pedir(casete, "quote", symbol=simbolo)
            pedir(casete, "profile", symbol=simbolo)
            pedir(casete, "price_history", symbol=simbolo, **PARAMS_HISTORIA)
            pedir(casete, "financials", symbol=simbolo)
            pedir(casete, "fundamentals", symbol=simbolo)
            pedir(casete, "news", symbol=simbolo, days=7)
            # Y el análisis entero: así quedan grabadas las peticiones EXACTAS
            # que hace la app (ventanas de noticias y de calendario incluidas),
            # no una aproximación que luego no coincide al reproducir.
            from app import analisis_empresa

            with memoria() as s:
                try:
                    analisis_empresa.analizar(simbolo, servicio, s, con_pares=False)
                except Exception as exc:  # noqa: BLE001 — se anota y se sigue con la siguiente
                    casete["analisis_error"] = f"{type(exc).__name__}: {exc}"[:300]
        _sin_cruzar_medianoche(casete)
        rutas.append(reales.guardar(casete, destino))

    comun = reales.casete_vacio("_comun", list(proveedores))
    hoy = datetime.now(timezone.utc).date()
    with reales.grabar(comun):
        pedir(comun, "earnings_calendar", start=hoy.isoformat(), end=(hoy + timedelta(days=DIAS_CALENDARIO)).isoformat())
        for moneda in ("CAD", "EUR"):
            pedir(comun, "macro", series_id=fx.SERIES[moneda]["serie"], start=fx.inicio_de_ventana())
    _sin_cruzar_medianoche(comun)
    rutas.append(reales.guardar(comun, destino))
    return rutas


def _sin_cruzar_medianoche(casete: dict) -> None:
    """La reproducción congela el reloj en `grabado_en`, y la app pide ventanas
    por fecha (noticias de los últimos días, calendario de los próximos). Si la
    grabación cruza la medianoche UTC, lo pedido después lleva otra fecha y no se
    reproduce. No se guarda una grabación que fallaría sin decir por qué."""
    empezo = datetime.fromisoformat(casete["grabado_en"]).date()
    if datetime.now(timezone.utc).date() != empezo:
        raise RuntimeError(f"La grabación de {casete['nombre']} cruzó la medianoche UTC (empezó el {empezo}): "
                           "vuelve a grabar; lo grabado no se reproduciría.")


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
    p.add_argument("--informe", action="store_true",
                   help="escribe además validacion_AAAAMMDD.md (por defecto en backend/data/validacion/)")
    p.add_argument("--carpeta-informe", type=Path, default=None, help="carpeta del informe")
    p.add_argument("--grabar", action="store_true",
                   help="graba las respuestas reales para los tests de contrato (por defecto AAPL T RY.TO)")
    args = p.parse_args(argv)

    from app.config import settings
    from app.db.engine import init_db
    from app.deps import get_service
    from app.registro import configurar as configurar_registro

    configurar_registro()
    init_db()
    if args.grabar:
        simbolos = [s.upper() for s in args.simbolos] if args.simbolos != SIMBOLOS_POR_DEFECTO else GRABAR_POR_DEFECTO
        for ruta in grabar(simbolos):
            print(f"grabado {ruta}")
        print("\nRevisa que no haya nada tuyo antes de hacer commit: las claves y las cabeceras no se "
              "guardan, y cualquier aparición de una clave en un cuerpo sale como ***.\n"
              "Después: `python -m pytest tests/test_contrato_reales.py -v`.")
        return 0
    service = get_service()
    monedas = [m.strip().upper() for m in args.monedas.split(",") if m.strip()]
    filas = validar(service, [s.upper() for s in args.simbolos], monedas, solo_cache=args.solo_cache,
                    con_replay=not args.sin_replay, con_fred=bool(settings.fred_api_key),
                    dias_pasado=args.dias_pasado)
    cuando = datetime.now(timezone.utc)
    if args.json:
        print(json.dumps({"cuando": cuando.isoformat(), "resumen": co.resumen(filas),
                          "filas": filas}, ensure_ascii=False, indent=2, default=str))
    else:
        _imprimir(filas)
    if args.informe or args.carpeta_informe:
        opciones = ", ".join(o for o, si in (("solo caché", args.solo_cache), ("sin replay", args.sin_replay)) if si)
        texto = informe_markdown(filas, cuando=cuando, simbolos=[s.upper() for s in args.simbolos],
                                 monedas=monedas, opciones=opciones)
        carpeta = args.carpeta_informe or Path(settings.database_path).resolve().parent / "validacion"
        print(f"\ninforme: {escribir_informe(texto, carpeta, cuando)}", file=sys.stderr if args.json else sys.stdout)
    return 1 if any(f["estado"] == co.FAIL for f in filas) else 0


if __name__ == "__main__":
    raise SystemExit(main())
