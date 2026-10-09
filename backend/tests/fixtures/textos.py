"""Todo el texto que el backend enseña a una persona, sobre el paquete de casos
extremos (ítem 0.5 del plan de correcciones).

`recoger()` ejecuta cada pieza que produce frases —la traza y las alternativas de
`decide()`, el análisis de empresa, «Qué cambió», el replay, las expectativas, la
calidad de beneficios, las notas de la cartera, la lista diaria, la valoración,
el dimensionador, el coste de oportunidad y la vigilancia de tesis— y devuelve
cada cadena de prosa con el sitio de donde salió.

Se recorre la salida entera: cualquier cadena que no sea un código (ver
`tests/golden/canon.es_codigo`) es texto para personas. Se excluye lo que no
escribe la app: titulares de noticias, citas de filings, URLs y lo que teclea el
usuario.
"""

from __future__ import annotations

from datetime import timedelta

from tests.fakes_empresa import trimestre
from tests.fixtures import extremos as ex
from tests.golden import motor
from tests.golden.canon import es_codigo

# Claves cuyo texto no lo redacta la app.
AJENAS = frozenset({
    "url", "source_url", "texto_literal", "headline", "body_md", "title", "model", "accn", "accession_no",
    "etiqueta_xbrl", "tag", "form_type", "formulario", "fuente", "source", "symbol", "unidad_original",
})


# Diccionarios cuyas CLAVES se enseñan como nombre de fila: «x1_working_capital_over_assets»
# salía en la ficha como «working capital over assets» y «cfo_inicio» como «cfo inicio»
# (revisión de la Fase 1). Por la ruta que acaba así; sus claves se anotan como
# códigos bajo «<ruta>{}». (Las `entradas` de la valoración no: se leen campo a campo.)
CLAVES_COMO_NOMBRE = ("evidencias/entradas", "components")

# Si no es None, `_recorrer` anota también cada código, por la clave que lo trae
# (lo usa la guarda de etiquetas, `recoger_codigos`).
_CODIGOS: dict[str, set[str]] | None = None


def _recorrer(x, origen: str, salida: list[tuple[str, str]], clave: str = "") -> None:
    if isinstance(x, str):
        if clave in AJENAS or x.startswith(("http://", "https://")):
            return
        if es_codigo(x):
            if _CODIGOS is not None:
                _CODIGOS.setdefault(clave, set()).add(x)
            return
        salida.append((origen, x))
    elif isinstance(x, dict):
        ruta = next((r for r in CLAVES_COMO_NOMBRE if origen.endswith("/" + r)), None)
        if ruta and _CODIGOS is not None:
            _CODIGOS.setdefault(f"{ruta}{{}}", set()).update(
                str(k) for k in x if "_" in str(k) or es_codigo(str(k)))
        for k, v in x.items():
            ks = str(k)
            # Las huellas son material interno de comparación, no texto.
            if ks.startswith(("_", "huella")):
                continue
            _recorrer(v, f"{origen}/{ks}", salida, ks)
    elif isinstance(x, (list, tuple)):
        for v in x:
            _recorrer(v, origen, salida, clave)


def _cliente(servicio):
    return motor._cliente(servicio)


def _que_cambio_y_replay(salida: list) -> None:
    """Dos análisis de la misma empresa con cosas materiales entre medias, su
    diff y el replay de las dos instantáneas."""
    from app import snapshots as sn
    from app.db.models import DecisionSnapshot
    from app.routers.empresa import analizar_y_congelar

    sv, symbol = ex.montar_empresa("completa")
    with motor._fabrica()() as s:
        ex.montar_cartera("una_posicion", s, sv)
        ex.tesis_con_punto(s, symbol)
        antes = ex.AHORA - timedelta(days=60)
        r1 = analizar_y_congelar(symbol, sv, s, ahora=antes, con_pares=False)
        # Entre medias: baja el precio, desaparece la puntuación y sale un
        # trimestre con el margen por debajo del umbral de la tesis.
        sv.quotes[symbol]["price"] = 92.0
        sv.cache.set("daily_picks", {"v": 6, "market": "us_sp500"}, {"signals": [], "as_of": ex.AHORA.isoformat()})
        sv.financials[symbol]["quarters"].append(
            trimestre(2026, 2, "2026-07-30", revenue=300.0, operating_income=300.0 * 0.12, gross_profit=120.0,
                         net_income=30.0, eps_diluted=0.05, cfo=40.0, capex=15.0))
        r2 = analizar_y_congelar(symbol, sv, s, ahora=ex.AHORA, con_pares=False)
        _recorrer(r2.get("cambios"), "que_cambio", salida)
        for r in (r1, r2):
            snap = s.get(DecisionSnapshot, r["instantanea"]["id"])
            _recorrer(sn.reproducir(snap), "replay", salida)
            _recorrer({"origen": snap.origen}, "replay", salida)


