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
from collections.abc import Iterator
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
        # Cada uno roza un umbral que los anteriores no tocaban (circulante,
        # capitalizado, extraordinarios, tipo fiscal, divergencia del FCF):
        # sin ellos, mover esos umbrales no cambiaba nada del golden.
        "circulante_normal": (_tres_ejercicios(change_receivables=-10.0, change_inventory=-5.0,
                                               change_payables=15.0), []),       # 12 % del CFO
        "circulante_aviso": (_tres_ejercicios(change_receivables=-40.0, change_inventory=-20.0,
                                              change_payables=15.0), []),       # 30 % del CFO
        "capitalizado_alto": (_tres_ejercicios(capitalized_software=66.0), []),   # 6 % de ingresos
        "capitalizado_bajo": (_tres_ejercicios(capitalized_software=44.0), []),   # 4 %
        "extraordinarios_altos": (_tres_ejercicios(restructuring=19.8, pretax_income=210.0,
                                                   income_tax=44.0), []),       # 12 % del beneficio
        "tipo_fiscal_bajo": (_tres_ejercicios(restructuring=3.3, pretax_income=180.0,
                                              income_tax=14.4), []),            # 8 %
        "fcf_diverge": (_tres_ejercicios(net_income=162.0, cfo=236.0), []),      # beneficio +8 %, FCF −7 %
    }
    return [_caso(k, cb.analizar(p, q, obtenido_en=ex.AHORA.isoformat())) for k, (p, q) in escenarios.items()]


def _tres_ejercicios(**ultimo) -> list[dict]:
    """2023-2025 con todas las partidas que miran las reglas; `ultimo` cambia el de 2025."""
    from tests.fakes_empresa import periodo

    comunes = dict(gross_profit=400.0, operating_income=200.0, eps_diluted=1.5, shares_outstanding=100.0,
                   cash=100.0, long_term_debt=300.0, short_term_debt=0.0, sbc=20.0, total_assets=2000.0,
                   accounts_receivable=100.0, inventory=80.0)
    return [
        periodo(2023, "2024-02-12", **comunes, revenue=900.0, net_income=150.0, cfo=240.0, capex=40.0),
        periodo(2024, "2025-02-12", **comunes, revenue=1000.0, net_income=155.0, cfo=245.0, capex=45.0),
        periodo(2025, "2026-02-10", **{**comunes, "revenue": 1100.0, "net_income": 165.0, "cfo": 250.0,
                                       "capex": 50.0, **ultimo}),
    ]


# --- Confianza por evidencia -------------------------------------------------------------------


def _analisis_para_confianza(**cambios) -> dict:
    """Un análisis mínimo con todos los factores en `ok`; cada caso mueve uno."""
    hace = lambda dias: (ex.AHORA.date() - timedelta(days=dias)).isoformat()  # noqa: E731
    a = {
        "faltan": [],
        "mercado": {"precio": {"estado": "valido", "fuente": "finnhub", "valor": 100.0},
                    "historico": {"fuente": "yfinance", "ultimo_cierre": 100.0, "sesiones": 250}},
        "fundamentales": {"trimestre": {"publicado": hace(30), "periodo": "2026-Q2"},
                          "publicado": hace(200), "ejercicio": "2025", "ejercicios_disponibles": 5},
        "valoracion": {"dcf_inverso": {"estado": "valido", "rango": {"bajo": 0.02, "alto": 0.07}}},
        "decision": {"cambiaria": [{"hacia": "vender", "condiciones": [
                         {"condicion": "puntuación", "distancia": 0.5, "unidad": "puntos"}]}],
                     "reglas": [{"regla": "precio", "resultado": "cumple"}], "confidence": "calibrada"},
        "resultados_proximos": None,
    }
    for ruta, valor in cambios.items():
        destino = a
        *padres, hoja = ruta.split("__")
        for p in padres:
            destino = destino[p]
        destino[hoja] = valor
    return a


