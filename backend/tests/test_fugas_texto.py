"""Ninguna frase de la app enseña tripas (ítem 0.5 del plan de correcciones).

Se recoge TODO el texto que el backend escribe para una persona sobre el paquete
de casos extremos (`tests/fixtures/textos.recoger`) y se buscan las fugas de la
familia de V3, V6 y V8: un `None` o un `NaN` dentro de una frase, un «-0 %», un
código interno (`sin_datos`, `NO_TRADE`, `analisis:03:09:37`) o un plural
entre paréntesis («dato(s)»).

**Trinquete.** Las fugas que ya existían cuando se escribió este test están en
`PENDIENTES`, cada una con el ítem del plan que la arregla. Una fuga nueva rompe
el test. Y una pendiente que deja de aparecer TAMBIÉN lo rompe, para que quien la
arregle la quite de la lista: la lista solo puede encoger.
"""

from __future__ import annotations

import re
from collections import defaultdict

import pytest

PATRONES = {
    "vacio": re.compile(r"\b(?:undefined|NaN|nan|None|null)\b"),
    "menos_cero": re.compile(r"(?<![\d.,])[-−]0(?:[.,]0+)?(?!\d)(?![.,]\d)"),
    "snake": re.compile(r"\b[a-z]+_[a-z0-9_]+\b"),
    "upper_snake": re.compile(r"\b[A-Z]+_[A-Z_]+\b"),
    "clave_interna": re.compile(r"\b[a-z_]+:\d{2}:\d{2}"),
    "plural_parentesis": re.compile(r"\((?:es|s)\)"),
}

# Legítimos para siempre: notación matemática y nombres de variables de
# entorno cuando se le pide a la persona que las configure.
PERMITIDOS = {
    ("snake", "w_i"), ("snake", "componente_i"),
}
PERMITIDOS_RE = [("upper_snake", re.compile(r"^[A-Z]+_(?:API_KEY|USER_AGENT|MODEL)$"))]

# Fugas conocidas a 8-oct-2026 → ítem del plan que las arregla.
PENDIENTES = {
    ("vacio", "None"): "1.7",              # «cotiza bajo su media de 200 sesiones (None)»
    ("vacio", "nan"): "1.7",               # «Margen operativo = nan …» en la tesis
    ("plural_parentesis", "(s)"): "1.9",   # «0 dato(s) desconocido(s)»
    ("plural_parentesis", "(es)"): "1.9",  # «1 titular(es) …»
    ("snake", "us_sp500"): "1.8",          # «lista diaria «us_sp500»»
    ("snake", "sin_datos"): "1.8",         # «La señal de X es «sin_datos»»
    ("snake", "deuda_neta"): "1.8",        # «deuda_neta (parcial)» en lo que falta
    ("snake", "revenue_growth"): "1.8",    # confianza: «… revenue, revenue_growth»
    ("snake", "net_debt"): "1.8",          # 422 de la valoración: «mándala en `net_debt`»
    ("snake", "information_available_at"): "1.8",  # regla del replay en inglés
    ("snake", "decision_timestamp"): "1.8",
}


def _permitido(tipo: str, token: str) -> bool:
    return (tipo, token) in PERMITIDOS or any(t == tipo and r.match(token) for t, r in PERMITIDOS_RE)


@pytest.fixture(scope="module")
def fugas():
    from tests.fixtures.textos import recoger

    encontradas: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    for origen, texto in recoger():
        for tipo, patron in PATRONES.items():
            for m in patron.finditer(texto):
                if not _permitido(tipo, m.group(0)):
                    encontradas[(tipo, m.group(0))].append((origen, texto))
    return encontradas


def test_ningun_texto_nuevo_ensena_tripas(fugas):
    nuevas = {k: v for k, v in fugas.items() if k not in PENDIENTES}
    detalle = [f"{tipo} {tok!r} ×{len(ej)} — {ej[0][0]}: «{ej[0][1][:120]}»" for (tipo, tok), ej in nuevas.items()]
    assert not nuevas, "Texto con tripas a la vista:\n  " + "\n  ".join(detalle)


def test_las_fugas_pendientes_siguen_existiendo(fugas):
    """Si una ya no aparece, se arregló: quítala de PENDIENTES (la lista solo encoge)."""
    arregladas = [f"{k} (ítem {v})" for k, v in PENDIENTES.items() if k not in fugas]
    assert not arregladas, "Ya no aparecen, quítalas de PENDIENTES:\n  " + "\n  ".join(arregladas)


@pytest.mark.parametrize("texto,tipo", [
    ("Precio de hoy: None", "vacio"), ("valor NaN", "vacio"), ("undefined %", "vacio"),
    ("cambio de -0 %", "menos_cero"), ("cambio de -0,0 %", "menos_cero"), ("bajó -0.00", "menos_cero"),
    ("la acción es sin_datos", "snake"), ("veredicto NO_TRADE", "upper_snake"),
    ("Análisis analisis:03:09:37", "clave_interna"), ("3 dato(s)", "plural_parentesis"),
    ("2 posición(es)", "plural_parentesis"),
])
def test_los_patrones_detectan_cada_familia(texto, tipo):
    assert PATRONES[tipo].search(texto)


@pytest.mark.parametrize("texto", ["-0,5 %", "−0,03", "2026-09-03", "10-0", "S&P 500", "Euler: σ_p"])
def test_los_patrones_no_confunden_texto_legitimo(texto):
    assert not PATRONES["menos_cero"].search(texto)
    assert not PATRONES["vacio"].search(texto)
