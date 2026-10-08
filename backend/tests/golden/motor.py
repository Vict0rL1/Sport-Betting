"""El golden master del motor: qué decide hoy, para poder probar que ningún
arreglo del plan de correcciones lo cambia (ítem 0.3).

Cada componente es una función sin argumentos que devuelve una lista de
`{"caso": id, "salida": forma_canónica}`. Las entradas son fijas: una rejilla
para `decide()`, escenarios para el dimensionador y el coste de oportunidad, y el
paquete de casos extremos (`tests/fixtures/extremos`) para lo que necesita una
empresa o una cartera entera.

Todo corre con el reloj congelado en `AHORA` (time-machine): hay piezas que leen
la hora real (la ventana de noticias de la tesis, la frescura de un tipo de
cambio, la lista diaria) y sin congelarlo el golden caducaría solo.

Regenerar es un acto deliberado: `python -m tests.golden.generar --escribir`.
Si un golden cambia, primero se explica por qué.
"""

from __future__ import annotations

import contextlib
import itertools
import math
from datetime import timedelta

import time_machine
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from tests.fixtures import extremos as ex
from tests.golden.canon import canon

NAN = float("nan")


@contextlib.contextmanager
def reloj_fijo():
    with time_machine.travel(ex.AHORA, tick=False):
        yield


def _fabrica():
    from app.db import models  # noqa: F401  (registra las tablas)
    from app.db.engine import Base

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


# Lo que se guarda de cada salida. El golden guarda la forma canónica; los
# tests contra fugas de texto (0.5) reutilizan los MISMOS escenarios en crudo.
_transformar = canon


def _caso(id_: str, salida) -> dict:
    return {"caso": id_, "salida": _transformar(salida)}


# --- decide() ---------------------------------------------------------------------------------

SCORES = [None, NAN, -1.0, -0.36, -0.35, -0.34, 0.0, 0.34, 0.35, 0.6]
PRECIOS = {
    "sobre_media": {"last": 105.0, "sma200": 100.0, "daily_vol_pct": 1.5},
    "en_banda_alta": {"last": 101.0, "sma200": 100.0, "daily_vol_pct": 1.5},
    "bajo_media": {"last": 99.0, "sma200": 100.0, "daily_vol_pct": 1.5},
    "caida_volatil": {"last": 95.0, "sma200": 100.0, "daily_vol_pct": 6.0},
    "calma": {"last": 105.0, "sma200": 100.0, "daily_vol_pct": 0.5},  # stop al mínimo
    "sin_media": {"last": 110.0},
    "nan": {"last": NAN, "sma200": 100.0, "daily_vol_pct": 1.5},
    "negativo": {"last": -5.0, "sma200": 100.0, "daily_vol_pct": 1.5},
    "cero": {"last": 0.0, "sma200": 100.0, "daily_vol_pct": 1.5},
    "viejo": {"last": 105.0, "sma200": 100.0, "daily_vol_pct": 1.5, "estado": "viejo",
              "antiguedad_segundos": 1800},
    "ausente": None,
}
POSICIONES = {
    "sin_posicion": None,
    "stop_fijado": {"cost_basis": 100.0, "quantity": 10, "stop": 90.0},
    "sin_stop": {"cost_basis": 100.0, "quantity": 10, "stop": None},
    "stop_sobre_coste": {"cost_basis": 100.0, "quantity": 10, "stop": 110.0},
    "coste_cero": {"cost_basis": 0.0, "quantity": 10, "stop": 90.0},
    "coste_nan": {"cost_basis": NAN, "quantity": 10, "stop": 90.0},
    "varios_lotes": {"cost_basis": 85.0, "quantity": 40, "stop": 95.0, "lotes": 2, "lotes_sin_stop": 1},
}


def _decide(score, precio, posicion, **kw):
    from app.analysis.decision import decide

    return decide({"score": score}, None if precio is None else dict(precio),
                  None if posicion is None else dict(posicion), **kw)


def golden_decide() -> list[dict]:
    casos = []
    for (i, s), (np, p), (npos, pos) in itertools.product(enumerate(SCORES), PRECIOS.items(), POSICIONES.items()):
        casos.append(_caso(f"s{i}|{np}|{npos}", _decide(s, p, pos)))
    # Resultados inminentes y otras clases de activo, sin posición.
    for (i, s), (np, p) in itertools.product(enumerate(SCORES), PRECIOS.items()):
        casos.append(_caso(f"s{i}|{np}|resultados", _decide(s, p, None, resultados_en="2026-09-16")))
        for clase in ("cripto", "etf"):
            casos.append(_caso(f"s{i}|{np}|{clase}", _decide(s, p, None, clase=clase)))
    return casos


