"""Calidad de beneficios: evidencias con regla, umbral, valor, periodo y fuente."""

from __future__ import annotations

import pytest

from app.analysis import calidad_beneficios as qb
from tests.fakes_empresa import periodo, trimestre


def _anos(ultimo=None, penultimo=None):
    """Tres ejercicios sanos que crecen un 10 %; se sobrescribe lo que interese."""
    base = dict(revenue=1000.0, net_income=100.0, cfo=120.0, capex=20.0, total_assets=2000.0,
                accounts_receivable=100.0, inventory=80.0, sbc=20.0)
    filas = []
    for i, ano in enumerate((2023, 2024, 2025)):
        f = {k: v * (1.1 ** i) for k, v in base.items()}
        if ano == 2025 and ultimo:
            f.update(ultimo)
        if ano == 2024 and penultimo:
            f.update(penultimo)
        filas.append(periodo(ano, f"{ano + 1}-02-10", **f))
    return filas


def _ev(r, cat):
    return next(e for e in r["evidencias"] if e["categoria"] == cat)


def test_un_cfo_fuerte_es_buena_conversion_y_se_reconstruye_hasta_el_filing():
    r = qb.analizar(_anos())
    c = _ev(r, "conversion_caja")
    assert c["estado"] == "bueno" and c["valor"] == pytest.approx(1.2)
    assert c["entradas"]["cfo"]["valor"] == pytest.approx(145.2)
    assert c["entradas"]["cfo"]["formulario"] == "10-K" and c["entradas"]["cfo"]["accn"] == "A-2025"
    assert c["entradas"]["cfo"]["publicado"] == "2026-02-10"
    assert c["periodo"] == "2025" and c["fuente"] == "edgar" and c["regla"].startswith("CFO / beneficio")
    assert r["global"] == "solida"


def test_beneficio_fuerte_con_cfo_debil_es_aviso_y_accruals_altos():
    r = qb.analizar(_anos(ultimo={"net_income": 400.0, "cfo": 90.0}))
    c = _ev(r, "conversion_caja")
    assert c["estado"] == "aviso" and c["valor"] == pytest.approx(0.225)
    acc = _ev(r, "accruals")
    assert acc["estado"] == "aviso" and acc["valor"] == pytest.approx(310 / ((2000 * 1.21 + 2000 * 1.1) / 2), abs=1e-4)
    assert r["global"] == "precaucion" and {"conversion_caja", "accruals"} <= set(r["avisos"])


def test_cobros_que_crecen_mucho_mas_que_las_ventas_avisan_y_se_ve_si_es_persistente():
    r = qb.analizar(_anos(ultimo={"accounts_receivable": 110.0 * 1.35}))  # +35 % sobre 110
    ar = _ev(r, "cuentas_por_cobrar")
    assert ar["estado"] == "aviso"
    assert ar["crecimiento"] == pytest.approx(0.35) and ar["crecimiento_ingresos"] == pytest.approx(0.10)
    assert ar["valor"] == pytest.approx(0.25) and ar["persistente"] is False
    persistente = qb.analizar(_anos(ultimo={"accounts_receivable": 100 * 1.4 * 1.4},
                                    penultimo={"accounts_receivable": 140.0}))
    assert _ev(persistente, "cuentas_por_cobrar")["persistente"] is True


def test_un_inventario_excesivo_avisa():
    r = qb.analizar(_anos(ultimo={"inventory": 80 * 1.1 * 1.5}))
    inv = _ev(r, "inventario")
    assert inv["estado"] == "aviso" and inv["valor"] == pytest.approx(0.4)


def test_una_sbc_que_crece_tres_anos_seguidos_avisa_aunque_sea_baja():
    filas = _anos()
    for f, sbc in zip(filas, (20.0, 30.0, 45.0)):
        f["sbc"] = sbc
    s = _ev(qb.analizar(filas), "sbc")
    assert s["creciente"] is True and s["estado"] == "aviso"
    assert s["valor"] == pytest.approx(45 / 1210, abs=1e-6) and s["tendencia"] == pytest.approx([0.02, 30 / 1100, 45 / 1210], abs=1e-5)


def test_un_dato_ausente_es_desconocido_nunca_bueno():
    filas = _anos()
    for f in filas:
        f.pop("inventory")
        f.pop("sbc")
    r = qb.analizar(filas)
    inv = _ev(r, "inventario")
    assert inv["estado"] == "desconocido" and "puede no tenerlo" in inv["motivo"]
    assert _ev(r, "sbc")["estado"] == "desconocido"
    assert r["puntuacion"]["evaluables"] < len(r["evidencias"])


def test_sin_estados_financieros_todo_es_desconocido():
    r = qb.analizar([])
    assert r["global"] == "desconocido" and r["evidencias"] == []


def test_el_circulante_que_infla_el_cfo_avisa_con_el_convenio_de_signos_xbrl():
    # Cobros bajan 30 (suma caja), proveedores suben 20 (suma caja): 50 de 145 = 34 %.
    r = qb.analizar(_anos(ultimo={"change_receivables": -30.0, "change_payables": 20.0}))
    wc = _ev(r, "capital_circulante")
    assert wc["estado"] == "aviso" and wc["aporte_circulante"] == 50.0
    assert wc["partidas_ausentes"] == ["change_inventory"]


def test_los_extraordinarios_se_separan_y_un_tipo_fiscal_anomalo_avisa():
    r = qb.analizar(_anos(ultimo={"restructuring": 30.0, "gain_on_asset_sales": 10.0,
                                  "pretax_income": 150.0, "income_tax": 5.0}))
    ex = _ev(r, "extraordinarios")
    assert ex["separadas"] == {"reestructuracion": 30.0, "venta_de_activos": 10.0}
    assert ex["tipo_fiscal_efectivo"] == pytest.approx(5 / 150, abs=1e-4)
    assert ex["beneficio_fiscal"] is True and ex["estado"] == "aviso"


def test_el_beneficio_crece_y_la_caja_no():
    r = qb.analizar(_anos(ultimo={"net_income": 150.0, "cfo": 100.0, "capex": 40.0}))
    f = _ev(r, "calidad_fcf")
    assert f["estado"] == "aviso" and f["crecimiento_beneficio"] > 0 > f["crecimiento_fcf"]


def test_la_historia_cubre_cinco_anos_y_ocho_trimestres():
    filas = [periodo(a, f"{a + 1}-02-10", revenue=1000.0 + a, net_income=100.0, cfo=110.0, capex=10.0)
             for a in range(2016, 2026)]
    qs = [trimestre(2024 + i // 4, i % 4 + 1, "2025-01-01", revenue=250.0, net_income=25.0, cfo=30.0)
          for i in range(10)]
    r = qb.analizar(filas, qs)
    assert [h["periodo"] for h in r["historia"]] == ["2021", "2022", "2023", "2024", "2025"]
    assert len(r["trimestral"]) == 8 and r["trimestral"][0]["cfo_sobre_beneficio"] == pytest.approx(1.2)


def test_el_endpoint(session_factory):
    from fastapi.testclient import TestClient

    from app.deps import get_service
    from app.main import app
    from tests.fakes_empresa import AHORA, ServicioFalso

    servicio = ServicioFalso(AHORA).empresa("AAPL", periodos=_anos())
    app.dependency_overrides[get_service] = lambda: servicio
    try:
        c = TestClient(app)
        r = c.get("/api/empresa/AAPL/calidad").json()
        assert r["global"] == "solida" and r["por_categoria"]["conversion_caja"] == "bueno"
        assert c.get("/api/empresa/ZZZ/calidad").status_code == 404
    finally:
        app.dependency_overrides.clear()
