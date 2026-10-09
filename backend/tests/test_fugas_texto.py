"""Ninguna frase de la app enseña tripas (ítem 0.5 del plan de correcciones).

Se recoge TODO el texto que el backend escribe para una persona sobre el paquete
de casos extremos (`tests/fixtures/textos.recoger`) y se buscan las fugas de la
familia de V3, V6 y V8: un `None` o un `NaN` dentro de una frase, un «-0 %», un
código interno (`sin_datos`, `NO_TRADE`, `analisis:03:09:37`) o un plural
entre paréntesis («dato(s)»).

**Trinquete, por sitio y con recuento.** Las fugas que ya existían cuando se
escribió este test están en `PENDIENTES`: el sitio de donde salen (la ruta en la
salida, sin el caso concreto), el tipo, el token y cuántas veces aparecen, con
el ítem del plan que las arregla. Rompe el test:

- una fuga en un sitio nuevo, aunque el token ya esté pendiente en otro (un
  `None` nuevo en otra frase no se esconde detrás de los conocidos);
- MÁS apariciones de las anotadas en un sitio conocido;
- MENOS apariciones, o ninguna: alguien arregló algo y tiene que bajar el
  recuento o quitar la fila. La lista solo puede encoger.

La primera versión contaba por token y sin recuento, y la revisión de la fase
lo señaló: con `(s)` pendiente en seis sitios, un `(s)` nuevo en un séptimo
pasaba sin fallar, y arreglar 98 de 99 no obligaba a tocar la lista.

Para regenerar la tabla tras un arreglo: `python -m tests.test_fugas_texto`.
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
    # Un decimal con punto inglés («31.2 %», «EPS estimado 0.52», V4). No toca
    # el punto de miles es-ES («6.000», «1.234.567»): ahí siempre siguen tres cifras.
    "decimal_punto": re.compile(r"(?<![\w.,])(?:0\.\d+|\d+\.\d{1,2}|\d+\.\d{4,})(?![\w.,]?\d)"),
    # «2025-04-25 → 2026-09-11» en una frase (revisión de la Fase 1, D3): una fecha
    # para una persona se escribe con fmt_fecha («25 abr 2025»).
    "fecha_iso": re.compile(r"(?<![\w-])\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?(?![\w-])"),
    # «+1 sobre 1 evaluables» (revisión de la Fase 1, V7): un 1 suelto con el
    # sustantivo en plural. Las palabras que acaban en «s» en singular, aparte.
    "uno_plural": re.compile(r"(?<![\w.,])1 (?!(?:es|más|menos|mes|análisis|tesis|crisis|después|antes)\b)"
                             r"[a-záéíóúñ]+s\b"),
}

# Legítimos para siempre: notación matemática y nombres de variables de
# entorno cuando se le pide a la persona que las configure.
PERMITIDOS = {
    ("snake", "w_i"), ("snake", "componente_i"),
}
PERMITIDOS_RE = [("upper_snake", re.compile(r"^[A-Z]+_(?:API_KEY|USER_AGENT|MODEL)$"))]

# Fugas conocidas → (apariciones, ítem del plan que las arregla). Ejemplos:
# «cotiza bajo su media de 200 sesiones (None)», «Margen operativo = nan»,
# «0 dato(s) desconocido(s)», «lista diaria «us_sp500»», «La señal es «sin_datos»».
PENDIENTES: dict[tuple[str, str, str], tuple[int, str]] = {
}


def sitio(origen: str) -> str:
    """«analisis[completa|vacia]/faltan/motivo» → «analisis/faltan/motivo»."""
    return re.sub(r"\[[^\]]*\]", "", origen)


def _permitido(tipo: str, token: str) -> bool:
    return (tipo, token) in PERMITIDOS or any(t == tipo and r.match(token) for t, r in PERMITIDOS_RE)


def contar() -> dict[tuple[str, str, str], list[str]]:
    """(sitio, tipo, token) → los textos donde aparece, uno por aparición."""
    from tests.fixtures.textos import recoger

    encontradas: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for origen, texto in recoger():
        for tipo, patron in PATRONES.items():
            for m in patron.finditer(texto):
                if not _permitido(tipo, m.group(0)):
                    encontradas[(sitio(origen), tipo, m.group(0))].append(f"{origen}: «{texto[:120]}»")
    return encontradas


@pytest.fixture(scope="module")
def fugas():
    return contar()


def test_ningun_texto_nuevo_ensena_tripas(fugas):
    nuevas = [f"{s} · {tipo} {tok!r} ×{len(ej)} (sin anotar) — {ej[0]}"
              for (s, tipo, tok), ej in fugas.items() if (s, tipo, tok) not in PENDIENTES]
    mas = [f"{s} · {tipo} {tok!r}: {len(ej)} apariciones, anotadas {PENDIENTES[(s, tipo, tok)][0]} — {ej[-1]}"
           for (s, tipo, tok), ej in fugas.items()
           if (s, tipo, tok) in PENDIENTES and len(ej) > PENDIENTES[(s, tipo, tok)][0]]
    assert not nuevas + mas, "Texto con tripas a la vista:\n  " + "\n  ".join(nuevas + mas)


def test_las_fugas_pendientes_siguen_existiendo(fugas):
    """Si bajan o desaparecen, se arregló algo: baja el recuento o quita la fila (la lista solo encoge)."""
    arregladas = [f"{k} (ítem {item}): anotadas {n}, quedan {len(fugas.get(k, []))}"
                  for k, (n, item) in PENDIENTES.items() if len(fugas.get(k, [])) < n]
    assert not arregladas, ("Hay menos de las anotadas: actualiza PENDIENTES "
                            "(`python -m tests.test_fugas_texto`):\n  " + "\n  ".join(arregladas))


@pytest.mark.parametrize("texto,tipo", [
    ("Precio de hoy: None", "vacio"), ("valor NaN", "vacio"), ("undefined %", "vacio"),
    ("cambio de -0 %", "menos_cero"), ("cambio de -0,0 %", "menos_cero"), ("bajó -0.00", "menos_cero"),
    ("la acción es sin_datos", "snake"), ("veredicto NO_TRADE", "upper_snake"),
    ("Análisis analisis:03:09:37", "clave_interna"), ("3 dato(s)", "plural_parentesis"),
    ("2 posición(es)", "plural_parentesis"),
    ("un 31.2 % de la cartera", "decimal_punto"), ("EPS estimado 0.52", "decimal_punto"),
    ("margen = 0.210", "decimal_punto"), ("Vender si cierra por debajo de 90.0", "decimal_punto"),
    ("el tipo sale 0.7299", "decimal_punto"), ("1.3701 CAD", "decimal_punto"),
    ("+1 sobre 1 evaluables", "uno_plural"), ("Q1 tiene 1 resultados", "uno_plural"),
])
def test_los_patrones_detectan_cada_familia(texto, tipo):
    assert PATRONES[tipo].search(texto)


@pytest.mark.parametrize("texto", ["-0,5 %", "−0,03", "2026-09-03", "10-0", "S&P 500", "Euler: σ_p",
                                   "6.000,00", "1.234.567,89", "20.000", "RY.TO", "BRK.B", "v1.2", "3.400 mil M",
                                   "1 de 9 señales", "solo 1 es", "1 mes", "0,1 años", "2021 años", "Q1 ventas"])
def test_los_patrones_no_confunden_texto_legitimo(texto):
    assert not PATRONES["menos_cero"].search(texto)
    assert not PATRONES["vacio"].search(texto)
    assert not PATRONES["decimal_punto"].search(texto)
    assert not PATRONES["uno_plural"].search(texto)


if __name__ == "__main__":
    # La tabla actual, para pegarla en PENDIENTES después de un arreglo.
    import os
    import tempfile

    os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(prefix="fugas-"), "fugas.db")
    for (s, tipo, tok), ej in sorted(contar().items()):
        item = PENDIENTES.get((s, tipo, tok), (0, "?"))[1]
        print(f'    ("{s}", "{tipo}", "{tok}"): ({len(ej)}, "{item}"),')
