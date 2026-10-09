"""Cómo se llama cada código para una persona (ítem 1.8, V6).

La pantalla enseñaba los identificadores tal cual: «sin_datos», «comprar →
sin_datos», «analisis:03:09:37», «Mejor prevista: revenue», «eps_diluted,
gross_margin…» o el chip «correlacion» sin tilde. Un código es para el código;
a una persona se le enseña su etiqueta.

Este es el ÚNICO diccionario. El frontend usa una copia exportada
(`frontend/src/lib/etiquetas.json`, `python -m app.etiquetas`) y un test
comprueba que está al día, así que no hay dos versiones que puedan divergir.
Las etiquetas van como se escriben en mitad de una frase («margen bruto»); con
`mayuscula=True`, como encabezado («Margen bruto»). Los términos siguen
`docs/GLOSARIO.md`: «BPA», nunca «EPS».

Un código sin etiqueta nunca sale en crudo: se escribe legible («algo_nuevo» →
«algo nuevo») y se avisa en el registro, para añadirlo aquí.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from app.analysis.decision import ACCIONES
from app.analysis.markets import MARKETS
from app.registro import log

_BASE: dict[str, str] = {
    # --- Veredictos del coste de oportunidad ---
    "NO_ACCION": "no hacer nada",
    "COMPRAR_CON_EFECTIVO": "comprar con efectivo",
    "REVISAR_PARA_FINANCIAR": "revisar para financiar",
    "NO_TRADE": "no operar",
    "INDETERMINADO": "indeterminado",
    # --- Lo que anota la persona en su diario (además de las acciones del motor) ---
    "reforzar": "reforzar",
    "descartar": "descartar",
    # Una sigla se deja como está («BPA», «EBITDA»), salvo la que el glosario prohíbe.
    "EPS": "BPA",
    # --- Estados ---
    "aviso": "aviso",
    "bueno": "bueno",
    "normal": "normal",
    "desconocido": "desconocido",
    "desconocidos": "desconocidos",
    "estimados": "estimados",
    "ok": "bien",
    "debil": "débil",
    "critico": "crítico",
    "intacta": "intacta",
    "valido": "válido",
    "viejo": "viejo",
    "sin_cartera": "sin cartera",
    "sin_eventos": "sin eventos",
    "sin_resolver": "sin resolver",
    "sin_tesis": "sin tesis",
    "puntos_cruzados": "puntos cruzados",
    "invalidado": "invalidado",
    "debilitado": "debilitado",
    "confirmado": "confirmado",
    "dato_perdido": "dato perdido",
    "solida": "sólida",
    "precaucion": "precaución",
    "cumple": "cumple",
    "no_cumple": "no cumple",
    # --- Métricas y datos ---
    "revenue": "ingresos",
    "ingresos": "ingresos",
    "ingresos_anterior": "ingresos del año anterior",
    "revenue_growth": "crecimiento de ingresos",
    "revenue_cagr": "crecimiento anual de ingresos",
    "revenue_growth_5y": "crecimiento de ingresos a 5 años",
    "eps_diluted": "BPA diluido",
    "eps_growth_5y": "crecimiento del BPA a 5 años",
    "gross_margin": "margen bruto",
    "operating_margin": "margen operativo",
    "net_margin": "margen neto",
    "fcf_margin": "margen de FCF",
    "net_income": "beneficio neto",
    "beneficio_neto": "beneficio neto",
    "beneficio_bruto": "beneficio bruto",
    "resultado_operativo": "resultado operativo",
    "fcf": "flujo de caja libre",
    "fcf_growth": "crecimiento del FCF",
    "cfo": "flujo de caja operativo",
    "cfo_anterior": "flujo de caja operativo del año anterior",
    "capex": "capex",
    "capex_anterior": "capex del año anterior",
    "deuda_neta": "deuda neta",
    "net_debt": "deuda neta",
    "caja": "caja",
    "deuda_corto": "deuda a corto plazo",
    "deuda_largo": "deuda a largo plazo",
    "short_term_debt": "deuda a corto plazo",
    "long_term_debt": "deuda a largo plazo",
    "debt_to_equity": "deuda/capital",
    "interest_coverage": "cobertura de intereses",
    "current_ratio": "ratio corriente",
    "asset_turnover": "rotación de activos",
    "roe": "ROE",
    "roic": "ROIC",
    "pe": "P/E",
    "pe_ttm": "P/E (TTM)",
    "pb": "P/B",
    "ps_ttm": "P/S",
    "fcf_yield": "rentabilidad por FCF",
    "dividend_yield": "rentabilidad por dividendo",
    "beta": "beta",
    "market_cap": "capitalización",
    "vol_anual_pct": "volatilidad anual",
    "precio": "precio",
    # --- Supuestos del DCF ---
    "base_fcf": "FCF de partida",
    "discount_rate": "tasa de descuento",
    "growth_rate": "crecimiento",
    "terminal_growth": "crecimiento terminal",
    # --- Familias de factores ---
    "value": "valor",
    "quality": "calidad",
    "momentum": "momentum",
    "sentiment": "sentimiento",
    "growth": "crecimiento",
    "low_volatility": "baja volatilidad",
    "size": "tamaño",
    # --- Calidad de beneficios ---
    "conversion_caja": "conversión a caja",
    "accruals": "devengos (accruals)",
    "cuentas_por_cobrar": "cuentas por cobrar",
    "inventario": "inventario",
    "sbc": "compensación en acciones",
    "capital_circulante": "capital circulante",
    "costes_capitalizados": "costes capitalizados",
    "extraordinarios": "partidas no recurrentes",
    "calidad_fcf": "calidad del FCF",
    "impuestos": "impuestos",
    # Las partidas de cada evidencia (sus claves salían tal cual: «cfo inicio»,
    # «change receivables»; revisión de la Fase 1).
    "activos": "activos totales",
    "activos_anterior": "activos totales del año anterior",
    "beneficio_antes_impuestos": "beneficio antes de impuestos",
    "impuesto": "impuesto sobre beneficios",
    "beneficio_inicio": "beneficio neto al inicio del periodo",
    "beneficio_fin": "beneficio neto al final del periodo",
    "cfo_inicio": "flujo de caja operativo al inicio del periodo",
    "cfo_fin": "flujo de caja operativo al final del periodo",
    "capex_inicio": "capex al inicio del periodo",
    "capex_fin": "capex al final del periodo",
    "capitalizado": "software capitalizado",
    "change_receivables": "variación de cuentas por cobrar",
    "change_inventory": "variación de inventario",
    "change_payables": "variación de proveedores",
    # La clave se arma con el nombre de la partida («cuentas por cobrar») y está
    # congelada en el golden: se etiqueta tal cual.
    "cuentas por cobrar_anterior": "cuentas por cobrar del año anterior",
    "inventario_anterior": "inventario del año anterior",
    "deterioros": "deterioros",
    "litigios": "litigios",
    "reestructuracion": "reestructuración",
    "venta_de_activos": "venta de activos",
    # --- Componentes de la Z de Altman ---
    "x1_working_capital_over_assets": "capital circulante / activos",
    "x2_retained_earnings_over_assets": "beneficios retenidos / activos",
    "x3_ebit_over_assets": "EBIT / activos",
    "x4_market_cap_over_liabilities": "capitalización / pasivos",
    "x5_sales_over_assets": "ventas / activos",
    # --- Eventos de noticias (los clasifica la IA) ---
    "guidance_al_alza": "guidance al alza",
    "guidance_a_la_baja": "guidance a la baja",
    "resultados_mejor_de_lo_esperado": "resultados mejores de lo esperado",
    "resultados_peor_de_lo_esperado": "resultados peores de lo esperado",
    "riesgo_regulatorio_o_legal": "riesgo regulatorio o legal",
    "cambio_en_la_direccion": "cambio en la dirección",
    "operacion_corporativa": "operación corporativa",
    "recompra_o_dividendo_al_alza": "recompra o dividendo al alza",
    "dilucion_o_ampliacion_de_capital": "dilución o ampliación de capital",
    "irrelevante_para_la_tesis": "irrelevante para la tesis",
    # --- Sectores de un ETF (claves de yfinance) ---
    "realestate": "inmobiliario",
    "consumer_cyclical": "consumo cíclico",
    "basic_materials": "materiales básicos",
    "consumer_defensive": "consumo defensivo",
    "technology": "tecnología",
    "communication_services": "servicios de comunicación",
    "financial_services": "servicios financieros",
    "utilities": "servicios públicos",
    "industrials": "industria",
    "energy": "energía",
    "healthcare": "salud",
    # --- Secciones y categorías ---
    "decision": "decisión",
    "mercado": "mercado",
    "valoracion": "valoración",
    "fundamentales": "fundamentales",
    "resultados": "resultados",
    "riesgo": "riesgo",
    "calidad": "calidad de beneficios",
    "tesis": "tesis",
    "senal": "señal",
    "confianza": "confianza",
    "correlacion": "correlación",
    "rebalanceo": "rebalanceo",
    "sector": "sector",
    "moneda": "moneda",
    "evidencia": "evidencia",
    "volatilidad": "volatilidad",
    "posicion": "posición",
    # --- Niveles, tendencias, lecturas ---
    "alta": "alta",
    "media": "media",
    "baja": "baja",
    "alto": "alto",
    "moderado": "moderado",
    "bajo": "bajo",
    "muy_alto": "muy alto",
    "medio": "medio",
    "muy_bajo": "muy bajo",
    "subiendo": "subiendo",
    "plana": "plana",
    "bajando": "bajando",
    "sube": "sube",
    "se_mantiene": "se mantiene",
    "mejorando": "mejorando",
    "estable": "estable",
    "deteriorándose": "deteriorándose",
    "en_linea": "en línea",
    "supera": "supera",
    "por_debajo": "por debajo",
    "por_encima": "por encima",
    "dentro": "dentro",
    "fuera": "fuera",
    "barata": "barata",
    "razonable": "razonable",
    "cara": "cara",
    "mejora_fundamental": "mejora fundamental",
    "deterioro": "deterioro",
    "mixto": "mixto",
    "neutral": "neutral",
    "favorable": "favorable",
    "desfavorable": "desfavorable",
    # --- Expectativas ---
    "consenso": "consenso",
    "guidance": "guidance de la dirección",
    "usuario": "tus expectativas",
    "modelo_interno": "modelo interno",
    "reglas": "reglas de la tesis",
    "crecimiento": "crecimiento",
    "metrica": "métrica",
    "noticia": "noticia",
    "absoluto": "absoluto",
    "relativo": "relativo",
    "absoluta": "absoluta",
    "relativa": "relativa",
    "categorico": "categórico",
    "dato_nuevo": "dato nuevo",
    "earnings": "resultados",
    "material": "material",
    # --- Traza del motor ---
    "a_favor": "a favor",
    "bloquea": "bloquea",
    "decide": "decide",
    "evaluada": "evaluada",
    "informa": "informa",
    "modifica": "modifica",
    "alguna": "alguna",
    "todas": "todas",
    "calibrada": "calibrada",
    "refutada": "refutada",
    "sin_calibrar": "sin calibrar",
    # --- Escenarios y frescura del precio ---
    "bear": "bajista",
    "base": "base",
    "bull": "alcista",
    "bajista": "bajista",
    "alcista": "alcista",
    "live": "en vivo",
    "delayed": "retrasado ~15 min",
    "prev_close": "cierre anterior",
    # --- Unidades ---
    "puntos": "puntos",
    "veces": "veces",
}

# Las acciones del motor y las listas diarias ya tienen nombre donde se definen:
# se toma de ahí, no se copia.
ETIQUETAS: dict[str, str] = {
    **_BASE,
    **{codigo: texto.lower() for codigo, texto in ACCIONES.items()},
    **{codigo: m["name"] for codigo, m in MARKETS.items()},
}

_CODIGO = re.compile(r"^[A-Za-z0-9_:]+$")
_SIGLA = re.compile(r"^[A-Z][A-Z0-9]{1,5}$")  # BPA, FCF, EBITDA, P2
_ORIGEN = re.compile(r"^(?P<tipo>[a-z_]+):(?P<h>\d{2}):(?P<m>\d{2})(?::\d{2})?$")
_ORIGENES = {"analisis": "análisis"}
_avisados: set[str] = set()


def _mayuscula(texto: str) -> str:
    return texto[:1].upper() + texto[1:]


def etiqueta(codigo: str | None, mayuscula: bool = False) -> str:
    """La etiqueta de un código: «gross_margin» → «margen bruto».

    Un código compuesto («gross_margin:ingresos», el linaje de un dato) se
    etiqueta por partes: «margen bruto (ingresos)». Uno desconocido sale legible
    y se avisa una vez en el registro."""
    if codigo is None or codigo == "":
        return "—"
    if codigo in ETIQUETAS:
        texto = ETIQUETAS[codigo]
    elif not _CODIGO.match(codigo) or _SIGLA.match(codigo):
        # Ya es texto («media de 200 sesiones») o una sigla («BPA», la métrica
        # que extrae la IA): se deja. Antes la sigla salía «Bpa» (revisión F1).
        texto = codigo
    elif _ORIGEN.match(codigo):
        texto = etiqueta_origen(codigo)
    elif ":" in codigo:
        cabeza, _, resto = codigo.partition(":")
        partes = [etiqueta(p) for p in resto.split(":")]
        texto = f"{etiqueta(cabeza)} ({', '.join(partes)})"
    else:
        texto = codigo.replace("_", " ").lower()
        if codigo not in _avisados:
            _avisados.add(codigo)
            log("dato").warning("código sin etiqueta: %r (añádelo a app/etiquetas.py)", codigo)
    return _mayuscula(texto) if mayuscula else texto


def etiqueta_origen(origen: str | None) -> str:
    """«analisis:03:09:37» → «análisis de las 03:09 UTC». La hora del origen de
    una instantánea se escribe en UTC al congelarla."""
    m = _ORIGEN.match(origen or "")
    if not m:
        return etiqueta(origen) if origen and ":" not in origen else (origen or "—")
    tipo = _ORIGENES.get(m["tipo"], m["tipo"].replace("_", " "))
    return f"{tipo} de las {m['h']}:{m['m']} UTC"


# --- Copia para el frontend -----------------------------------------------------

DESTINO = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "etiquetas.json"

# Entradas cuya etiqueta calcula el backend, para que el frontend demuestre que
# las calcula IGUAL (compuestos, orígenes, desconocidos, mayúsculas).
CASOS = [
    ("gross_margin", False), ("gross_margin", True), ("NO_TRADE", True), ("us_sp500", False),
    ("sin_datos", True), ("gross_margin:ingresos", False), ("fcf_growth:capex_anterior", False), ("cuentas por cobrar_anterior", False),
    ("BPA", True), ("EBITDA", False), ("EPS", True), ("FCF", True),
    ("analisis:03:09:37", False), ("analisis:14:35:00", True), ("algo_nuevo", False),
    ("OTRO_CODIGO", True), ("eps_diluted", True), ("correlacion", False),
    ("media de 200 sesiones", True), ("deuda neta (parcial)", False),
]


def exportado() -> str:
    datos = {
        "_doc": "Generado por `python -m app.etiquetas` desde backend/app/etiquetas.py. No editar a mano.",
        "etiquetas": dict(sorted(ETIQUETAS.items())),
        "casos": [[c, m, etiqueta(c, mayuscula=m)] for c, m in CASOS],
    }
    return json.dumps(datos, ensure_ascii=False, indent=1) + "\n"


def main() -> int:
    DESTINO.write_text(exportado(), encoding="utf-8")
    print(f"escrito {DESTINO}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