def golden_confianza() -> list[dict]:
    """Los diez factores de `confianza.evaluar`, cada uno a ambos lados de su umbral.

    El análisis de empresa entero solo rozaba tres o cuatro (casi todo salía
    «desconocido»), así que mover DIAS_EJERCICIO_VIEJO o DESACUERDO_PRECIO no
    cambiaba el golden. Aquí cada umbral tiene un caso justo por debajo y otro
    justo por encima."""
    from app.analysis import confianza

    hace = lambda dias: (ex.AHORA.date() - timedelta(days=dias)).isoformat()  # noqa: E731
    sin_trimestre = {"fundamentales__trimestre": {}}
    cambio = lambda distancia, unidad: {"decision__cambiaria": [  # noqa: E731
        {"hacia": "vender", "condiciones": [{"condicion": "c", "distancia": distancia, "unidad": unidad}]}]}
    casos = {
        "todo_ok": {},
        **{f"faltan_{n}": {"faltan": [{"dato": f"d{i}"} for i in range(n)]} for n in (1, 3, 4)},
        "precio_viejo": {"mercado__precio": {"estado": "viejo", "fuente": "finnhub", "valor": 100.0}},
        "sin_precio": {"mercado__precio": {}},
        "trimestre_134_dias": {"fundamentales__trimestre": {"publicado": hace(134), "periodo": "2026-Q1"}},
        "trimestre_136_dias": {"fundamentales__trimestre": {"publicado": hace(136), "periodo": "2026-Q1"}},
        "ejercicio_454_dias": {**sin_trimestre, "fundamentales__publicado": hace(454)},
        "ejercicio_456_dias": {**sin_trimestre, "fundamentales__publicado": hace(456)},
        "sin_fechas": {**sin_trimestre, "fundamentales__publicado": None},
        "proveedores_9pct": {"mercado__historico__ultimo_cierre": 91.7},
        "proveedores_11pct": {"mercado__historico__ultimo_cierre": 90.0},
        "un_solo_proveedor": {"mercado__historico__fuente": "finnhub"},
        "historico_justo": {"fundamentales__ejercicios_disponibles": 3, "mercado__historico__sesiones": 200},
        "sesiones_199": {"fundamentales__ejercicios_disponibles": 3, "mercado__historico__sesiones": 199},
        "dos_ejercicios": {"fundamentales__ejercicios_disponibles": 2},
        "un_ejercicio": {"fundamentales__ejercicios_disponibles": 1},
        "dcf_estrecho": {"valoracion__dcf_inverso__rango": {"bajo": 0.02, "alto": 0.11}},
        "dcf_ancho": {"valoracion__dcf_inverso__rango": {"bajo": 0.02, "alto": 0.13}},
        "sin_dcf_inverso": {"valoracion__dcf_inverso": {"estado": "desconocido"}},
        "puntos_a_004": cambio(0.04, "puntos"),
        "puntos_a_006": cambio(0.06, "puntos"),
        "precio_a_09pct": cambio(0.9, "%"),
        "precio_a_11pct": cambio(1.1, "%"),
        "regla_sin_evaluar": {"decision__reglas": [{"regla": "precio", "resultado": "desconocido"}]},
        "resultados_en_3_dias": {"resultados_proximos": (ex.AHORA.date() + timedelta(days=3)).isoformat()},
        "reglas_refutadas": {"decision__confidence": "refutada"},
        "reglas_sin_calibrar": {"decision__confidence": "sin_calibrar"},
    }
    return [_caso(k, confianza.evaluar(_analisis_para_confianza(**v), ex.AHORA)) for k, v in casos.items()]


# --- Riesgo de cartera (contribución, clústeres, estrés) ---------------------------------------


def _serie_precios(retornos: list[float], hasta=None) -> list[tuple]:
    """Cierres diarios (sin fines de semana) que acaban `hasta`, desde un precio de 100."""
    fin = hasta or ex.AHORA.date() - timedelta(days=1)
    fechas, d = [], fin
    while len(fechas) < len(retornos) + 1:
        if d.weekday() < 5:
            fechas.append(d)
        d -= timedelta(days=1)
    fechas.reverse()
    precios, p = [], 100.0
    for i, f in enumerate(fechas):
        if i:
            p *= 1 + retornos[i - 1]
        precios.append((f, round(p, 6)))
    return precios


