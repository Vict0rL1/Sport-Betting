"""Ningún código sin etiqueta (ítem 1.8, V6).

La pantalla enseñaba «sin_datos», «analisis:03:09:37» o «Mejor prevista:
revenue». Estas guardas son exhaustivas, no un muestreo:

- cada valor de cada enum del backend (acciones, veredictos, estados, listas,
  categorías…) tiene etiqueta;
- cada código que el backend emite sobre el paquete de casos extremos, en una
  clave que se enseña, tiene etiqueta; y cada clave que emite códigos está
  clasificada: o se enseña, o es interna con su motivo. Una clave nueva sin
  clasificar rompe el test, igual que un texto sin clasificar rompe el canon
  del golden;
- la copia del frontend (`frontend/src/lib/etiquetas.json`) está al día.
"""

from __future__ import annotations

import json
import logging
import re

import pytest

from app import etiquetas as et
from app.analysis import calidad_beneficios as cb
from app.analysis import cambios, confianza, coste_de_oportunidad as co, decision, signal
from app.analysis import expectativas as ex
from app.analysis.markets import MARKETS

# Lo que se enseña tal cual porque ya es un nombre o una fecha: tickers,
# monedas, índices, días y periodos («2026-09-16», «2025-Q4»).
TICKER = re.compile(r"^(?:[A-Z]{1,6}(?:\.[A-Z]{1,3})?|\d{4}(?:-.*)?)$")

# Claves que traen códigos que NO se enseñan como etiqueta, con su motivo.
INTERNAS = {
    "id": "identificador de regla o factor; la pantalla enseña su `regla` o su `nombre`",
    "regla": "en `cambiaria`, el id de la regla; su texto va en `condicion`",
    "op": "operador de comparación; se enseña como símbolo",
    "operador": "operador de comparación; se enseña como símbolo",
    "clave": "clave interna de una comprobación de coherencia",
    "version": "huella de la versión de las reglas",
    "generado_por": "procedencia del dato (lo calculó la app)",
    "computed_by": "procedencia del dato (lo calculó la app)",
    "serie": "identificador de la serie de FRED: es la fuente, como un ticker",
    "asset_class": "clase de activo; decide los topes del stop, no se enseña",
    "confidence": "elige qué explicación de la confianza se escribe; no se enseña",
    "descripcion": "texto del usuario (punto de su tesis)",
    "punto": "texto del usuario (punto de su tesis)",
    "palabras": "palabras clave que escribió el usuario",
    "contexto": "texto del usuario en el paquete de casos",
    "nombre": "texto del usuario en el paquete de casos",
}

# Claves cuyos códigos sí se enseñan: cada uno necesita etiqueta.
MOSTRADAS = {
    "accion", "action", "efecto", "hacia", "valor", "ahora", "antes", "actual", "estado", "global",
    "accruals", "calidad_fcf", "capital_circulante", "conversion_caja", "costes_capitalizados",
    "cuentas_por_cobrar", "extraordinarios", "inventario", "sbc", "impuestos", "avisos", "categoria",
    "clasificacion", "cluster_nivel", "confianza", "criterio", "dato", "desconocidos", "deuda_parcial",
    "parcial", "dimension", "direccion", "dominante", "supuesto", "factores_a_favor", "factores_en_contra",
    "familia", "faltan", "fuente_tipo", "incompletas", "kind", "label", "lectura", "limite",
    "mejor_prevista", "metrica", "registrados", "sin_resultado", "nivel", "papel", "resultado",
    "requiere", "seccion", "tendencia", "tesis", "tipo", "tipo_sorpresa", "valoracion", "posicion",
    "precio_estado", "campo", "unidad", "origen",
}


def _etiquetado(codigo: str) -> bool:
    if codigo in et.ETIQUETAS or et._ORIGEN.match(codigo):
        return True
    if ":" in codigo:
        return all(_etiquetado(p) for p in codigo.split(":"))
    return False


@pytest.fixture(scope="module")
def emitidos():
    from tests.fixtures.textos import recoger_codigos

    logging.disable(logging.WARNING)
    try:
        return recoger_codigos()
    finally:
        logging.disable(logging.NOTSET)


