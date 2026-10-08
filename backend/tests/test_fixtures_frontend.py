"""Las respuestas que usan los tests del frontend son las que el backend da HOY.

`frontend/src/test/fixtures/*.json` se exporta desde la API real sobre el
paquete de casos extremos (`tests/fixtures/exportar_frontend.py`). Si un cambio
del backend —un texto, un campo nuevo— no se reexporta, el frontend se probaría
contra una API que ya no existe. Este test lo impide:

    python -m tests.fixtures.exportar_frontend
"""

from __future__ import annotations

import logging

from tests.fixtures.exportar_frontend import DESTINO, exportar


def test_las_respuestas_del_frontend_estan_al_dia():
    logging.disable(logging.WARNING)
    try:
        actuales = exportar()
    finally:
        logging.disable(logging.NOTSET)
    desfasadas = [
        n for n, texto in actuales.items()
        if not (DESTINO / f"{n}.json").exists() or (DESTINO / f"{n}.json").read_text(encoding="utf-8") != texto
    ]
    assert not desfasadas, (
        f"Respuestas del frontend desactualizadas: {desfasadas}. "
        "Reexporta con `python -m tests.fixtures.exportar_frontend` en el mismo commit."
    )
