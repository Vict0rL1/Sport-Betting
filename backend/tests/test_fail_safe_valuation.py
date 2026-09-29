"""La valoración no puede inventar deuda ni crecimiento.

De la auditoría de RC1. Dos líneas de `routers/valuation.py` y sus gemelas en
`routers/deep_dive.py` convertían la ausencia en el supuesto más favorable:

    "net_debt": (deuda - cash) if deuda is not None else 0.0
    historico = crec.get("fcf_cagr") or crec.get("revenue_cagr") or 0.03

La primera vale un 95 % de valoración. En `analysis/valuation.py` el equity es
`enterprise_value − net_debt`, así que una empresa sobre la que no sabemos la
deuda se valora **como si no tuviera ninguna** — el supuesto más optimista
posible, aplicado justo cuando menos se sabe.

La segunda tiene dos fallos en una línea: convierte un crecimiento ausente en
un 3 % que nunca se declara como supuesto, y convierte un crecimiento real de
`0.0` en ese mismo 3 %, porque `0.0` es *falsy*. Una empresa que no crece se
valora como si creciera.
"""

from __future__ import annotations

import pytest

from app.analysis.valuation import dcf
from app.routers.valuation import _escenarios_por_defecto, CRECIMIENTO_MAXIMO

BASE = dict(
    base_fcf=1_000_000_000,
    growth_rate=0.05,
    discount_rate=0.10,
    terminal_growth=0.025,
    years=10,
    shares_outstanding=100_000_000,
)


# --- P0-6: la deuda desconocida no es deuda cero -------------------------


def test_la_deuda_desconocida_vale_un_95_por_ciento_de_valoracion():
    """El número que motivó el hallazgo, congelado como test."""
    con = dcf(net_debt=8_000_000_000, **BASE)["value_per_share"]
    sin = dcf(net_debt=0.0, **BASE)["value_per_share"]
    assert sin > con * 1.9, "tratar la deuda como cero tiene que notarse mucho"


def test_un_dcf_sin_deuda_conocida_no_devuelve_un_valor_por_accion():
    """La respuesta correcta es «no se puede valorar», no un número optimista."""
    r = dcf(net_debt=None, **BASE)
    assert r["value_per_share"] is None
    assert r.get("indeterminado") is True
    assert "deuda" in " ".join(r.get("faltan", [])).lower() or "deuda" in (
        r.get("motivo") or ""
    ).lower()


def test_una_deuda_de_cero_si_es_un_dato():
    """Una empresa sin deuda existe. Cero conocido ≠ desconocido."""
    r = dcf(net_debt=0.0, **BASE)
    assert r["value_per_share"] is not None
    assert not r.get("indeterminado")


def test_una_deuda_nan_se_trata_como_desconocida():
    r = dcf(net_debt=float("nan"), **BASE)
    assert r["value_per_share"] is None


def test_caja_neta_negativa_es_legitima():
    """Más caja que deuda: net_debt negativo sube el valor, y es correcto."""
    r = dcf(net_debt=-2_000_000_000, **BASE)
    base = dcf(net_debt=0.0, **BASE)["value_per_share"]
    assert r["value_per_share"] > base


def test_sin_acciones_en_circulacion_no_hay_valor_por_accion():
    r = dcf(**{**BASE, "shares_outstanding": None}, net_debt=0.0)
    assert r["value_per_share"] is None


# --- P0-7: el crecimiento ausente no es un 3 % ---------------------------


def test_un_crecimiento_real_de_cero_no_se_convierte_en_el_supuesto():
    """`or` encadenado: `0.0` es falsy y caía al 3 % por defecto.

    Una empresa que no crece no puede valorarse como si creciera.
    """
    esc = _escenarios_por_defecto({"fcf_cagr": 0.0, "revenue_cagr": 0.0})
    assert esc["base"]["growth_rate"] == 0.0
    assert esc["base"]["supuesto"] is False


def test_sin_crecimiento_conocido_el_supuesto_se_declara():
    esc = _escenarios_por_defecto({})
    assert esc["base"]["supuesto"] is True
    assert esc["base"]["motivo"]
    assert "supuesto" in esc["base"]["motivo"].lower()


def test_con_crecimiento_conocido_no_hay_supuesto():
    esc = _escenarios_por_defecto({"fcf_cagr": 0.08})
    assert esc["base"]["supuesto"] is False
    assert esc["base"]["motivo"] is None


def test_un_crecimiento_nan_no_pasa_por_dato():
    esc = _escenarios_por_defecto({"fcf_cagr": float("nan")})
    assert esc["base"]["supuesto"] is True


def test_el_tope_de_crecimiento_sigue_aplicandose():
    """Extrapolar el mejor quinquenio a perpetuidad es el error caro del DCF."""
    esc = _escenarios_por_defecto({"fcf_cagr": 0.80})
    assert esc["alcista"]["growth_rate"] <= CRECIMIENTO_MAXIMO


def test_un_crecimiento_negativo_no_se_convierte_en_positivo():
    """Una empresa en contracción es un dato, no un error que corregir."""
    esc = _escenarios_por_defecto({"fcf_cagr": -0.05})
    assert esc["base"]["growth_rate"] <= 0.0
    assert esc["base"]["supuesto"] is False
