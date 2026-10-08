"""Gramática, plurales y concordancia (ítem 1.9, V7).

Los cuatro textos de la revisión, uno por uno, más la regla general: un
recuento escribe su forma («1 posición abierta no entra»), nunca «posición(es)
abierta(s) no entran» (eso ya lo vigila el trinquete de fugas, `(es)`/`(s)`).
"""

from __future__ import annotations

from app.analysis import risk_budget
from app.analysis.decision import decide
from app.analysis.thesis_watch import _resumen, evaluar
from app.formato import plural


def test_que_haya_una_puntuacion_valida():
    # Antes: «que haya puntuación válido».
    d = decide({"symbol": "X", "score": None, "label": "sin_datos"}, {"last": 100.0})
    condiciones = [c["condicion"] for alt in d["cambiaria"] for c in alt["condiciones"]]
    assert "que haya una puntuación válida" in condiciones
    d = decide({"symbol": "X", "score": 0.5, "label": "favorable"}, None)
    condiciones = [c["condicion"] for alt in d["cambiaria"] for c in alt["condiciones"]]
    assert "que haya un precio válido" in condiciones


def test_el_umbral_de_un_punto_se_lee_entero():
    # Antes: «Margen operativo = 0.210 y el umbral era cae por debajo de 0.180».
    r = evaluar({"id": 1, "kind": "metrica", "descripcion": "x", "activo": True,
                 "config": {"metrica": "operating_margin", "op": "lt", "umbral": 0.18}},
                {"ratios": [{"fiscal_year": 2025, "operating_margin": 0.21}]})
    assert r["detalle"] == "Margen operativo = 0,210; el punto salta si cae por debajo de 0,180. Todavía no lo cruza."


def test_ninguno_de_los_1_puntos():
    assert _resumen(0, 0, 1) == "El único punto de invalidación no se ha cruzado."
    assert _resumen(0, 0, 3) == "Ninguno de los 3 puntos de invalidación se ha cruzado."
    assert _resumen(1, 0, 3).startswith("1 de 3 puntos de invalidación se ha cruzado.")
    assert _resumen(2, 0, 3).startswith("2 de 3 puntos de invalidación se han cruzado.")
    assert "1 no se pudo comprobar" in _resumen(0, 1, 2)


def test_posicion_es_tiene_plural_de_verdad():
    def aviso(n):
        posiciones = [{"symbol": f"S{i}", "quantity": 1, "price": None, "stop": None} for i in range(n)]
        return " ".join(risk_budget.presupuesto_de_riesgo(posiciones, 1000.0)["avisos"])
    assert "1 posición sin precio o sin stop no entra en el total" in aviso(1)
    assert "2 posiciones sin precio o sin stop no entran en el total" in aviso(2)


def test_plural():
    assert (plural(1, "punto", "puntos"), plural(0, "punto", "puntos"), plural(2, "punto", "puntos")) == (
        "punto", "puntos", "puntos")
