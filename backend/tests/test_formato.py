"""Un solo formato de cifras para backend y frontend (ítem 1.7: V4, V5, V8).

La tabla de casos es la MISMA que prueba `frontend/src/lib/formato.test.ts`: si
un lado cambia una regla y el otro no, uno de los dos tests falla. Antes el
backend escribía «31.2 %» y el frontend «45,5 %» en la misma pantalla.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app import formato

CASOS = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/lib/formato.casos.json").read_text())
FUNCIONES = [k for k in CASOS if not k.startswith("_")]
ESPECIALES = {"NaN": math.nan, "Infinity": math.inf}


def _llamar(funcion: str, args: list, opciones: dict) -> str:
    if funcion == "fmt_antiguedad":
        args = [args[0], datetime.fromisoformat(args[1].replace("Z", "+00:00"))]
    elif funcion != "fmt_fecha" and isinstance(args[0], str):
        args = [ESPECIALES[args[0]], *args[1:]]
    return getattr(formato, funcion)(*args, **opciones)


def test_la_tabla_cubre_todas_las_funciones_publicas():
    publicas = {n for n in dir(formato) if n.startswith("fmt_")}
    assert set(FUNCIONES) == publicas


@pytest.mark.parametrize(
    "funcion,args,opciones,esperado",
    [(f, *caso) for f in FUNCIONES for caso in CASOS[f]],
    ids=lambda x: json.dumps(x, ensure_ascii=False) if isinstance(x, (list, dict)) else str(x),
)
def test_caso_compartido(funcion, args, opciones, esperado):
    assert _llamar(funcion, args, opciones) == esperado


def test_el_cero_negativo_de_json_llega_como_cero_negativo():
    # Si `-0.0` llegara como 0, el caso de V8 no probaría nada.
    ceros = [c[0][0] for c in CASOS["fmt_num"] if c[0][0] == 0]
    assert any(isinstance(z, float) and math.copysign(1, z) == -1 for z in ceros)


def test_un_instante_y_un_datetime_con_zona_dan_lo_mismo():
    instante = datetime(2026, 9, 12, 14, 35, tzinfo=timezone.utc)
    assert formato.fmt_fecha(instante, hora=True, zona="America/New_York") == "12 sept 2026, 10:35 ET"
    assert formato.fmt_antiguedad(instante, datetime(2026, 9, 12, 15, 35, tzinfo=timezone.utc)) == "hace 1 h"


def test_un_booleano_no_es_una_cifra():
    assert formato.fmt_num(True) == "—"
