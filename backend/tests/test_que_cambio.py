"""What Changed: solo lo material, la disponibilidad siempre, y la decisión explicada
por las reglas que cambiaron — no por un modelo de lenguaje."""

from __future__ import annotations

import copy
from datetime import timedelta

import pytest

from app.analysis import cambios, confianza
from app.db.models import DecisionSnapshot, Instrument, Position, Thesis, ThesisTrigger
from app.routers.empresa import analizar_y_congelar
from tests.fakes_empresa import AHORA, ServicioFalso, financieros_base


def _analisis(**metricas):
    """Un análisis mínimo con las métricas que interesan al diff."""
    m = {k: {"valor": v} for k, v in metricas.items()}
    return {"fundamentales": {"metricas": m}, "mercado": {"precio": {"valor": 100.0, "estado": "valido"}},
            "decision": {}, "tesis": {}}


def _todas(diff):
    return [c for lista in diff["categorias"].values() for c in lista]


def test_un_cambio_material_aparece_con_su_umbral():
    d = cambios.comparar(_analisis(operating_margin=0.200), _analisis(operating_margin=0.175))
    margen = next(c for c in _todas(d) if c["clave"] == "operating_margin")
    assert margen["tipo"] == "material" and margen["direccion"] == "baja"
    assert margen["absoluto"] == pytest.approx(-0.025)
    assert margen["umbral"] == {"tipo": "absoluto", "valor": 0.01}
    assert "operating_margin" in [c["clave"] for c in d["categorias"]["fundamentales"]]


def test_un_cambio_irrelevante_no_aparece_pero_se_cuenta():
    d = cambios.comparar(_analisis(operating_margin=0.2001), _analisis(operating_margin=0.2003))
    assert not any(c["clave"] == "operating_margin" for c in _todas(d))
    assert d["irrelevantes"] >= 1


def test_un_precio_que_se_mueve_un_1_por_ciento_no_es_noticia():
    a, b = _analisis(), _analisis()
    b["mercado"]["precio"]["valor"] = 101.0
    assert not any(c["clave"] == "precio" for c in _todas(cambios.comparar(a, b)))
    b["mercado"]["precio"]["valor"] = 104.5
    precio = next(c for c in _todas(cambios.comparar(a, b)) if c["clave"] == "precio")
    assert precio["relativo"] == pytest.approx(0.045)


def test_un_dato_que_aparece_se_ensena_siempre():
    d = cambios.comparar(_analisis(fcf=None), _analisis(fcf=10.0))
    fcf = next(c for c in _todas(d) if c["clave"] == "fcf")
    assert fcf["tipo"] == "dato_nuevo" and fcf["antes"] is None


def test_perder_un_dato_es_un_deterioro_de_disponibilidad():
    d = cambios.comparar(_analisis(gross_margin=0.4), _analisis(gross_margin=None))
    perdido = next(c for c in _todas(d) if c["clave"] == "gross_margin")
    assert perdido["tipo"] == "dato_perdido" and "DESCONOCIDO" in perdido["nota"]


def test_los_umbrales_son_configurables_y_viajan_versionados():
    a, b = _analisis(operating_margin=0.200), _analisis(operating_margin=0.195)
    assert not any(c["clave"] == "operating_margin" for c in _todas(cambios.comparar(a, b)))
    estrictos = copy.deepcopy(cambios.MATERIALIDAD)
    estrictos["operating_margin"]["umbral"] = 0.001
    d = cambios.comparar(a, b, umbrales=estrictos)
    assert any(c["clave"] == "operating_margin" for c in _todas(d))
    assert d["umbrales"]["version"] != cambios.version_materialidad()


# --- La decisión: BUY → HOLD con las reglas exactas ---------------------------


@pytest.fixture
def servicio():
    return ServicioFalso(AHORA).empresa("AAPL", precio=104.0, score=0.6, periodos=financieros_base())