def test_cada_enum_del_backend_tiene_etiqueta():
    enums = {
        "acciones del motor": set(decision.ACCIONES),
        "veredictos del coste de oportunidad": {co.NO_ACCION, co.COMPRAR_CON_EFECTIVO, co.REVISAR,
                                                co.NO_TRADE, co.INDETERMINADO},
        "estados de la confianza": {confianza.OK, confianza.DEBIL, confianza.CRITICO, confianza.DESCONOCIDO},
        "estados de la calidad": {cb.BUENO, cb.NORMAL, cb.AVISO, cb.DESCONOCIDO},
        "categorías de «Qué cambió»": set(cambios.CATEGORIAS),
        "listas diarias": set(MARKETS),
        "fuentes de expectativas": set(ex.PRIORIDAD_FUENTES),
        "etiquetas de la señal": {e for _, e in signal.LABEL_THRESHOLDS if " " not in e},
    }
    sin = {nombre: sorted(c for c in codigos if not _etiquetado(c)) for nombre, codigos in enums.items()}
    assert not {k: v for k, v in sin.items() if v}, sin


def test_cada_codigo_que_se_ensena_tiene_etiqueta(emitidos):
    sin = {clave: sorted(c for c in codigos if not TICKER.match(c) and not _etiquetado(c))
           for clave, codigos in emitidos.items() if clave in MOSTRADAS}
    assert not {k: v for k, v in sin.items() if v}, f"Códigos sin etiqueta en app/etiquetas.py: {sin}"


def test_cada_clave_con_codigos_esta_clasificada(emitidos):
    """Una clave nueva que emite códigos tiene que decidir: se enseña o es interna."""
    con_codigos = {clave for clave, codigos in emitidos.items() if any(not TICKER.match(c) for c in codigos)}
    sin_clasificar = sorted(con_codigos - MOSTRADAS - set(INTERNAS))
    assert not sin_clasificar, f"Claves sin clasificar (MOSTRADAS o INTERNAS): {sin_clasificar}"
    assert not MOSTRADAS & set(INTERNAS)


def test_las_clasificaciones_no_se_quedan_huerfanas(emitidos):
    """La lista solo encoge: una clave que ya no sale sobra."""
    assert not (MOSTRADAS | set(INTERNAS)) - set(emitidos)


def test_un_codigo_desconocido_sale_legible_y_avisa(caplog):
    et._avisados.discard("codigo_que_no_existe")
    with caplog.at_level(logging.WARNING, logger="app.dato"):
        assert et.etiqueta("codigo_que_no_existe") == "codigo que no existe"
    assert "codigo_que_no_existe" in caplog.text


@pytest.mark.parametrize("codigo,mayuscula,esperado", [
    ("sin_datos", False, "sin datos"), ("sin_resolver", False, "sin resolver"), ("revenue", False, "ingresos"),
    ("eps_diluted", True, "BPA diluido"), ("gross_margin", False, "margen bruto"),
    ("correlacion", False, "correlación"), ("NO_ACCION", True, "No hacer nada"),
    ("COMPRAR_CON_EFECTIVO", True, "Comprar con efectivo"), ("REVISAR_PARA_FINANCIAR", True, "Revisar para financiar"),
    ("NO_TRADE", True, "No operar"), ("INDETERMINADO", True, "Indeterminado"),
    ("analisis:03:09:37", True, "Análisis de las 03:09 UTC"), ("us_sp500", False, "EE. UU. — S&P 500"),
    ("deuda_neta:deuda_corto", False, "deuda neta (deuda a corto)"), (None, False, "—"),
])
def test_las_etiquetas_del_plan(codigo, mayuscula, esperado):
    assert et.etiqueta(codigo, mayuscula=mayuscula) == esperado


def test_las_acciones_dicen_lo_mismo_que_el_motor():
    for codigo, texto in decision.ACCIONES.items():
        assert et.etiqueta(codigo, mayuscula=True) == texto


def test_las_metricas_de_que_cambio_se_llaman_igual():
    """«Qué cambió» tiene su tabla de materialidad con etiqueta (versionada, no se
    toca); donde comparte código con el diccionario, tiene que decir lo mismo."""
    distintas = {c: (m["etiqueta"], et.etiqueta(c, mayuscula=True)) for c, m in cambios.MATERIALIDAD.items()
                 if c in et.ETIQUETAS and m["etiqueta"] != et.etiqueta(c, mayuscula=True)}
    assert not distintas


def test_la_copia_del_frontend_esta_al_dia():
    actual = et.DESTINO.read_text(encoding="utf-8") if et.DESTINO.exists() else ""
    assert actual == et.exportado(), "Reexporta con `python -m app.etiquetas` en el mismo commit."
    assert json.loads(actual)["etiquetas"] == et.ETIQUETAS