# --- Dimensionador ----------------------------------------------------------------------------


def _retornos(semilla: int, n: int = 40, base: list[float] | None = None, mezcla: float = 0.0) -> list[float]:
    propios = [0.01 * math.sin(semilla * 1.7 + k * 0.9) for k in range(n)]
    if base is None:
        return propios
    return [mezcla * b + (1 - mezcla) * p for b, p in zip(base, propios)]


def golden_sizing() -> list[dict]:
    from app.analysis.sizing import dimensionar

    comun = _retornos(1)
    escenarios = {
        "sin_candidatas": dict(candidatas=[]),
        "una": dict(candidatas=[{"symbol": "A", "sector": "Tech", "peso_bruto_pct": 5.0, "vol_anual_pct": 25.0}]),
        "excede_posicion": dict(candidatas=[{"symbol": "A", "sector": "Tech", "peso_bruto_pct": 15.0,
                                             "vol_anual_pct": 20.0}]),
        "sector_lleno": dict(candidatas=[{"symbol": s, "sector": "Tech", "peso_bruto_pct": 9.0, "vol_anual_pct": 20.0}
                                         for s in ("A", "B", "C", "D")]),
        "cartera_ocupa_sector": dict(
            candidatas=[{"symbol": "A", "sector": "Tech", "peso_bruto_pct": 9.0, "vol_anual_pct": 20.0}],
            cartera=[{"symbol": "X", "sector": "Tech", "peso_pct": 20.0, "vol_anual_pct": 22.0}]),
        "correlacionadas": dict(
            candidatas=[{"symbol": s, "sector": sec, "peso_bruto_pct": 8.0, "vol_anual_pct": 25.0}
                        for s, sec in (("A", "Tech"), ("B", "Energy"), ("C", "Health"))],
            retornos={"A": comun, "B": _retornos(2, base=comun, mezcla=0.95), "C": _retornos(3)}),
        "vol_alta": dict(candidatas=[{"symbol": s, "sector": sec, "peso_bruto_pct": 9.0, "vol_anual_pct": 90.0}
                                     for s, sec in (("A", "Tech"), ("B", "Energy"), ("C", "Health"))]),
        "vol_desconocida": dict(candidatas=[{"symbol": "A", "sector": "Tech", "peso_bruto_pct": 5.0,
                                             "vol_anual_pct": None},
                                            {"symbol": "B", "sector": "Energy", "peso_bruto_pct": 5.0,
                                             "vol_anual_pct": NAN}]),
        "evidencia": dict(candidatas=[{"symbol": s, "sector": sec, "peso_bruto_pct": 6.0, "vol_anual_pct": 20.0,
                                       "confianza": conf}
                                      for s, sec, conf in (("A", "Tech", "baja"), ("B", "Energy", "media"),
                                                           ("C", "Health", "alta"), ("D", "Utilities", None))]),
        "cartera_con_nan": dict(
            candidatas=[{"symbol": "A", "sector": "Tech", "peso_bruto_pct": 5.0, "vol_anual_pct": 20.0}],
            cartera=[{"symbol": "X", "sector": "Tech", "peso_pct": NAN, "vol_anual_pct": NAN}]),
    }
    return [_caso(k, dimensionar(**v)) for k, v in escenarios.items()]


# --- Coste de oportunidad ---------------------------------------------------------------------

IDEA = {"symbol": "MSFT", "accion": "comprar", "tesis": "intacta", "valoracion": "razonable", "confianza": "media"}


def _pos(symbol="A", **kw):
    base = {"symbol": symbol, "peso": 0.10, "accion": "mantener", "tesis": "intacta", "valoracion": "razonable",
            "confianza": "media", "precio": 100.0, "coste_medio": 100.0, "dias_en_cartera": 200}
    return {**base, **kw}