def test_comprar_a_vigilar_nombra_exactamente_la_regla_que_cambio(session_factory, servicio):
    with session_factory() as s:
        primero = analizar_y_congelar("AAPL", servicio, s, ahora=AHORA, con_pares=False)
        assert primero["analisis"]["decision"]["action"] == "comprar"
        # El precio cae dentro de la banda de la media: la tendencia ya no acompaña.
        servicio.quotes["AAPL"]["price"] = 92.0
        segundo = analizar_y_congelar("AAPL", servicio, s, ahora=AHORA + timedelta(hours=2), con_pares=False)
    d = segundo["cambios"]["decision"]
    assert (d["antes"], d["ahora"], d["cambio"]) == ("comprar", "vigilar", True)
    assert [c["regla"] for c in d["reglas_que_cambiaron"]] == ["tendencia_a_favor"]
    regla = d["reglas_que_cambiaron"][0]
    assert regla["antes"]["resultado"] == "cumple" and regla["ahora"]["resultado"] == "no_cumple"
    assert regla["ahora"]["valor"] == 92.0
    # La puntuación sigue cumpliendo; solo cambia su papel, y se dice aparte.
    assert [p["regla"] for p in d["papeles_que_cambiaron"]] == ["puntuacion_favorable"]
    assert any("tendencia" in e.lower() or "media" in e.lower() for e in d["explicacion"])
    assert d["generado_por"] == "app"


def test_comprar_a_mantener_explica_que_ahora_tienes_posicion(session_factory, servicio):
    with session_factory() as s:
        analizar_y_congelar("AAPL", servicio, s, ahora=AHORA, con_pares=False)
        inst = s.query(Instrument).filter_by(symbol="AAPL").one_or_none()
        if inst is None:
            inst = Instrument(symbol="AAPL")
            s.add(inst)
            s.commit()
        s.add(Position(instrument_id=inst.id, quantity=10, cost_basis=100.0, stop=90.0,
                       opened_at=AHORA + timedelta(hours=1)))
        s.commit()
        r = analizar_y_congelar("AAPL", servicio, s, ahora=AHORA + timedelta(hours=2), con_pares=False)
    d = r["cambios"]["decision"]
    assert (d["antes"], d["ahora"]) == ("comprar", "mantener")
    assert "tienes posición" in d["explicacion"][0]


def test_el_primer_analisis_no_inventa_cambios(session_factory, servicio):
    with session_factory() as s:
        r = analizar_y_congelar("AAPL", servicio, s, ahora=AHORA, con_pares=False)
    assert r["cambios"]["primer_analisis"] is True


def test_cambios_en_fundamentales_entre_dos_instantaneas(session_factory, servicio):
    with session_factory() as s:
        analizar_y_congelar("AAPL", servicio, s, ahora=AHORA, con_pares=False)
        # Llega el ejercicio siguiente: márgenes a la baja y un capex desconocido.
        servicio.financials["AAPL"]["periods"].append(
            {**servicio.financials["AAPL"]["periods"][-1], "fiscal_year": "2026",
             "end_date": "2026-12-31", "filed_at": "2027-02-10", "operating_income": 192.5,
             "revenue": 1100.0, "capex": None}
        )
        r = analizar_y_congelar("AAPL", servicio, s, ahora=AHORA + timedelta(days=200), con_pares=False)
    fund = {c["clave"]: c for c in r["cambios"]["categorias"]["fundamentales"]}
    assert fund["operating_margin"]["ahora"] == pytest.approx(0.175)
    assert fund["fcf"]["tipo"] == "dato_perdido"
    assert fund["ejercicio"]["antes"] == "2025" and fund["ejercicio"]["ahora"] == "2026"


# --- La tesis ------------------------------------------------------------------