def _expectativas(salida: list) -> None:
    from app import expectativas as seg

    sv, symbol = ex.montar_empresa("completa")
    sv.calendario = [{"symbol": symbol, "date": "2026-10-30", "eps_estimate": 0.5, "revenue_estimate": 290.0,
                      "eps_actual": None, "revenue_actual": None}]
    with motor._fabrica()() as s:
        ex.tesis_con_punto(s, symbol)
        e = seg.crear_evento(s, symbol, "earnings", periodo="2025-Q4", fecha_prevista="2026-02-10",
                             ahora=ex.AHORA - timedelta(days=300))
        _recorrer(seg.capturar(s, sv, e, ex.AHORA - timedelta(days=300)), "expectativas/captura", salida)
        _recorrer(seg.registrar_reales(s, sv, e, ex.AHORA), "expectativas/reales", salida)
        _recorrer(seg.evaluar(s, e), "expectativas/lectura", salida)
        _recorrer(seg.calibracion(s), "expectativas/calibracion", salida)
        vacio = seg.crear_evento(s, symbol, "earnings", periodo="2026-Q3", fecha_prevista="2026-10-30", ahora=ex.AHORA)
        _recorrer(seg.capturar(s, sv, vacio, ex.AHORA), "expectativas/captura", salida)
        _recorrer(seg.evaluar(s, vacio), "expectativas/lectura", salida)


def _cartera(salida: list) -> None:
    for caso in ex.CARTERAS:
        sv, _ = ex.montar_empresa("completa")
        with _cliente(sv) as c:
            from app.db.engine import get_session
            from app.main import app

            with next(app.dependency_overrides[get_session]()) as s:
                ex.montar_cartera(caso, s, sv)
            for ruta in ("/api/portfolio", "/api/portfolio/riesgo", "/api/portfolio/contribucion",
                         "/api/portfolio/historial"):
                r = c.get(ruta)
                _recorrer(r.json(), f"cartera[{caso}]{ruta}", salida)


def _errores(salida: list) -> None:
    """Las pantallas también enseñan los mensajes de error."""
    from fastapi import HTTPException

    from app.routers.signals import _today

    todos = ex.ServicioLista(fallan={"*"})
    todos.get = lambda data_type, **kw: (_ for _ in ()).throw(ex.DataNotFoundError("caído"))
    with motor._fabrica()() as s:
        try:
            _today("us_sp500", False, 600, todos, s)
        except HTTPException as exc:
            _recorrer({"detail": exc.detail}, "hoy[sin_datos]", salida)


def recoger() -> list[tuple[str, str]]:
    salida: list[tuple[str, str]] = []
    for nombre in motor.COMPONENTES:
        for caso in motor.generar_crudo(nombre):
            _recorrer(caso["salida"], f"{nombre}[{caso['caso']}]", salida)
    with motor.reloj_fijo():
        _que_cambio_y_replay(salida)
        _expectativas(salida)
        _cartera(salida)
        _errores(salida)
    return salida


def recoger_codigos() -> dict[str, set[str]]:
    """Cada código que el backend emite sobre el paquete, por la clave que lo trae."""
    global _CODIGOS
    _CODIGOS = {}
    try:
        recoger()
        return _CODIGOS
    finally:
        _CODIGOS = None