def golden_oportunidad() -> list[dict]:
    from app.analysis import coste_de_oportunidad as oc

    def ev(posiciones, efectivo=0.0, tamano=0.042, idea=IDEA, **kw):
        return oc.evaluar(idea, posiciones, tamano_maximo=tamano, efectivo=efectivo, coste_por_lado_pct=0.15, **kw)

    mala = _pos("BAD", accion="vender", tesis="puntos_cruzados", valoracion="cara")
    plusvalia = _pos("BAD", accion="vender", tesis="puntos_cruzados", precio=400.0, coste_medio=100.0)
    escenarios = {
        "efectivo_suficiente": lambda: ev([_pos()], efectivo=0.05),
        "llena_idea_superior": lambda: ev([_pos("GOOD", valoracion="barata"), mala], efectivo=0.01),
        "diferencia_pequena": lambda: ev([_pos(tesis="sin_tesis")]),
        "tesis_invalidada": lambda: ev([_pos("OK"), _pos("ROTA", tesis="puntos_cruzados")]),
        "correlacionada": lambda: ev([_pos("INDEP", correlacion_con_candidata=0.1),
                                      _pos("GEMELA", correlacion_con_candidata=0.88)]),
        "costes_sin_impuestos": lambda: ev([plusvalia], tipo_impositivo=0.0),
        "costes_con_impuestos": lambda: ev([plusvalia], tipo_impositivo=0.25),
        "impuestos_desconocidos": lambda: ev([_pos(precio=150.0, coste_medio=100.0)]),
        "recien_comprada": lambda: ev([_pos("NUEVA", accion="vender", tesis="puntos_cruzados", dias_en_cartera=10)]),
        "efectivo_desconocido": lambda: ev([_pos("BAD", accion="vender", tesis="puntos_cruzados")], efectivo=None),
        "sin_senal_de_compra": lambda: ev([_pos()], idea={**IDEA, "accion": "vigilar"}),
        "no_cabe": lambda: ev([_pos()], tamano=0.0),
        "no_cabe_con_recorte": lambda: ev([_pos()], tamano=0.0, recortes=["volatilidad"]),
        "no_cabe_efectivo_desconocido": lambda: ev([_pos()], tamano=0.0, efectivo=None),
        "posicion_casi_desconocida": lambda: ev([_pos("X", accion=None, tesis=None, valoracion=None,
                                                      confianza=None)]),
        "costes_por_lado_altos": lambda: oc.evaluar(IDEA, [mala], tamano_maximo=0.042, efectivo=0.0,
                                                   coste_por_lado_pct=2.5),
    }
    return [_caso(k, f()) for k, f in escenarios.items()]


# --- Calidad de beneficios --------------------------------------------------------------------


def golden_calidad() -> list[dict]:
    from app.analysis import calidad_beneficios as cb
    from tests.fakes_empresa import financieros_base, periodo

    base = financieros_base()
    cuentas = [{**p, "accounts_receivable": 100.0 * (1.6 if i else 1.0), "inventory": 80.0,
                "sbc": 30.0, "total_assets": 2000.0} for i, p in enumerate(base)]
    escenarios = {
        "base": (base, ex.trimestres_base()),
        "sin_nada": ([periodo(2024, "2025-02-12"), periodo(2025, "2026-02-10")], []),
        "un_ejercicio": (base[-1:], []),
        "cobros_disparados": (cuentas, ex.trimestres_base()),
        "fcf_negativo": ([{**p, "capex": 400.0} for p in base], []),
        "beneficio_negativo": ([{**p, "net_income": -50.0} for p in base], []),
    }
    return [_caso(k, cb.analizar(p, q, obtenido_en=ex.AHORA.isoformat())) for k, (p, q) in escenarios.items()]


# --- Tesis ------------------------------------------------------------------------------------


