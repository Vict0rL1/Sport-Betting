"""El servidor de las capturas enseña los estados vacíos de verdad (revisión de la Fase 0).

Antes `ServicioDemo` inventaba cotización y fundamentales para CUALQUIER
símbolo, también para VACIA, la empresa del paquete que existe para enseñar «sin
un solo dato»: la captura `empresa_sin_datos` salía con precio 254 y PER 34, y
el estado vacío de la cabecera no se había fotografiado nunca. Y completaba la
cotización con `(precio or 0) + 1.2`, un cierre anterior de 1,2 cuando faltaba
el precio.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.providers.base import DataNotFoundError
from tests.fixtures import extremos as ex
from tests.fixtures.servicio_pantallas import ServicioPantallas

BACKEND = Path(__file__).resolve().parents[1]

_SONDA = """
import json
from tests.fixtures.servidor_demo import montar
from app.providers.base import DataNotFoundError
sv = montar("empresa_sin_datos")
salida = {}
for tipo in ("quote", "fundamentals", "profile", "price_history"):
    for symbol in ("VACIA", "ACME", "ZZZZ"):
        try:
            r = sv.get(tipo, symbol=symbol)
            salida[f"{tipo} {symbol}"] = "precio=%s" % r.get("price") if tipo == "quote" else "ok"
        except DataNotFoundError:
            salida[f"{tipo} {symbol}"] = "ausente"
print(json.dumps(salida))
"""


@pytest.fixture(scope="module")
def respuestas():
    # En otro proceso: el servidor de demostración fija su propia base temporal al importarse.
    r = subprocess.run([sys.executable, "-c", _SONDA], cwd=BACKEND, capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_la_empresa_sin_datos_sigue_sin_datos_en_la_demo(respuestas):
    for tipo in ("quote", "fundamentals", "profile", "price_history"):
        assert respuestas[f"{tipo} VACIA"] == "ausente", (tipo, respuestas[f"{tipo} VACIA"])


def test_la_demo_si_completa_lo_que_el_paquete_no_conoce(respuestas):
    # Las pantallas del screener y los ETF piden símbolos cualquiera: esos sí se inventan.
    assert respuestas["quote ZZZZ"].startswith("precio=") and respuestas["profile ZZZZ"] == "ok"
    assert respuestas["quote ACME"] == "precio=92.0"


def test_un_precio_ausente_no_se_completa_con_ceros():
    sv = ServicioPantallas(ex.AHORA)
    sv.empresa("NULO", precio=None, score=None)
    q = sv.get("quote", symbol="NULO")
    assert q["price"] is None
    assert q["prev_close"] is None and q["day_high"] is None and q["day_low"] is None and q["change"] is None
    with pytest.raises(DataNotFoundError):
        ServicioPantallas(ex.AHORA).get("profile", symbol="VACIA")
