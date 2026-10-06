"""El DCF por escenarios de la ficha: `/api/stocks/{s}/valuation/{defaults,dcf}`.

Dos fallos de «falta = cero» vivían aquí, con la puerta abierta desde la
pantalla: la deuda neta desconocida se prellenaba con 0 y el endpoint la
aceptaba por defecto como 0. La empresa se valoraba como si no debiera nada.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.db.engine import get_session
from app.deps import get_service
from app.main import app
from tests.test_valuation_api import FakeService, _periodos


@pytest.fixture
def client(session_factory, monkeypatch):
    def _hacer(periodos=None):
        if periodos is not None:
            import tests.test_valuation_api as t

            monkeypatch.setattr(t, "_periodos", lambda n=8: periodos)
        service = FakeService()

        def override_session():
            s = session_factory()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_service] = lambda: service
        app.dependency_overrides[get_session] = override_session
        return TestClient(app)

    yield _hacer
    app.dependency_overrides.clear()


ESCENARIOS = {"base": {"growth_rate": 0.05, "discount_rate": 0.10, "terminal_growth": 0.025}}


def test_sin_deuda_neta_el_dcf_se_niega_en_vez_de_suponer_cero(client):
    c = client()
    r = c.post("/api/stocks/AAPL/valuation/dcf",
               json={"base_fcf": 1000e6, "shares_outstanding": 100e6, "scenarios": ESCENARIOS})
    assert r.status_code == 422
    assert "deuda neta" in r.json()["detail"].lower()
    ok = c.post("/api/stocks/AAPL/valuation/dcf",
                json={"base_fcf": 1000e6, "net_debt": 0.0, "shares_outstanding": 100e6,
                      "scenarios": ESCENARIOS})
    assert ok.status_code == 200, ok.text  # un cero ESCRITO sí es un dato


def test_los_valores_de_partida_dicen_si_la_deuda_es_parcial(client):
    d = client(periodos=[{**p, "short_term_debt": None} for p in _periodos()]).get(
        "/api/stocks/AAPL/valuation/defaults").json()
    assert d["net_debt"] == pytest.approx(2000e6 - 1000e6)
    assert d["deuda_parcial"] == ["short_term_debt"] and "sobreestimado" in d["nota_deuda"]


def test_sin_deuda_conocida_los_valores_de_partida_no_la_inventan(client):
    sin = [{**p, "short_term_debt": None, "long_term_debt": None} for p in _periodos()]
    d = client(periodos=sin).get("/api/stocks/AAPL/valuation/defaults").json()
    assert d["net_debt"] is None and d["deuda_parcial"] is None


def test_un_crecimiento_medido_de_cero_no_se_cambia_por_el_de_ingresos(client):
    """`fcf_cagr or revenue_cagr` tiraba un 0,0 medido por ser *falsy*."""
    planos = [{**p, "cfo": 1400e6, "capex": 400e6} for p in _periodos()]  # FCF plano, ingresos al +6 %
    d = client(periodos=planos).get("/api/stocks/AAPL/valuation/defaults").json()
    assert d["historical_growth"]["fcf_cagr"] == pytest.approx(0.0)
    assert d["suggested_growth_capped"] == 0.0
