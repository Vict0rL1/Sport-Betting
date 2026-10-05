"""Coste de oportunidad: ¿es esta idea MEJOR que lo que ya tengo? Y NO TRADE si no
lo es claramente."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.analysis import coste_de_oportunidad as oc
from app.analysis import sizing

IDEA = {"symbol": "MSFT", "accion": "comprar", "tesis": "intacta", "valoracion": "razonable", "confianza": "media"}
# Atractivo de la idea: comprar 2 + intacta 1 + razonable 0 + media 0 = 3.


def _pos(symbol="A", **kw):
    base = {"symbol": symbol, "peso": 0.10, "accion": "mantener", "tesis": "intacta", "valoracion": "razonable",
            "confianza": "media", "precio": 100.0, "coste_medio": 100.0, "dias_en_cartera": 200}
    return {**base, **kw}


def _evaluar(posiciones, efectivo=0.0, tamano=0.042, **kw):
    return oc.evaluar(IDEA, posiciones, tamano_maximo=tamano, efectivo=efectivo, coste_por_lado_pct=0.15, **kw)


def test_con_efectivo_suficiente_no_hace_falta_vender_nada():
    r = _evaluar([_pos()], efectivo=0.05)
    assert r["veredicto"]["accion"] == "COMPRAR_CON_EFECTIVO"
    assert r["tamano"]["financiacion_necesaria"] == 0


def test_cartera_llena_e_idea_claramente_superior_se_revisa_la_peor_posicion():
    mala = _pos("BAD", accion="vender", tesis="puntos_cruzados", valoracion="cara")
    buena = _pos("GOOD", valoracion="barata")
    r = _evaluar([buena, mala], efectivo=0.01)
    v = r["veredicto"]
    assert v["accion"] == "REVISAR_PARA_FINANCIAR" and v["revisar"] == "BAD"
    assert "no una orden de venta" in v["motivo"]
    assert r["tamano"] == {"maximo_permitido": 0.042, "efectivo_disponible": 0.01, "financiacion_necesaria": 0.032}
    primera = r["candidatos_a_revisar"][0]
    assert primera["symbol"] == "BAD"
    # Por qué A antes que B: cada punto con su criterio.
    criterios = {d["criterio"]: d["puntos"] for d in primera["prioridad"]["desglose"]}
    assert criterios == {"senal": 3, "tesis": 3, "valoracion": 2}
    assert primera["mejora"] == 3 - (-3 - 2 - 1) and primera["supera_umbral"] is True
    assert "puedes comprar esa parte" in v["motivo"]


def test_una_diferencia_pequena_es_no_trade():
    r = _evaluar([_pos(tesis="sin_tesis")])  # atractivo 0 frente a 3: mejora 3 < 3 + coste
    v = r["veredicto"]
    assert v["accion"] == "NO_TRADE"
    fila = r["candidatos_a_revisar"][0]
    assert fila["mejora"] == 3 and fila["mejora_requerida"] == oc.MEJORA_MINIMA + 1
    assert "no supera lo que ya tienes" in v["motivo"]


def test_una_posicion_con_la_tesis_invalidada_sube_en_la_lista():
    r = _evaluar([_pos("OK"), _pos("ROTA", tesis="puntos_cruzados")])
    assert r["candidatos_a_revisar"][0]["symbol"] == "ROTA"
    assert any(d["criterio"] == "tesis" and d["puntos"] == 3 for d in r["candidatos_a_revisar"][0]["prioridad"]["desglose"])


def test_la_posicion_muy_correlacionada_con_la_idea_se_revisa_antes():
    r = _evaluar([_pos("INDEP", correlacion_con_candidata=0.1), _pos("GEMELA", correlacion_con_candidata=0.88)])
    primera = r["candidatos_a_revisar"][0]
    assert primera["symbol"] == "GEMELA"
    assert any(d["criterio"] == "correlacion" for d in primera["prioridad"]["desglose"])


def test_los_costes_de_vender_hacen_que_el_cambio_no_compense():
    mala = _pos("BAD", accion="vender", tesis="puntos_cruzados", precio=400.0, coste_medio=100.0)
    sin_impuestos = _evaluar([mala], tipo_impositivo=0.0)
    assert sin_impuestos["veredicto"]["accion"] == "REVISAR_PARA_FINANCIAR"
    con_impuestos = _evaluar([mala], tipo_impositivo=0.25)
    coste = con_impuestos["candidatos_a_revisar"][0]["coste_del_cambio"]
    assert coste["impuestos_pct"] == pytest.approx(0.75 * 25)  # 3/4 del importe es plusvalía
    assert con_impuestos["veredicto"]["accion"] == "NO_TRADE"


def test_impuestos_desconocidos_con_plusvalia_no_cuentan_como_cero():
    r = _evaluar([_pos(precio=150.0, coste_medio=100.0)])
    c = r["candidatos_a_revisar"][0]
    assert c["coste_del_cambio"]["impuestos"] == "desconocidos" and c["coste_del_cambio"]["impuestos_pct"] is None
    assert "MAYOR" in c["coste_del_cambio"]["nota"]
    assert c["mejora_requerida"] == oc.MEJORA_MINIMA + 1 + oc.PUNTOS_PRUDENCIA_IMPUESTOS


def test_lo_recien_comprado_no_se_rota():
    r = _evaluar([_pos("NUEVA", accion="vender", tesis="puntos_cruzados", dias_en_cartera=10)])
    fila = r["candidatos_a_revisar"][0]
    assert fila["elegible"] is False and "tenencia mínima" in fila["motivo"]
    assert r["veredicto"]["accion"] == "NO_TRADE"


def test_sin_efectivo_conocido_es_indeterminado_pero_dice_que_se_revisaria():
    r = _evaluar([_pos("BAD", accion="vender", tesis="puntos_cruzados")], efectivo=None)
    v = r["veredicto"]
    assert v["accion"] == "INDETERMINADO" and "Anota tu efectivo" in v["motivo"]
    assert v["si_no_hubiera_efectivo"] == "BAD"


def test_sin_senal_de_compra_no_hay_nada_que_financiar():
    r = oc.evaluar({**IDEA, "accion": "vigilar"}, [_pos()], tamano_maximo=0.04, efectivo=0.0, coste_por_lado_pct=0.15)
    assert r["veredicto"]["accion"] == "NO_ACCION"


def test_si_no_cabe_por_limites_no_trade():
    assert _evaluar([_pos()], tamano=0.0)["veredicto"]["accion"] == "NO_TRADE"


def test_si_no_cabe_pero_el_efectivo_es_desconocido_no_se_concluye():
    """Sin efectivo, «no cabe» sale de suponer la cartera invertida al 100 %."""
    r = _evaluar([_pos()], tamano=0.0, efectivo=None)
    assert r["veredicto"]["accion"] == "INDETERMINADO" and "Anota tu efectivo" in r["veredicto"]["motivo"]


def test_una_posicion_casi_desconocida_no_se_compara():
    r = _evaluar([_pos("X", accion=None, tesis=None, valoracion=None, confianza=None)])
    assert r["candidatos_a_revisar"][0]["elegible"] is False


def test_la_valoracion_se_lee_contra_el_crecimiento_historico():
    assert oc.lectura_de_valoracion(0.03, 0.08) == "barata"
    assert oc.lectura_de_valoracion(0.15, 0.08) == "cara"
    assert oc.lectura_de_valoracion(0.09, 0.08) == "razonable"
    assert oc.lectura_de_valoracion(None, 0.08) is None


def test_la_evidencia_baja_reduce_el_tamano_y_se_declara():
    base = {"symbol": "X", "sector": "T", "peso_bruto_pct": 8.0, "vol_anual_pct": 20.0}
    normal = sizing.dimensionar([base], objetivo_vol_pct=100)
    baja = sizing.dimensionar([{**base, "confianza": "baja"}], objetivo_vol_pct=100)
    assert baja["pesos"]["X"] == pytest.approx(normal["pesos"]["X"] / 2)
    assert any(c["limite"] == "evidencia" for c in baja["controles"])
    assert any("evidencia BAJA" in r for r in baja["recortes"])


# --- Con la base y el análisis completo ---------------------------------------------


def test_el_analisis_incluye_el_coste_de_oportunidad_con_efectivo_anotado(session_factory):
    from fastapi.testclient import TestClient

    from app.db.engine import get_session
    from app.db.models import Instrument, Position
    from app.deps import get_service
    from app.main import app
    from tests.fakes_empresa import ServicioFalso, financieros_base

    ahora = datetime.now(timezone.utc)
    servicio = ServicioFalso(ahora)
    servicio.empresa("MSFT", precio=104.0, score=0.6, periodos=financieros_base())
    servicio.empresa("OLD", precio=60.0, score=None)
    # Una serie que no se mueve con la idea: si no, el tope por correlación
    # (con el libro entero en ella) la dejaría sin hueco, y con razón.
    servicio.historias["OLD"] = [{"ts": b["ts"], "close": 60.0 * (1 + 0.02 * ((i * 7919) % 13 - 6) / 6)}
                                 for i, b in enumerate(servicio.historias["OLD"])]
    for sym in ("MSFT", "OLD"):
        servicio.cache.set("price_history_long", {"symbol": sym}, {"bars": servicio.historias[sym]})
    with session_factory() as s:
        inst = Instrument(symbol="OLD", currency="USD")
        s.add(inst)
        s.commit()
        s.add(Position(instrument_id=inst.id, quantity=100, cost_basis=50.0, opened_at=ahora - timedelta(days=200)))
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
        sin = c.get("/api/empresa/MSFT/analisis?pares=false").json()["analisis"]["coste_oportunidad"]
        assert sin["efectivo"]["estado"] == "desconocido"
        assert sin["veredicto"]["accion"] == "INDETERMINADO"
        assert c.post("/api/portfolio/efectivo", json={"moneda": "USD", "importe": 100000}).status_code == 200
        assert c.post("/api/portfolio/efectivo", json={"moneda": "USD", "importe": -1}).status_code == 422
        con = c.get("/api/empresa/MSFT/analisis?pares=false").json()["analisis"]["coste_oportunidad"]
        assert con["veredicto"]["accion"] == "COMPRAR_CON_EFECTIVO"
        assert con["tamano"]["maximo_permitido"] > 0
        assert c.get("/api/portfolio/efectivo").json()["saldos"][0]["importe"] == 100000
    finally:
        app.dependency_overrides.clear()
