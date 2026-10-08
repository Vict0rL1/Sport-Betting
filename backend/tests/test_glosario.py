"""Un término por concepto (ítem 1.8): lo que `docs/GLOSARIO.md` prohíbe no
aparece en ningún texto para el usuario.

Se mira el texto del backend sobre el paquete de casos extremos, el diccionario
de etiquetas y las cadenas y el texto JSX del frontend (sin comentarios ni
identificadores: `eps_diluted` es un código, «EPS diluido» era una etiqueta).
La lista sale de la columna «Nunca» del glosario: para prohibir algo, se
escribe allí.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

import pytest

from app.etiquetas import ETIQUETAS

RAIZ = Path(__file__).resolve().parents[2]
GLOSARIO = RAIZ / "docs" / "GLOSARIO.md"
FRONTEND = RAIZ / "frontend" / "src"


def prohibidos() -> list[str]:
    salida = []
    for linea in GLOSARIO.read_text(encoding="utf-8").splitlines():
        celdas = [c.strip() for c in linea.strip().strip("|").split("|")]
        if len(celdas) == 4 and celdas[2] and celdas[2] not in ("Nunca", "---"):
            salida += [t.strip() for t in celdas[2].split(",") if t.strip()]
    return salida


def _patron(termino: str) -> re.Pattern:
    return re.compile(r"(?<![\w-])" + re.escape(termino) + r"(?![\w-])", re.IGNORECASE if termino.islower() else 0)


def _sin_comentarios(fuente: str) -> str:
    fuente = re.sub(r"/\*.*?\*/", "", fuente, flags=re.S)
    fuente = re.sub(r"\{/\*.*?\*/\}", "", fuente, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$|\s//.*$", "", fuente)


def test_el_glosario_prohibe_algo():
    assert {"EPS", "FCF yield", "stop loss"} <= set(prohibidos())


@pytest.fixture(scope="module")
def textos_backend():
    from tests.fixtures.textos import recoger

    logging.disable(logging.WARNING)
    try:
        return recoger()
    finally:
        logging.disable(logging.NOTSET)


@pytest.mark.parametrize("termino", prohibidos())
def test_el_backend_no_lo_escribe(termino, textos_backend):
    p = _patron(termino)
    malos = [f"{origen}: «{t[:100]}»" for origen, t in textos_backend if p.search(t)]
    malos += [f"etiqueta de {c}: «{e}»" for c, e in ETIQUETAS.items() if p.search(e)]
    assert not malos, f"«{termino}» está prohibido por docs/GLOSARIO.md:\n  " + "\n  ".join(malos[:10])


@pytest.mark.parametrize("termino", prohibidos())
def test_el_frontend_no_lo_escribe(termino):
    p = _patron(termino)
    malos = []
    for f in sorted(FRONTEND.rglob("*.ts*")):
        if ".test." in f.name or f.name == "etiquetas.json":
            continue
        for i, linea in enumerate(_sin_comentarios(f.read_text(encoding="utf-8")).splitlines(), 1):
            if p.search(linea):
                malos.append(f"{f.relative_to(RAIZ)}: {linea.strip()[:100]}")
    assert not malos, f"«{termino}» está prohibido por docs/GLOSARIO.md:\n  " + "\n  ".join(malos[:10])
