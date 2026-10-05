"""Contribución al riesgo: peso y riesgo no son lo mismo, y lo desconocido no es cero."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pytest

from app import contexto_cartera
from app.analysis import portfolio_risk as pr

INICIO = date(2025, 1, 1)


def _serie(retornos, inicio=INICIO, precio=100.0):
    puntos, p = [(inicio, precio)], precio
    for i, r in enumerate(retornos, start=1):
        p *= 1 + r
        puntos.append((inicio + timedelta(days=i), p))
    return puntos


def _ruido(semilla, vol_anual, n=300):
    return np.random.default_rng(semilla).normal(0, vol_anual / np.sqrt(252), n)


def _pos(symbol, peso, **kw):
    return {"symbol": symbol, "peso": peso, **kw}


def test_una_posicion_pequena_y_muy_volatil_aporta_mas_riesgo_que_dinero():
    series = {"SMALL": _serie(_ruido(1, 0.90)), "BIG": _serie(_ruido(2, 0.10))}
    r = pr.contribucion_al_riesgo([_pos("SMALL", 0.12), _pos("BIG", 0.88)], series)
    small = next(x for x in r["posiciones"] if x["symbol"] == "SMALL")
    big = next(x for x in r["posiciones"] if x["symbol"] == "BIG")
    assert small["contribucion"] > 0.5 > small["peso"]
    assert small["riesgo_por_peso"] > 1 > big["riesgo_por_peso"]
    assert r["posiciones"][0]["symbol"] == "SMALL"  # ordenadas por riesgo, no por peso


def test_la_descomposicion_suma_exactamente_la_volatilidad_de_la_cartera():
    series = {s: _serie(_ruido(i, 0.3)) for i, s in enumerate("ABC")}
    r = pr.contribucion_al_riesgo([_pos("A", 0.5), _pos("B", 0.3), _pos("C", 0.2)], series)
    assert sum(x["componente"] for x in r["posiciones"]) == pytest.approx(r["volatilidad_cartera_medida"], rel=1e-4)
    assert sum(x["contribucion"] for x in r["posiciones"]) == pytest.approx(1.0, abs=1e-4)


def test_posiciones_muy_correlacionadas_forman_un_cluster():
    base = _ruido(3, 0.3)
    series = {
        "NVDA": _serie(base),
        "AMD": _serie(base + _ruido(4, 0.03)),
        "KO": _serie(_ruido(5, 0.15)),
    }
    r = pr.contribucion_al_riesgo([_pos("NVDA", 0.3), _pos("AMD", 0.3), _pos("KO", 0.4)], series)
    cluster = next(c for c in r["clusters"] if c["dimension"] == "correlacion")
    assert cluster["miembros"] == ["AMD", "NVDA"]
    por = {x["symbol"]: x for x in r["posiciones"]}
    assert por["NVDA"]["cluster_nivel"] == "alto" and por["KO"]["cluster_nivel"] != "alto"
    # 60 % del dinero, bastante más del 60 % del riesgo.
    assert cluster["peso"] == pytest.approx(0.6) and cluster["contribucion"] > 0.8


def test_historico_insuficiente_es_desconocido_no_riesgo_cero():
    series = {"A": _serie(_ruido(6, 0.3)), "B": _serie(_ruido(7, 0.3)), "NEW": _serie(_ruido(8, 0.3, n=10))}
    r = pr.contribucion_al_riesgo([_pos("A", 0.4), _pos("B", 0.4), _pos("NEW", 0.2)], series)
    assert {x["symbol"] for x in r["posiciones"]} == {"A", "B"}
    nueva = next(d for d in r["desconocidas"] if d["symbol"] == "NEW")
    assert nueva["estado"] == "desconocido" and "insuficiente" in nueva["motivo"]
    assert r["cobertura_peso"] == pytest.approx(0.8)
    assert "DESCONOCIDO" in r["nota"] and "mayor que el medido" in r["nota"]


def test_una_posicion_sin_precio_no_tiene_peso_ni_riesgo_cero():
    series = {"A": _serie(_ruido(9, 0.3)), "B": _serie(_ruido(10, 0.3))}
    r = pr.contribucion_al_riesgo(
        [_pos("A", 0.5), _pos("B", 0.5), {"symbol": "X", "peso": None, "motivo": "sin precio: fuera de los pesos"}],
        series,
    )
    x = next(d for d in r["desconocidas"] if d["symbol"] == "X")
    assert x["motivo"].startswith("sin precio")
    assert all(p["symbol"] != "X" for p in r["posiciones"])


def test_sin_ninguna_serie_el_riesgo_es_desconocido():
    r = pr.contribucion_al_riesgo([_pos("A", 1.0)], {})
    assert r["disponible"] is False and "no cero" in r["nota"]


def test_top3_por_capital_frente_a_top3_por_riesgo():
    series = {s: _serie(_ruido(20 + i, v)) for i, (s, v) in enumerate([("A", .1), ("B", .1), ("C", .1), ("D", .9), ("E", .9)])}
    r = pr.contribucion_al_riesgo(
        [_pos("A", .3), _pos("B", .25), _pos("C", .25), _pos("D", .1), _pos("E", .1)], series)
    c = r["concentracion"]
    assert c["top3_capital"]["symbols"] == ["A", "B", "C"] and c["top3_capital"]["peso"] == pytest.approx(0.8)
    assert set(c["top3_riesgo"]["symbols"][:2]) == {"D", "E"}


def test_una_accion_en_otra_moneda_se_mide_en_dolares_con_el_tipo_de_cada_dia():
    """Plana en dólares canadienses; el tipo se mueve: en dólares SÍ tiene riesgo."""
    plana = [(INICIO + timedelta(days=i), 50.0) for i in range(300)]
    tipos = {"CAD": _serie(_ruido(11, 0.08), precio=1.35)}
    convertida = contexto_cartera.convertir_serie(plana, "CAD", tipos)
    assert convertida[0][1] == pytest.approx(50.0 / 1.35)
    r = pr.contribucion_al_riesgo([_pos("SHOP.TO", 1.0)], {"SHOP.TO": convertida})
    assert r["posiciones"][0]["volatilidad"] > 0.03
    # Sin serie de tipos no se convierte: no se supone dólar.
    assert contexto_cartera.convertir_serie(plana, "CAD", {}) is None


def test_la_beta_frente_al_mercado_se_calcula_si_hay_indice():
    mercado = _ruido(12, 0.2)
    series = {"HI": _serie(1.5 * mercado + _ruido(13, 0.05)), "LO": _serie(0.5 * mercado + _ruido(14, 0.05))}
    r = pr.contribucion_al_riesgo([_pos("HI", .5), _pos("LO", .5)], series, mercado=_serie(mercado))
    por = {x["symbol"]: x for x in r["posiciones"]}
    assert por["HI"]["beta_mercado"] == pytest.approx(1.5, abs=0.15)
    assert any(c["dimension"] == "beta" for c in r["clusters"]) is False  # un solo miembro no es un grupo


def test_anadir_algo_correlacionado_sube_el_riesgo_y_algo_independiente_lo_baja():
    base = _ruido(15, 0.3)
    series = {"A": _serie(base), "B": _serie(_ruido(16, 0.3))}
    pos = [_pos("A", 0.5), _pos("B", 0.5)]
    gemela = pr.riesgo_de_anadir(pos, series, "A2", _serie(base + _ruido(17, 0.02)), 0.10)
    independiente = pr.riesgo_de_anadir(pos, series, "Z", _serie(_ruido(18, 0.3)), 0.10)
    assert gemela["volatilidad_despues"] > independiente["volatilidad_despues"]
    assert gemela["correlacion_con_cartera"] > independiente["correlacion_con_cartera"]
    assert gemela["cluster_nivel"] == "alto"


def test_el_endpoint_con_la_cartera_de_la_base(session_factory):
    from datetime import datetime, timezone

    from fastapi.testclient import TestClient

    from app.db.engine import get_session
    from app.db.models import Instrument, Position
    from app.deps import get_service
    from app.main import app
    from tests.fakes_empresa import ServicioFalso

    ahora = datetime(2026, 9, 12, tzinfo=timezone.utc)
    servicio = ServicioFalso(ahora)
    servicio.empresa("AAA", precio=100.0, score=None)
    servicio.empresa("BBB", precio=50.0, score=None)
    servicio.historias["BBB"] = [{"ts": b["ts"], "close": b["close"] * (1 + 0.01 * ((i % 7) - 3))}
                                 for i, b in enumerate(servicio.historias["BBB"])]
    servicio.empresa("CAD1", precio=20.0, score=None, moneda="CAD")
    with session_factory() as s:
        for sym, cur in (("AAA", "USD"), ("BBB", "USD"), ("CAD1", "CAD"), ("NOPRICE", "USD")):
            inst = Instrument(symbol=sym, currency=cur)
            s.add(inst)
            s.commit()
            s.add(Position(instrument_id=inst.id, quantity=10, cost_basis=10.0, opened_at=ahora - timedelta(days=30)))
        s.commit()

    def override():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_session] = override
    app.dependency_overrides[get_service] = lambda: servicio
    try:
        c = TestClient(app)
        # Sin `descargar`, solo la caché: el falso no tiene nada guardado.
        assert c.get("/api/portfolio/contribucion").json()["posiciones"] == []
        r = c.get("/api/portfolio/contribucion?descargar=true").json()
    finally:
        app.dependency_overrides.clear()
    assert {p["symbol"] for p in r["posiciones"]} == {"AAA", "BBB"}
    motivos = {d["symbol"]: d["motivo"] for d in r["desconocidas"]}
    assert motivos["NOPRICE"].startswith("sin precio")
    assert "tipo de cambio" in motivos["CAD1"]  # FRED no disponible en el falso: fuera, no «dólar»
    assert r["cobertura_peso"] == pytest.approx(1.0)  # CAD1 y NOPRICE no tienen peso medible


def test_el_analisis_de_empresa_dice_cuanto_riesgo_aporta_o_aportaria(session_factory):
    from datetime import datetime, timezone

    from app.db.models import Instrument, Position
    from app.routers.empresa import analizar_y_congelar
    from tests.fakes_empresa import ServicioFalso, financieros_base

    ahora = datetime(2026, 9, 12, 14, 0, tzinfo=timezone.utc)
    servicio = ServicioFalso(ahora)
    servicio.empresa("AAPL", precio=104.0, score=0.6, periodos=financieros_base())
    servicio.empresa("KO", precio=60.0, score=None)
    ruido = _ruido(30, 0.15, n=259)
    servicio.historias["KO"] = [{"ts": d.isoformat(), "close": p}
                                for d, p in _serie(ruido, inicio=ahora.date() - timedelta(days=259))]
    for sym in ("AAPL", "KO"):
        servicio.cache.set("price_history_long", {"symbol": sym}, {"bars": servicio.historias[sym]})
    with session_factory() as s:
        inst = Instrument(symbol="KO", currency="USD")
        s.add(inst)
        s.commit()
        s.add(Position(instrument_id=inst.id, quantity=10, cost_basis=50.0, opened_at=ahora - timedelta(days=90)))
        s.commit()
        fuera = analizar_y_congelar("AAPL", servicio, s, ahora=ahora, con_pares=False)["analisis"]["riesgo"]
        dentro = analizar_y_congelar("KO", servicio, s, ahora=ahora, con_pares=False)["analisis"]["riesgo"]
    assert fuera["estado"] == "valido" and fuera["en_cartera"] is False
    assert 0 < fuera["peso_supuesto"] <= 0.10 and fuera["contribucion"] is not None
    assert dentro["en_cartera"] is True and dentro["contribucion"] == pytest.approx(1.0)