def golden_tesis() -> list[dict]:
    from app.analysis import thesis_watch as tw

    disparadores = [
        {"kind": "metrica", "config": {"metrica": "operating_margin", "op": "lt", "umbral": 0.18}},
        {"kind": "metrica", "config": {"metrica": "debt_to_equity", "op": "gt", "umbral": 2.0}},
        {"kind": "metrica", "config": {"metrica": "roe", "op": "lt", "umbral": 0.10}},
        {"kind": "crecimiento", "config": {"metrica": "revenue_cagr", "op": "lt", "umbral": 0.05}},
        {"kind": "noticia", "config": {"palabras": ["recall", "fraude"]}},
        {"kind": "desconocido", "config": {}},
        {"kind": "metrica", "activo": False, "config": {"metrica": "roe", "op": "lt", "umbral": 0.5}},
    ]
    ratios = [{"fiscal_year": str(a), "operating_margin": m, "debt_to_equity": d, "roe": r}
              for a, m, d, r in ((2022, 0.22, 1.0, 0.2), (2023, 0.20, 1.5, 0.15), (2024, 0.19, 2.1, 0.12),
                                 (2025, 0.17, 2.5, 0.08))]
    noticias = [{"headline": "Acme anuncia un recall de producto",
                 "published_at": (ex.AHORA - timedelta(days=2)).isoformat()},
                {"headline": "Fraude en un competidor", "published_at": (ex.AHORA - timedelta(days=200)).isoformat()}]
    datos = {
        "completos": {"ratios": ratios, "crecimiento": {"revenue_cagr": 0.03}, "noticias": noticias},
        "vacios": {},
        "un_ejercicio": {"ratios": ratios[-1:], "crecimiento": {"revenue_cagr": None}, "noticias": []},
        "con_nan": {"ratios": [{**r, "operating_margin": NAN} for r in ratios], "crecimiento": {}, "noticias": []},
    }
    return [_caso(k, tw.vigilar(disparadores, d)) for k, d in datos.items()]


# --- Análisis de empresa (decisión, confianza, riesgo, oportunidad, valoración, tesis) ---------

COMBINACIONES = [(e, "vacia") for e in ex.EMPRESAS] + [
    ("completa", "una_posicion"), ("completa", "cad_en_usd"), ("completa", "fx_invertido"),
    ("deuda_parcial", "una_posicion"), ("no_sec", "cad_en_usd"), ("no_sec", "fx_invertido"),
    ("stop_perforado", "con_stop_perforado"), ("todo_ausente", "una_posicion"),
]


def golden_analisis() -> list[dict]:
    from app import analisis_empresa

    casos = []
    for empresa, cartera in COMBINACIONES:
        sv, symbol = ex.montar_empresa(empresa)
        with _fabrica()() as s:
            ex.montar_cartera(cartera, s, sv)
            if empresa in ("completa", "deuda_parcial"):
                ex.tesis_con_punto(s, symbol)
            a = analisis_empresa.analizar(symbol, sv, s, ahora=ex.AHORA, con_pares=False)
        casos.append(_caso(f"{empresa}|{cartera}", a))
    return casos


# --- Los dos DCF ------------------------------------------------------------------------------


class _ServicioValoracion:
    def __init__(self, periodos: list[dict], precio: float | None = 120.0):
        self.periodos, self.precio = periodos, precio

    def get(self, data_type, **kw):
        from app.providers.base import DataNotFoundError

        comun = {"source": "fake", "as_of": ex.AHORA.isoformat(), "cached": False}
        if data_type == "financials":
            return {**comun, "symbol": kw["symbol"], "periods": [dict(p) for p in self.periodos]}
        if data_type == "quote" and self.precio is not None:
            return {**comun, "symbol": kw["symbol"], "price": self.precio}
        raise DataNotFoundError(data_type)


def _periodos_valoracion(**cambios) -> list[dict]:
    salida = []
    for i in range(8):
        e = 1.0 + i * 0.06
        p = {"fiscal_year": str(2018 + i), "end_date": f"{2018 + i}-12-31", "revenue": 5000e6 * e,
             "operating_income": 1200e6 * e, "net_income": 800e6 * e, "eps_diluted": 8.0 * e, "equity": 4000e6,
             "total_assets": 9000e6, "long_term_debt": 2000e6, "short_term_debt": 500e6, "cash": 1000e6,
             "interest_expense": 100e6, "cfo": 1400e6 * e, "capex": 400e6, "shares_outstanding": 100e6}
        salida.append({**p, **cambios})
    return salida


VARIANTES_DCF = {
    "base": _periodos_valoracion(),
    "sin_deuda_corto": _periodos_valoracion(short_term_debt=None),
    "sin_deuda": _periodos_valoracion(short_term_debt=None, long_term_debt=None),
    "fcf_plano": [{**p, "cfo": 1400e6} for p in _periodos_valoracion()],
    "fcf_negativo": _periodos_valoracion(capex=3000e6),
}
ESCENARIOS_FICHA = {
    "bear": {"growth_rate": 0.02, "discount_rate": 0.11, "terminal_growth": 0.02},
    "base": {"growth_rate": 0.05, "discount_rate": 0.10, "terminal_growth": 0.025},
    "bull": {"growth_rate": 0.08, "discount_rate": 0.09, "terminal_growth": 0.03},
}