def _ruido(semilla: int, n: int) -> list[float]:
    import random

    r = random.Random(semilla)
    return [r.gauss(0, 0.01) for _ in range(n)]


def golden_riesgo_cartera() -> list[dict]:
    """Contribución al riesgo, clústeres, beta, riesgo de añadir, estrés con
    cobertura y peor ventana. Lo usan el análisis de empresa y el coste de
    oportunidad, pero con una sola posición en cartera nunca se medían parejas:
    los umbrales de clúster, beta, cobertura y observaciones mínimas no se veían."""
    from app.analysis import portfolio_risk as pr
    from app.analysis.sizing import peor_ventana

    n = 600
    m = _ruido(1, n)
    a = [1.4 * x + 0.3 * e for x, e in zip(m, _ruido(2, n))]           # beta ≈ 1,4
    b = [0.85 * x + 0.55 * e for x, e in zip(a, _ruido(3, n))]         # correlación con A ≈ 0,8
    c = [0.55 * x + 0.85 * e for x, e in zip(a, _ruido(4, n))]         # ≈ 0,55
    series = {"A": _serie_precios(a), "B": _serie_precios(b), "C": _serie_precios(c),
              "D": _serie_precios(_ruido(5, 41)), "E": _serie_precios(_ruido(6, 80))}
    mercado = _serie_precios(m)
    posiciones = [
        {"symbol": "A", "peso": 0.30, "sector": "Tech", "industria": "Chips", "moneda": "USD"},
        {"symbol": "B", "peso": 0.25, "sector": "Tech", "industria": "Software", "moneda": "USD"},
        {"symbol": "C", "peso": 0.20, "sector": "Energy", "industria": "Oil", "moneda": "CAD"},
        {"symbol": "D", "peso": 0.15, "sector": "Health", "industria": "Pharma", "moneda": "USD"},
        {"symbol": "Z", "peso": 0.10, "sector": "Utilities", "industria": "Power", "moneda": "USD"},
    ]
    sin_corta = [p for p in posiciones if p["symbol"] != "D"]
    # Crisis a medida dentro del histórico sintético: A, B y C la cubren; D, E y Z no.
    crisis = [{"clave": "prueba", "nombre": "n", "contexto": "c", "caida_sp500_pct": -20.0,
               "desde": series["A"][-300][0], "hasta": series["A"][-200][0]}]
    cobertura_45 = [{"symbol": "A", "peso_pct": 45.0}, {"symbol": "Z", "peso_pct": 55.0}]
    cobertura_55 = [{"symbol": "A", "peso_pct": 55.0}, {"symbol": "Z", "peso_pct": 45.0}]
    casos = {
        "contribucion|sin_corta": pr.contribucion_al_riesgo(sin_corta, series, mercado=mercado),
        "contribucion|con_corta": pr.contribucion_al_riesgo(posiciones, series, mercado=mercado),
        "contribucion|historia_80": pr.contribucion_al_riesgo(
            [{"symbol": "A", "peso": 0.5}, {"symbol": "E", "peso": 0.5}], series),
        "anadir_c": pr.riesgo_de_anadir(sin_corta[:2], series, "C", series["C"], 0.10),
        "estres|cobertura_45": pr.estres_en_crisis(cobertura_45, series, crisis),
        "estres|cobertura_55": pr.estres_en_crisis(cobertura_55, series, crisis),
        "peor_ventana": peor_ventana({"A": 0.6, "C": 0.4}, series),
        "peor_ventana|corta": peor_ventana({"E": 1.0}, series),
    }
    return [_caso(k, v) for k, v in casos.items()]


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
        # Dentro de la ventana de 14 días, pero fuera si se acortara a 7.
        "noticia_a_10_dias": {"ratios": ratios, "crecimiento": {"revenue_cagr": 0.03}, "noticias": [
            {"headline": "Investigan un fraude en Acme", "published_at": (ex.AHORA - timedelta(days=10)).isoformat()}]},
    }
    casos = [_caso(k, tw.vigilar(disparadores, d)) for k, d in datos.items()]
    # El ROIC calculado de verdad (con su tipo impositivo supuesto) frente a un
    # punto de tesis: con ratios ya hechos, ese supuesto no se veía.
    from app.analysis.fundamentals import derive_ratio_series

    roic = [{"kind": "metrica", "config": {"metrica": "roic", "op": op, "umbral": u}}
            for op, u in (("lt", 0.22), ("gt", 0.26))]
    casos.append(_caso("ratios_calculados_roic", tw.vigilar(roic, {
        "ratios": derive_ratio_series(_periodos_valoracion()), "crecimiento": {}, "noticias": []})))
    return casos


