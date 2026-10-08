"""Inventario de los umbrales del motor y cómo moverlos «a mano» desde un test.

El criterio de hecho del golden (ítem 0.3) es que falle si alguien mueve
CUALQUIER umbral. La primera versión lo comprobaba con una lista escrita a mano
de los umbrales que sí veía, así que no podía decir cuáles no veía: la revisión
de la fase encontró catorce (confianza y calidad de beneficios) que se podían
doblar o partir por la mitad sin que el golden cambiara.

Ahora el inventario sale del código: toda constante numérica en MAYÚSCULAS
asignada en un módulo del motor. Cada una está o en `UMBRALES` (con el valor
movido y el componente del golden que tiene que cambiar) o en `EXENTOS` (con el
motivo por el que no es una decisión). Una constante nueva que no esté en
ninguna de las dos hace fallar `test_golden.py`.

`mover()` imita una edición del fichero: cambia la constante en su módulo, en
los módulos que la importaron por nombre y en los parámetros de función que la
usan como valor por defecto (`max_sector_pct: float = MAX_POR_SECTOR_PCT`),
que de otro modo conservarían el valor de cuando se importó el módulo.
"""

from __future__ import annotations

import ast
import contextlib
import functools
import importlib
import inspect
import sys

# Los módulos que deciden algo: qué hacer (decide), cuánto (sizing), con qué
# confianza, qué cambiar por qué (coste de oportunidad), la calidad del
# beneficio, la tesis, los dos DCF, la lista diaria y el riesgo de cartera que
# todos ellos leen.
MOTOR = (
    "app.analysis.decision", "app.analysis.sizing", "app.analysis.confianza",
    "app.analysis.coste_de_oportunidad", "app.analysis.calidad_beneficios", "app.analysis.thesis_watch",
    "app.analysis.valuation", "app.analysis.reverse_dcf", "app.analysis.signal", "app.analysis.factors",
    "app.analysis.markets", "app.analysis.shortlist", "app.analysis.portfolio_risk", "app.analysis.fx",
    "app.analysis.risk_budget", "app.analysis.rule_backtest", "app.analysis.fundamentals",
    "app.analisis_empresa", "app.routers.signals", "app.routers.valuation",
)


def _numerico(v) -> bool:
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, tuple):
        return bool(v) and all(_numerico(e) for e in v)
    if isinstance(v, dict):
        return bool(v) and all(_numerico(e) for e in v.values())
    return False


def constantes(modulo) -> list[str]:
    """Las constantes numéricas en MAYÚSCULAS asignadas EN este módulo (no las importadas)."""
    nombres = []
    for nodo in ast.parse(inspect.getsource(modulo)).body:
        if isinstance(nodo, (ast.Assign, ast.AnnAssign)):
            for t in nodo.targets if isinstance(nodo, ast.Assign) else [nodo.target]:
                if isinstance(t, ast.Name) and t.id.isupper() and _numerico(getattr(modulo, t.id, None)):
                    nombres.append(t.id)
    return nombres


def inventario() -> list[str]:
    return [f"{m}.{c}" for m in MOTOR for c in constantes(importlib.import_module(m))]


def _arbol(mod):
    return _arbol_de(mod.__name__)


@functools.cache
def _arbol_de(nombre: str):
    try:
        return ast.parse(inspect.getsource(sys.modules[nombre]))
    except (OSError, TypeError):
        return None


def _modulos_con_el_nombre(nombre_modulo: str, nombre: str):
    """El módulo que define la constante y los que la importan POR NOMBRE de él.

    Se mira el `import`, no el valor: dos constantes distintas que valen 14
    son el mismo objeto en CPython, y moverlas juntas no es editar un literal."""
    for k, mod in list(sys.modules.items()):
        if not k.startswith("app") or mod is None:
            continue
        if k == nombre_modulo:
            yield mod
            continue
        arbol = _arbol(mod)
        # Solo los import del nivel del módulo: uno dentro de una función lee el
        # valor del módulo de origen al ejecutarse, y ya está movido allí.
        if arbol and any(isinstance(n, ast.ImportFrom) and n.module == nombre_modulo
                         and any(a.name == nombre and a.asname is None for a in n.names)
                         for n in arbol.body):
            yield mod