@contextlib.contextmanager
def _cliente(servicio):
    from fastapi.testclient import TestClient

    from app.db.engine import get_session
    from app.deps import get_service
    from app.main import app

    fabrica = _fabrica()

    def sesion():
        s = fabrica()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_service] = lambda: servicio
    app.dependency_overrides[get_session] = sesion
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def golden_dcf_ficha() -> list[dict]:
    casos = []
    for k, periodos in VARIANTES_DCF.items():
        with _cliente(_ServicioValoracion(periodos)) as c:
            d = c.get("/api/stocks/AAPL/valuation/defaults")
            casos.append(_caso(f"{k}|defaults", {"status": d.status_code, "json": d.json()}))
            for deuda in (None, 0.0, 1500e6):
                cuerpo = {"base_fcf": 1000e6, "years": 5, "net_debt": deuda, "shares_outstanding": 100e6,
                          "scenarios": ESCENARIOS_FICHA}
                r = c.post("/api/stocks/AAPL/valuation/dcf", json=cuerpo)
                casos.append(_caso(f"{k}|dcf|deuda={deuda}", {"status": r.status_code, "json": r.json()}))
    return casos


def golden_dcf_modulo() -> list[dict]:
    casos = []
    for k, periodos in VARIANTES_DCF.items():
        for precio in (120.0, None):
            with _cliente(_ServicioValoracion(periodos, precio)) as c:
                r = c.post("/api/valuation/AAPL", json=None)
                casos.append(_caso(f"{k}|precio={precio}", {"status": r.status_code, "json": r.json()}))
                r = c.post("/api/valuation/AAPL", json={"net_debt": 0.0})
                casos.append(_caso(f"{k}|precio={precio}|deuda_tuya", {"status": r.status_code, "json": r.json()}))
    return casos


# --- Lista diaria -----------------------------------------------------------------------------


def golden_hoy() -> list[dict]:
    from app.routers.signals import _today

    casos = []
    variantes = [(caso, False) for caso in ex.LISTAS] + [("dia_sin_candidatas", True), ("dia_completo_502", True)]
    for caso, con_cartera in variantes:
        sv = ex.servicio_lista(caso)
        with _fabrica()() as s:
            if con_cartera:
                ex.sembrar_cartera_lista(s)
            d = _today("us_sp500", False, 600, sv, s)
        compacta = {
            "counts": d["counts"], "thresholds": d["thresholds"], "scored": d["scored"],
            "requested": d["requested"], "complete": d["complete"],
            "sectores": [{"key": x["key"], "scored": x["scored"], "usable": x["usable"]} for x in d["sectors"]],
            "ideas": [{"symbol": i["symbol"], "peso_final_pct": i.get("peso_final_pct")} for i in d["shortlist"]["ideas"]],
            "evitar": [i["symbol"] for i in d["shortlist"].get("evitar") or []],
            "sizing": d["shortlist"].get("sizing"),
            "senales": [{"symbol": x["symbol"], "score": x["score"], "rank": x["rank"],
                         "accion": x["decision"]["action"], "niveles": x["decision"].get("levels")}
                        for x in d["signals"]],
        }
        casos.append(_caso(f"{caso}|cartera" if con_cartera else caso, compacta))
    return casos


COMPONENTES = {
    "decide": golden_decide,
    "sizing": golden_sizing,
    "oportunidad": golden_oportunidad,
    "calidad": golden_calidad,
    "tesis": golden_tesis,
    "analisis": golden_analisis,
    "dcf_ficha": golden_dcf_ficha,
    "dcf_modulo": golden_dcf_modulo,
    "hoy": golden_hoy,
}


def generar(nombre: str) -> list[dict]:
    with reloj_fijo():
        return COMPONENTES[nombre]()


def generar_crudo(nombre: str) -> list[dict]:
    """Los mismos escenarios, con la salida entera (texto incluido)."""
    global _transformar
    anterior, _transformar = _transformar, (lambda x: x)
    try:
        return generar(nombre)
    finally:
        _transformar = anterior