# --- Análisis de empresa (decisión, confianza, riesgo, oportunidad, valoración, tesis) ---------

COMBINACIONES = [(e, "vacia") for e in ex.EMPRESAS] + [
    ("completa", "una_posicion"), ("completa", "cad_en_usd"), ("completa", "fx_invertido"),
    ("deuda_parcial", "una_posicion"), ("no_sec", "cad_en_usd"), ("no_sec", "fx_invertido"),
    ("stop_perforado", "con_stop_perforado"), ("todo_ausente", "una_posicion"),
]


def golden_analisis() -> Iterator[dict]:
    from app import analisis_empresa

    for empresa, cartera in COMBINACIONES:
        sv, symbol = ex.montar_empresa(empresa)
        with _fabrica()() as s:
            ex.montar_cartera(cartera, s, sv)
            if empresa in ("completa", "deuda_parcial"):
                ex.tesis_con_punto(s, symbol)
            a = analisis_empresa.analizar(symbol, sv, s, ahora=ex.AHORA, con_pares=False)
        yield _caso(f"{empresa}|{cartera}", a)
    yield from _analisis_al_borde(analisis_empresa)


def _analisis_al_borde(analisis_empresa) -> Iterator[dict]:
    """Ventanas del análisis que el paquete de extremos no rozaba: resultados a
    cinco días (dentro de la ventana de 7) y noticias a 10 y 20 días (la de 14)."""
    def resultados(sv, symbol, s):
        sv.calendario = [{"symbol": symbol, "date": (ex.AHORA.date() + timedelta(days=5)).isoformat()}]

    def noticias(sv, symbol, s):
        sv.noticias[symbol] = [
            {"headline": "Acme presenta producto", "published_at": (ex.AHORA - timedelta(days=d)).isoformat()}
            for d in (10, 20)]

    for nombre, cartera, preparar in (("resultados_en_5_dias", "vacia", resultados),
                                      ("noticias_a_10_y_20_dias", "vacia", noticias)):
        sv, symbol = ex.montar_empresa("completa")
        with _fabrica()() as s:
            ex.montar_cartera(cartera, s, sv)
            preparar(sv, symbol, s)
            a = analisis_empresa.analizar(symbol, sv, s, ahora=ex.AHORA, con_pares=False)
        yield _caso(f"completa|{cartera}|{nombre}", a)


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


def golden_dcf_ficha() -> Iterator[dict]:
    for k, periodos in VARIANTES_DCF.items():
        with _cliente(_ServicioValoracion(periodos)) as c:
            d = c.get("/api/stocks/AAPL/valuation/defaults")
            yield _caso(f"{k}|defaults", {"status": d.status_code, "json": d.json()})
            for deuda in (None, 0.0, 1500e6):
                cuerpo = {"base_fcf": 1000e6, "years": 5, "net_debt": deuda, "shares_outstanding": 100e6,
                          "scenarios": ESCENARIOS_FICHA}
                r = c.post("/api/stocks/AAPL/valuation/dcf", json=cuerpo)
                yield _caso(f"{k}|dcf|deuda={deuda}", {"status": r.status_code, "json": r.json()})