def _usos_por_defecto(mod, nombre: str):
    """(función, dónde) de cada parámetro de `mod` cuyo valor por defecto es la constante `nombre`."""
    arbol = _arbol(mod)
    for nodo in ast.walk(arbol) if arbol else ():
        if not isinstance(nodo, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        f = vars(mod).get(nodo.name)
        if not callable(f) or getattr(f, "__module__", None) != mod.__name__ or not hasattr(f, "__defaults__"):
            continue
        for i, d in enumerate(nodo.args.defaults):
            if isinstance(d, ast.Name) and d.id == nombre:
                yield f, ("pos", len(f.__defaults__) - len(nodo.args.defaults) + i)
        for a, d in zip(nodo.args.kwonlyargs, nodo.args.kw_defaults):
            if isinstance(d, ast.Name) and d.id == nombre:
                yield f, ("kw", a.arg)


@contextlib.contextmanager
def mover(ruta: str, valor):
    """Como editar el literal de `ruta` («app.analysis.sizing.MAX_POR_SECTOR_PCT») y reimportar."""
    nombre_modulo, nombre = ruta.rsplit(".", 1)
    importlib.import_module(nombre_modulo)
    deshacer = []
    try:
        for mod in list(_modulos_con_el_nombre(nombre_modulo, nombre)):
            deshacer.append((mod, nombre, getattr(mod, nombre)))
            setattr(mod, nombre, valor)
            for f, (tipo, k) in _usos_por_defecto(mod, nombre):
                if tipo == "pos":
                    deshacer.append((f, "__defaults__", f.__defaults__))
                    defectos = list(f.__defaults__)
                    defectos[k] = valor
                    f.__defaults__ = tuple(defectos)
                else:
                    deshacer.append((f, "__kwdefaults__", dict(f.__kwdefaults__)))
                    f.__kwdefaults__ = {**f.__kwdefaults__, k: valor}
        yield
    finally:
        for objeto, atributo, anterior in reversed(deshacer):
            setattr(objeto, atributo, anterior)


# Cada umbral cubierto: el valor movido (el doble o la mitad, o una tabla
# distinta) y el componente del golden que tiene que cambiar al moverlo.
UMBRALES: dict[str, list[tuple[object, str]]] = {
    "app.analysis.decision.RIESGO_POR_OPERACION": [(0.02, "decide")],
    "app.analysis.decision.STOP_VOLATILIDADES": [(4.0, "decide")],
    # Los dos extremos de la tabla de stops, por separado.
    "app.analysis.decision.TOPES_STOP": [
        ({"accion": (9.0, 25.0), "cripto": (15.0, 60.0), "etf": (6.0, 20.0)}, "decide"),
        ({"accion": (8.0, 25.0), "cripto": (15.0, 50.0), "etf": (6.0, 20.0)}, "decide"),
    ],
    "app.analysis.decision.RATIO_OBJETIVO": [(2.5, "decide")],
    "app.analysis.decision.BANDA_ENTRADA_PCT": [(4.0, "decide")],
    "app.analysis.decision.BANDA_TENDENCIA_ENTRAR_PCT": [(3.0, "decide")],
    "app.analysis.decision.BANDA_TENDENCIA_SALIR_PCT": [(2.0, "decide")],
    "app.analysis.decision.SESIONES_MES": [(42, "decide")],
    "app.analysis.sizing.MAX_POR_POSICION_PCT": [(20.0, "sizing")],
    "app.analysis.sizing.MAX_POR_SECTOR_PCT": [(50.0, "sizing")],
    "app.analysis.sizing.MAX_POR_CLUSTER_PCT": [(50.0, "sizing")],
    "app.analysis.sizing.UMBRAL_CORRELACION": [(1.4, "sizing")],
    "app.analysis.sizing.OBJETIVO_VOL_ANUAL_PCT": [(24.0, "sizing")],
    "app.analysis.sizing.VOL_SUPUESTA_PCT": [(70.0, "sizing")],
    "app.analysis.sizing.FACTOR_EVIDENCIA_BAJA": [(0.6, "sizing")],
    "app.analysis.sizing.CORRELACION_SUPUESTA": [(1.0, "sizing")],
    "app.analysis.sizing.VENTANA_ESTRES_MESES": [(24, "riesgo_cartera")],
    "app.analysis.confianza.MAX_DESCONOCIDOS_OK": [(1, "confianza")],
    "app.analysis.confianza.MAX_DESCONOCIDOS_DEBIL": [(6, "confianza"), (0, "analisis")],
    "app.analysis.confianza.DIAS_TRIMESTRE_VIEJO": [(270, "confianza")],
    "app.analysis.confianza.DIAS_EJERCICIO_VIEJO": [(910, "confianza")],
    "app.analysis.confianza.DESACUERDO_PRECIO": [(0.2, "confianza")],
    "app.analysis.confianza.MIN_EJERCICIOS": [(6, "confianza")],
    "app.analysis.confianza.MIN_SESIONES": [(400, "confianza")],
    "app.analysis.confianza.AMPLITUD_DCF_INVERSO": [(0.2, "confianza")],
    "app.analysis.confianza.CERCA_UMBRAL_PUNTOS": [(0.1, "confianza")],
    "app.analysis.confianza.CERCA_UMBRAL_PRECIO_PCT": [(2.0, "confianza")],
    "app.analysis.coste_de_oportunidad.MEJORA_MINIMA": [(4, "oportunidad")],
    "app.analysis.coste_de_oportunidad.COSTE_POR_PUNTO_PCT": [(2.0, "oportunidad")],
    "app.analysis.coste_de_oportunidad.TENENCIA_MINIMA_DIAS": [(5, "oportunidad")],
    "app.analysis.coste_de_oportunidad.PUNTOS_PRUDENCIA_IMPUESTOS": [(2, "oportunidad")],
    "app.analysis.coste_de_oportunidad.BANDA_REBALANCEO_PCT": [(4.0, "oportunidad")],
    "app.analysis.coste_de_oportunidad.CORRELACION_ALTA": [(1.4, "oportunidad")],
    "app.analysis.coste_de_oportunidad.ATRACTIVO_SENAL": [
        ({"comprar": 4, "vigilar": 2, "mantener": 1, "ninguna": 1, "reducir": 0, "vender": 0, "evitar": 0},
         "oportunidad")],
    "app.analysis.coste_de_oportunidad.ATRACTIVO_TESIS": [
        ({"intacta": 2, "sin_puntos": 1, "sin_comprobar": 1, "sin_tesis": 1, "puntos_cruzados": 0}, "oportunidad")],
    "app.analysis.coste_de_oportunidad.ATRACTIVO_VALORACION": [({"barata": 2, "razonable": 1, "cara": 0},
                                                                "oportunidad")],
    "app.analysis.coste_de_oportunidad.ATRACTIVO_CONFIANZA": [({"alta": 2, "media": 1, "baja": 0}, "oportunidad")],
    "app.analysis.coste_de_oportunidad.PRIORIDAD_SENAL": [({"vender": 6, "reducir": 4}, "oportunidad")],
    "app.analysis.coste_de_oportunidad.PRIORIDAD_TESIS": [({"puntos_cruzados": 6, "sin_comprobar": 2, "sin_tesis": 2},
                                                           "oportunidad")],
    "app.analysis.coste_de_oportunidad.PRIORIDAD_VALORACION": [({"cara": 4, "barata": 0}, "oportunidad")],
    "app.analysis.calidad_beneficios.CFO_NI_BUENO": [(1.5, "calidad")],
    "app.analysis.calidad_beneficios.CFO_NI_AVISO": [(1.6, "calidad")],
    "app.analysis.calidad_beneficios.FCF_NI_DEBIL": [(1.2, "calidad")],
    "app.analysis.calidad_beneficios.ACCRUALS_NORMAL": [(0.1, "calidad")],
    "app.analysis.calidad_beneficios.ACCRUALS_AVISO": [(0.2, "calidad")],
    "app.analysis.calidad_beneficios.BRECHA_CIRCULANTE_NORMAL": [(0.1, "calidad")],
    "app.analysis.calidad_beneficios.BRECHA_CIRCULANTE_AVISO": [(0.2, "calidad")],
    "app.analysis.calidad_beneficios.SBC_NORMAL": [(0.01, "calidad")],
    "app.analysis.calidad_beneficios.SBC_AVISO": [(0.2, "calidad")],
    "app.analysis.calidad_beneficios.CIRCULANTE_EN_CFO_NORMAL": [(0.2, "calidad")],
    "app.analysis.calidad_beneficios.CIRCULANTE_EN_CFO_AVISO": [(0.5, "calidad")],
    "app.analysis.calidad_beneficios.CAPITALIZADO_AVISO": [(0.1, "calidad")],
    "app.analysis.calidad_beneficios.EXTRAORDINARIOS_AVISO": [(0.2, "calidad")],
    "app.analysis.calidad_beneficios.TIPO_FISCAL_BAJO": [(0.05, "calidad")],
    "app.analysis.calidad_beneficios.DIVERGENCIA_FCF": [(0.1, "calidad")],
    "app.analysis.thesis_watch.DIAS_NOTICIAS": [(7, "tesis")],
    "app.analysis.valuation.BANDA_CRECIMIENTO": [(0.04, "dcf_modulo")],
    "app.analysis.valuation.BANDA_DESCUENTO": [(0.02, "dcf_modulo")],
    "app.analysis.valuation.CIFRAS_SIGNIFICATIVAS": [(6, "dcf_modulo")],
    "app.analysis.reverse_dcf.CRECIMIENTO_MIN": [(-1.0, "dcf_modulo")],
    "app.analysis.reverse_dcf.CRECIMIENTO_MAX": [(0.3, "analisis")],
    "app.analysis.reverse_dcf.DESCUENTOS_CURVA": [((0.14, 0.16, 0.18, 0.2, 0.22, 0.24), "dcf_modulo")],
    "app.analysis.signal.FAVORABLE_MIN": [(0.5, "hoy"), (0.7, "analisis")],
    "app.analysis.signal.UNFAVORABLE_MAX": [(-0.7, "hoy")],
    # Escalar todos los pesos por igual no cambia una media ponderada: se reparten distinto.
    "app.analysis.factors.DEFAULT_WEIGHTS": [({"value": 0.6, "quality": 0.2, "momentum": 0.1, "sentiment": 0.1},
                                              "hoy")],
    "app.analysis.markets.MIN_SECTOR_SIZE": [(2, "hoy")],
    "app.analysis.shortlist.MAX_IDEAS": [(10, "hoy")],
    "app.analysis.shortlist.MAX_POR_SECTOR": [(4, "hoy")],
    "app.analysis.shortlist.MAX_EVITAR": [(10, "hoy")],
    "app.analysis.shortlist.FACTOR_EN_CONTRA": [(-1.0, "hoy")],
    "app.analysis.portfolio_risk.COBERTURA_MINIMA": [(0.25, "riesgo_cartera")],
    "app.analysis.portfolio_risk.MIN_OBSERVACIONES": [(80, "riesgo_cartera")],
    "app.analysis.portfolio_risk.VENTANA_CORRELACION": [(252, "riesgo_cartera")],
    "app.analysis.portfolio_risk.PUNTOS_CURVA": [(120, "riesgo_cartera")],
    "app.analysis.portfolio_risk.SESIONES_ANO": [(504, "riesgo_cartera")],
    "app.analysis.portfolio_risk.UMBRAL_CLUSTER_CORRELACION": [(1.4, "riesgo_cartera")],
    "app.analysis.portfolio_risk.UMBRAL_BETA_ALTA": [(0.65, "riesgo_cartera")],
    "app.analysis.fx.BANDAS_POR_USD": [({"CAD": (1.8, 4.4), "EUR": (1.0, 3.6), "GBP": (0.8, 3.0), "AUD": (1.6, 5.0),
                                         "CHF": (1.0, 4.0), "JPY": (120.0, 800.0), "MXN": (16.0, 120.0),
                                         "SEK": (10.0, 40.0), "NOK": (10.0, 40.0), "DKK": (8.0, 24.0),
                                         "HKD": (12.0, 18.0), "SGD": (2.0, 4.4), "CNY": (10.0, 20.0),
                                         "INR": (80.0, 300.0), "BRL": (3.0, 24.0), "KRW": (1400.0, 5000.0)},
                                        "analisis")],
    "app.analysis.rule_backtest.COMISION_PCT": [(0.2, "analisis")],
    "app.analysis.rule_backtest.HORQUILLA_PCT": [(0.06, "analisis")],
    "app.analysis.rule_backtest.DESLIZAMIENTO_PCT": [(0.04, "analisis")],
    "app.analysis.fundamentals.ROIC_TAX_RATE": [(0.42, "tesis")],
    "app.analisis_empresa.ESQUEMA": [(4, "analisis")],
    "app.analisis_empresa.DESCUENTO_BASE": [(0.18, "analisis")],
    "app.analisis_empresa.TERMINAL_BASE": [(0.05, "analisis")],
    "app.analisis_empresa.ANOS_DCF": [(10, "analisis")],
    "app.analisis_empresa.DIAS_RESULTADOS": [(4, "analisis")],
    "app.analisis_empresa.DIAS_NOTICIAS": [(28, "analisis")],
    "app.routers.signals.SPARK_MIN_PUNTOS": [(42, "hoy")],
    "app.routers.signals.TOLERANCIA_HISTORIAL": [(0.025, "hoy")],
    "app.routers.valuation.FACTOR_CRECIMIENTO": [({"bajista": 0.8, "base": 2.0, "alcista": 3.0}, "dcf_modulo")],
    "app.routers.valuation.DESCUENTO": [({"bajista": 0.22, "base": 0.18, "alcista": 0.16}, "dcf_modulo")],
    "app.routers.valuation.TERMINAL": [({"bajista": 0.03, "base": 0.05, "alcista": 0.06}, "dcf_modulo")],
    "app.routers.valuation.CRECIMIENTO_SUPUESTO": [(0.06, "dcf_modulo")],
    "app.routers.valuation.CRECIMIENTO_MAXIMO": [(0.075, "dcf_modulo")],
}

# Lo que no es una decisión, o no la ve el golden por una razón dicha aquí.
_BACKTEST = ("parámetro del backtest de reglas, que se ejecuta aparte (botón en Señales) y se guarda; "
             "el análisis lee ese resultado guardado, no lo recalcula")
EXENTOS: dict[str, str] = {
    "app.analysis.decision.STOP_MIN_PCT": "se copia en TOPES_STOP al importar: lo que se lee es la tabla (cubierta)",
    "app.analysis.decision.STOP_MAX_PCT": "se copia en TOPES_STOP al importar: lo que se lee es la tabla (cubierta)",
    "app.analysis.sizing.SESIONES_ANO": "sin uso en sizing: la anualización vive en portfolio_risk (cubierta)",
    "app.analysis.calidad_beneficios.FCF_NI_FUERTE": "solo lo lee el informe narrativo (deep_dive) para un adjetivo",
    "app.analysis.reverse_dcf.ITERACIONES": "precisión de la bisección: con 30 o 120 el resultado a 6 decimales no cambia",
    "app.analysis.signal.MIN_OBSERVATIONS": "fiabilidad de la calibración del historial de puntuaciones, no una decisión",
    "app.analysis.fx.DIAS_FRESCO": "solo decide un aviso de texto y una comprobación de coherencia, ninguna cifra",
    "app.analysis.risk_budget.HEAT_MAXIMO_PCT": "presupuesto de riesgo de la página de cartera: avisa, no recorta",
    "app.analysis.risk_budget.HEAT_GRUPO_MAXIMO_PCT": "presupuesto de riesgo de la página de cartera: avisa, no recorta",
    "app.analysis.rule_backtest.DIVISA_PCT": (
        "mismo camino que COMISION_PCT (cubierto), pero solo se suma con una candidata en otra moneda que llega "
        "a comparar con la cartera; el paquete de extremos aún no tiene ese caso"),
    "app.analysis.rule_backtest.MAX_SESIONES": _BACKTEST,
    "app.analysis.rule_backtest.SESIONES_SMA": _BACKTEST,
    "app.analysis.rule_backtest.MIN_BARRAS_VOL": _BACKTEST,
    "app.analysis.rule_backtest.MIN_OPERACIONES_VENTANA": _BACKTEST,
    "app.analysis.rule_backtest.MIN_PARA_FORMA": _BACKTEST,
    "app.analysis.rule_backtest.ANCHOS_BONITOS": _BACKTEST,
    "app.analisis_empresa.MAX_NOTICIAS": "cuántos titulares se muestran: presentación",
    "app.analisis_empresa.MAX_CUERPO_TESIS": "dónde se trunca el texto de la tesis: presentación",
    "app.routers.signals.MAX_UNIVERSE": "tope de coste de llamadas, no una decisión",
    "app.routers.signals.DEFAULT_FETCH_BUDGET": "tope de coste de llamadas, no una decisión",
    "app.routers.valuation.MAX_PARES": "cuántos comparables se piden: tope de coste",
    "app.routers.valuation.ANOS": (
        "valor por defecto de un campo de la petición (se fija al definir el modelo y no se puede mover en "
        "caliente); comprobado a mano: con ANOS = 10, dcf_modulo cambia"),
}