def test_un_punto_que_salta_es_una_invalidacion_y_uno_nuevo_un_riesgo_vigilado():
    antes = {"disparadores": [
        {"id": 1, "descripcion": "margen < 18 %", "salta": False, "medible": True, "valor": 0.21, "umbral": 0.18},
        {"id": 2, "descripcion": "ROE < 10 %", "salta": False, "medible": True, "valor": 0.25, "umbral": 0.10},
        {"id": 3, "descripcion": "deuda", "salta": True, "medible": True, "valor": 2.0, "umbral": 1.5},
    ]}
    ahora = {"disparadores": [
        {"id": 1, "descripcion": "margen < 18 %", "salta": True, "medible": True, "valor": 0.17, "umbral": 0.18},
        {"id": 2, "descripcion": "ROE < 10 %", "salta": False, "medible": True, "valor": 0.12, "umbral": 0.10},
        {"id": 3, "descripcion": "deuda", "salta": False, "medible": True, "valor": 1.2, "umbral": 1.5},
        {"id": 4, "descripcion": "recall", "salta": False, "medible": True},
    ]}
    t = cambios.comparar_tesis(antes, ahora)
    assert [x["punto"] for x in t["invalidaciones"]] == ["margen < 18 %"]
    assert [x["punto"] for x in t["deteriorados"]] == ["ROE < 10 %"]
    assert [x["punto"] for x in t["confirmados"]] == ["deuda"]
    assert [x["punto"] for x in t["nuevos_riesgos"]] == ["recall"]


def test_un_punto_que_deja_de_medirse_es_un_riesgo_nuevo():
    antes = {"disparadores": [{"id": 1, "descripcion": "m", "salta": False, "medible": True}]}
    ahora = {"disparadores": [{"id": 1, "descripcion": "m", "salta": False, "medible": False}]}
    assert cambios.comparar_tesis(antes, ahora)["nuevos_riesgos"][0]["motivo"].startswith("ya no se puede medir")


# --- Confianza por evidencia ---------------------------------------------------


def test_la_confianza_baja_con_precio_viejo_y_lo_dice(session_factory, servicio):
    servicio.quotes["AAPL"].update(estado="viejo", antiguedad_segundos=900)
    with session_factory() as s:
        a = analizar_y_congelar("AAPL", servicio, s, ahora=AHORA, con_pares=False)["analisis"]
    c = a["confianza"]
    assert c["nivel"] == "baja" and c["criticos"] >= 1
    assert any("viejo" in r for r in c["razones"])
    assert c["regla"].startswith("crítico → BAJA")


def test_resultados_en_dos_dias_debilitan_la_confianza(session_factory, servicio):
    servicio.calendario = [{"symbol": "AAPL", "date": (AHORA + timedelta(days=2)).date().isoformat()}]
    with session_factory() as s:
        a = analizar_y_congelar("AAPL", servicio, s, ahora=AHORA, con_pares=False)["analisis"]
    factor = next(f for f in a["confianza"]["factores"] if f["id"] == "resultados_proximos")
    assert factor["estado"] == "debil" and "en 2 día(s)" in factor["detalle"]


def test_un_factor_desconocido_cuenta_como_debil_nunca_como_bueno():
    base = {"faltan": [], "mercado": {"precio": {"estado": "valido", "valor": 1.0}, "historico": {"sesiones": 260}},
            "fundamentales": {"ejercicios_disponibles": 5}, "valoracion": {}, "decision": {"confidence": "calibrada"}}
    c = confianza.evaluar(base, AHORA)
    sens = next(f for f in c["factores"] if f["id"] == "sensibilidad_valoracion")
    assert sens["estado"] == "desconocido"
    assert c["nivel"] != "alta"


def test_una_decision_al_borde_de_su_umbral_es_menos_estable(session_factory, servicio):
    servicio.senal("AAPL", 0.37)  # a 0,02 del umbral de compra
    with session_factory() as s:
        a = analizar_y_congelar("AAPL", servicio, s, ahora=AHORA, con_pares=False)["analisis"]
    est = next(f for f in a["confianza"]["factores"] if f["id"] == "estabilidad")
    assert est["estado"] == "debil" and "puntuación" in est["detalle"]