def golden_dcf_modulo() -> Iterator[dict]:
    for k, periodos in VARIANTES_DCF.items():
        for precio in (120.0, None):
            with _cliente(_ServicioValoracion(periodos, precio)) as c:
                r = c.post("/api/valuation/AAPL", json=None)
                yield _caso(f"{k}|precio={precio}", {"status": r.status_code, "json": r.json()})
                r = c.post("/api/valuation/AAPL", json={"net_debt": 0.0})
                yield _caso(f"{k}|precio={precio}|deuda_tuya", {"status": r.status_code, "json": r.json()})
    # Un precio tan bajo que el DCF inverso pide una caída del FCF fuera de su rango,
    # y un solo ejercicio (sin crecimiento medible: entra el supuesto declarado).
    for k, periodos, precio in (("base", VARIANTES_DCF["base"], 3.0),
                                ("un_ejercicio", _periodos_valoracion()[-1:], 120.0)):
        with _cliente(_ServicioValoracion(periodos, precio)) as c:
            r = c.post("/api/valuation/AAPL", json=None)
            yield _caso(f"{k}|precio={precio}", {"status": r.status_code, "json": r.json()})


# --- Lista diaria -----------------------------------------------------------------------------


class _ListaHistorialesDistintos(ex.ServicioLista):
    """Históricos de longitud distinta (240 y 270 sesiones frente a 251): la
    correlación entre candidatas descarta los que se alejan más de un 5 % de la
    mediana. Con todos iguales, esa tolerancia no se veía."""

    def _precio(self, i: int, s: str) -> dict:
        return {**super()._precio(i, s), "points": (251, 240, 270)[i % 3]}


def golden_hoy() -> Iterator[dict]:
    from app.routers.signals import _today

    variantes = [(caso, False) for caso in ex.LISTAS] + [("dia_sin_candidatas", True), ("dia_completo_502", True),
                                                       ("historiales_distintos", False)]
    for caso, con_cartera in variantes:
        sv = _ListaHistorialesDistintos() if caso == "historiales_distintos" else ex.servicio_lista(caso)
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
        yield _caso(f"{caso}|cartera" if con_cartera else caso, compacta)
    yield from _conviccion_al_borde()


def _conviccion_al_borde() -> Iterator[dict]:
    """La convicción de una idea a ambos lados de «un factor rema en contra»
    (−0,5). En la lista sintética las ideas tienen todos los factores a favor."""
    from app.analysis.shortlist import conviccion

    for en_contra in (-0.2, -0.45, -0.55, -1.1):
        senal = {"score": 0.5, "families": {"value": 1.2, "quality": 0.8, "momentum": en_contra},
                 "decision": {"levels": {"stop_pct": 9.0}}}
        yield _caso(f"conviccion|momentum={en_contra}", conviccion(senal))


COMPONENTES = {
    "decide": golden_decide,
    "sizing": golden_sizing,
    "oportunidad": golden_oportunidad,
    "calidad": golden_calidad,
    "confianza": golden_confianza,
    "riesgo_cartera": golden_riesgo_cartera,
    "tesis": golden_tesis,
    "analisis": golden_analisis,
    "dcf_ficha": golden_dcf_ficha,
    "dcf_modulo": golden_dcf_modulo,
    "hoy": golden_hoy,
}


def generar(nombre: str) -> list[dict]:
    return list(generar_perezoso(nombre))


def generar_perezoso(nombre: str) -> Iterator[dict]:
    """Caso a caso, con el reloj congelado mientras se consumen: el test de
    sensibilidad para en el primero que cambia en vez de calcularlos todos."""
    with reloj_fijo():
        yield from COMPONENTES[nombre]()


def generar_crudo(nombre: str) -> list[dict]:
    """Los mismos escenarios, con la salida entera (texto incluido)."""
    global _transformar
    anterior, _transformar = _transformar, (lambda x: x)
    try:
        return generar(nombre)
    finally:
        _transformar = anterior
