"""Linaje y trimestres de EDGAR.

Dos garantías: que cada número se pueda reconstruir hasta su filing (etiqueta,
formulario, fecha de presentación), y que los trimestres se publiquen con la
cifra ORIGINAL y su fecha real — no con una reexpresión posterior, que sería
información que nadie tenía cuando se presentaron los resultados.
"""

from __future__ import annotations

from app.providers.edgar import parse_companyfacts, parse_quarters
from app.validacion import validar


def _h(val, start, end, filed, form="10-Q", fy=2026, fp="Q1", accn="0001-26-000001"):
    e = {"val": val, "end": end, "filed": filed, "form": form, "fy": fy, "fp": fp, "accn": accn}
    if start:
        e["start"] = start
    return e


def _facts(**tags):
    return {"facts": {"us-gaap": {t: {"units": {"USD": v}} for t, v in tags.items()}}}


def test_cada_partida_anual_lleva_su_procedencia():
    facts = _facts(
        Revenues=[_h(1000.0, "2025-01-01", "2025-12-31", "2026-02-10", "10-K", 2025, "FY", "A1")],
        NetCashProvidedByUsedInOperatingActivities=[
            _h(300.0, "2025-01-01", "2025-12-31", "2026-02-12", "10-K", 2025, "FY", "A2")
        ],
    )
    p = parse_companyfacts(facts)[-1]
    assert p["fuentes"]["revenue"] == {
        "etiqueta": "Revenues", "formulario": "10-K", "presentado": "2026-02-10",
        "accn": "A1", "inicio": "2025-01-01", "fin": "2025-12-31",
    }
    assert p["fuentes"]["cfo"]["presentado"] == "2026-02-12"
    # El ejercicio completo no se conoció antes que su último dato.
    assert p["filed_at"] == "2026-02-12"


def test_los_trimestres_separan_trimestre_de_acumulado():
    """Un 10-Q trae el trimestre Y el semestre con la misma etiqueta."""
    facts = _facts(Revenues=[
        _h(100.0, "2026-01-01", "2026-03-31", "2026-04-30", fp="Q1"),
        _h(110.0, "2026-04-01", "2026-06-30", "2026-07-30", fp="Q2"),
        _h(210.0, "2026-01-01", "2026-06-30", "2026-07-30", fp="Q2"),  # semestre
    ])
    qs = parse_quarters(facts)
    assert [(q["end_date"], q["revenue"]) for q in qs] == [("2026-03-31", 100.0), ("2026-06-30", 110.0)]
    assert qs[1]["periodo"] == "2026-Q2" and qs[1]["filed_at"] == "2026-07-30"


def test_un_trimestre_reexpresado_conserva_la_cifra_original():
    facts = _facts(Revenues=[
        _h(100.0, "2026-01-01", "2026-03-31", "2026-04-30", fp="Q1"),
        _h(95.0, "2026-01-01", "2026-03-31", "2027-04-30", fy=2027, fp="Q1"),  # comparativo corregido
    ])
    q = parse_quarters(facts)[0]
    assert q["revenue"] == 100.0 and q["filed_at"] == "2026-04-30"
    # La etiqueta sale del original, no del filing de 2027.
    assert q["periodo"] == "2026-Q1"


def test_el_cuarto_trimestre_se_deriva_y_se_marca():
    facts = _facts(Revenues=[
        _h(100.0, "2025-01-01", "2025-03-31", "2025-04-30", fy=2025, fp="Q1"),
        _h(300.0, "2025-01-01", "2025-09-30", "2025-10-30", fy=2025, fp="Q3"),  # nueve meses
        _h(420.0, "2025-01-01", "2025-12-31", "2026-02-10", "10-K", 2025, "FY"),
    ])
    q4 = [q for q in parse_quarters(facts) if q["end_date"] == "2025-12-31"][0]
    assert q4["revenue"] == 120.0
    assert q4["fiscal_period"] == "Q4" and q4["periodo"] == "2025-Q4"
    assert "derivado" in q4["fuentes"]["revenue"]
    assert q4["filed_at"] == "2026-02-10"


def test_el_bpa_del_cuarto_trimestre_no_se_inventa_restando():
    facts = {"facts": {"us-gaap": {
        "Revenues": {"units": {"USD": [
            _h(300.0, "2025-01-01", "2025-09-30", "2025-10-30", fp="Q3"),
            _h(420.0, "2025-01-01", "2025-12-31", "2026-02-10", "10-K", 2025, "FY"),
        ]}},
        "EarningsPerShareDiluted": {"units": {"USD/shares": [
            _h(3.0, "2025-01-01", "2025-09-30", "2025-10-30", fp="Q3"),
            _h(4.2, "2025-01-01", "2025-12-31", "2026-02-10", "10-K", 2025, "FY"),
        ]}},
    }}}
    q4 = [q for q in parse_quarters(facts) if q["end_date"] == "2025-12-31"][0]
    assert "eps_diluted" not in q4


def test_el_balance_trimestral_se_engancha_a_su_trimestre():
    facts = _facts(
        Revenues=[_h(100.0, "2026-01-01", "2026-03-31", "2026-04-30")],
        AccountsReceivableNetCurrent=[_h(55.0, None, "2026-03-31", "2026-04-30")],
    )
    q = parse_quarters(facts)[0]
    assert q["accounts_receivable"] == 55.0
    assert q["fuentes"]["accounts_receivable"]["etiqueta"] == "AccountsReceivableNetCurrent"


def test_la_validacion_respeta_linaje_y_sanea_trimestres():
    payload = {
        "periods": [{"fiscal_year": "2025", "revenue": 10.0, "fuentes": {"revenue": {"etiqueta": "R"}}}],
        "quarters": [
            {"end_date": "2026-03-31", "periodo": "2026-Q1", "fiscal_period": "Q1",
             "revenue": float("nan"), "inventory": -5.0, "change_inventory": -3.0,
             "fuentes": {"revenue": {"etiqueta": "R"}}},
            {"periodo": "sin fecha", "revenue": 1.0},
        ],
    }
    r = validar("financials", payload)
    assert r["periods"][0]["fuentes"] == {"revenue": {"etiqueta": "R"}}
    q = r["quarters"]
    assert len(q) == 1  # sin fecha de cierre no hay trimestre
    assert q[0]["revenue"] is None and q[0]["inventory"] is None
    # Una variación de circulante negativa es un dato, no un error de signo.
    assert q[0]["change_inventory"] == -3.0
    assert q[0]["fuentes"]["revenue"]["etiqueta"] == "R"
    assert r["partidas_descartadas"] == 2
