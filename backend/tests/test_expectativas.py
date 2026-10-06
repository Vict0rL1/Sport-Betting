"""Expectation vs Reality.

Los casos que pide el diseño, uno por uno: beat de ingresos con margen por
debajo; guidance a la baja; datos parcialmente ausentes; consenso y modelo
interno por separado; y marcas de tiempo que impiden registrar como
expectativa algo que ya se sabía.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import sessionmaker

from app import expectativas as svc
from app.analysis import expectativas as ev
from app.db.migraciones import migrar
from app.db.models import CatalystEvent, EarningsAnalysis, EventActual, Expectation, Instrument, Thesis, ThesisTrigger
from tests.fakes_empresa import ServicioFalso, trimestre

ANTES = "2026-10-01T12:00:00+00:00"
EVENTO = {"id": 1, "symbol": "AAPL", "tipo": "earnings", "periodo": "2026-Q3", "fecha_prevista": "2026-10-30"}


def _exp(metrica, valor=None, fuente_tipo="consenso", fuente="finnhub", registrado=ANTES, **kw):
    return {"metrica": metrica, "valor": valor, "fuente_tipo": fuente_tipo, "fuente": fuente,
            "registrado_en": registrado, "unidad": ev.METRICAS.get(metrica, {}).get("unidad"), **kw}


def _real(metrica, valor, publicado="2026-10-30", **kw):
    return {"metrica": metrica, "valor": valor, "publicado": publicado, **kw}


# --- La lectura del evento ------------------------------------------------------


def test_batir_en_ingresos_con_el_margen_por_debajo_no_es_un_buen_trimestre():
    r = ev.evaluar_evento(
        EVENTO,
        [_exp("revenue", 15.2e9), _exp("operating_margin", 0.22, fuente_tipo="modelo_interno", fuente="app")],
        [_real("revenue", 15.8e9), _real("operating_margin", 0.20)],
    )
    ingresos = r["por_fuente"]["consenso"][0]
    assert ingresos["lectura"] == "supera" and ingresos["sorpresa"] == pytest.approx(15.8 / 15.2 - 1, abs=1e-6)
    margen = r["por_fuente"]["modelo_interno"][0]
    assert margen["lectura"] == "por_debajo" and margen["sorpresa"] == pytest.approx(-0.02)
    assert r["clasificacion"] == "mixto"
    assert any("Ingresos" in x for x in r["a_favor"]) and any("Margen" in x for x in r["en_contra"])


def test_beat_con_guidance_a_la_baja_tampoco_es_positivo():
    guia = _real("guidance", None, detalle={"direccion": "baja"})
    r = ev.evaluar_evento(EVENTO, [_exp("revenue", 100.0)], [_real("revenue", 105.0), guia])
    assert r["guidance"] == "baja"
    assert r["clasificacion"] == "mixto" and "guidance a la baja" in r["en_contra"]


def test_guidance_a_la_baja_con_lo_demas_en_linea_es_deterioro():
    guia = _real("guidance", None, detalle={"direccion": "baja"})
    r = ev.evaluar_evento(EVENTO, [_exp("revenue", 100.0)], [_real("revenue", 100.5), guia])
    assert r["por_fuente"]["consenso"][0]["lectura"] == "en_linea"
    assert r["clasificacion"] == "deterioro"


def test_datos_parcialmente_ausentes_se_dicen_y_no_valen_cero():
    r = ev.evaluar_evento(EVENTO, [_exp("revenue", 100.0), _exp("eps_diluted", 1.5)], [_real("revenue", 103.0)])
    eps = next(c for c in r["por_fuente"]["consenso"] if c["metrica"] == "eps_diluted")
    assert eps["lectura"] == "desconocido" and eps["real"] is None and "sorpresa" not in eps
    assert r["parcial"] is True and r["sin_resultado"] == ["eps_diluted"]
    assert r["clasificacion"] == "mejora_fundamental"


def test_sin_ningun_resultado_es_desconocido():
    r = ev.evaluar_evento(EVENTO, [_exp("revenue", 100.0)], [])
    assert r["clasificacion"] == "desconocido"


def test_consenso_y_modelo_interno_no_se_mezclan():
    r = ev.evaluar_evento(
        EVENTO,
        [_exp("revenue", 100.0), _exp("revenue", 110.0, fuente_tipo="modelo_interno", fuente="app")],
        [_real("revenue", 104.0)],
    )
    assert set(r["por_fuente"]) == {"consenso", "modelo_interno"}
    assert r["por_fuente"]["consenso"][0]["lectura"] == "supera"
    assert r["por_fuente"]["modelo_interno"][0]["lectura"] == "por_debajo"
    # Para el conjunto vota una fuente por métrica: el consenso. No dos veces.
    assert r["clasificacion"] == "mejora_fundamental" and len(r["a_favor"]) == 1


def test_un_rango_de_guidance_se_lee_como_rango():
    e = _exp("revenue", None, fuente_tipo="guidance", fuente="8-K", bajo=90.0, alto=100.0)
    assert ev.comparar_metrica(e, 95.0)["lectura"] == "en_linea"
    assert ev.comparar_metrica(e, 102.0)["sorpresa"] == pytest.approx(0.02)
    assert ev.comparar_metrica(e, 85.0)["lectura"] == "por_debajo"


def test_un_bpa_negativo_no_produce_porcentajes_absurdos():
    c = ev.comparar_metrica(_exp("eps_diluted", -0.10), -0.05)
    assert c["tipo_sorpresa"].startswith("absoluta") and c["sorpresa"] == pytest.approx(0.05)


# --- Sin información futura -----------------------------------------------------------


def test_una_expectativa_registrada_despues_del_evento_no_cuenta():
    tarde = _exp("revenue", 104.0, registrado="2026-11-02T09:00:00+00:00")
    r = ev.evaluar_evento(EVENTO, [tarde], [_real("revenue", 104.0)])
    assert r["por_fuente"] == {} and "después de conocerse" in r["excluidas_por_fecha"][0]["motivo"]


def test_el_mismo_dia_del_evento_no_basta():
    """Los resultados salen antes de abrir o después de cerrar: el día no dice cuál."""
    mismo = _exp("revenue", 104.0, registrado="2026-10-30T08:00:00+00:00")
    r = ev.evaluar_evento(EVENTO, [mismo], [_real("revenue", 104.0)])
    assert r["excluidas_por_fecha"] and "mismo día" in r["excluidas_por_fecha"][0]["motivo"]


def test_el_corte_es_la_primera_publicacion_aunque_no_hubiera_fecha_prevista():
    evento = {**EVENTO, "fecha_prevista": None}
    tarde = _exp("revenue", 104.0, registrado="2026-11-05T09:00:00+00:00")
    r = ev.evaluar_evento(evento, [tarde], [_real("revenue", 104.0, publicado="2026-11-03")])
    assert r["corte"] == "2026-11-03" and r["excluidas_por_fecha"]


# --- Guidance extraído por IA -------------------------------------------------------------


def test_el_guidance_entra_solo_con_cita_verificada_y_periodo_asignable():
    ext = {"form_type": "8-K", "accession_no": "X-1", "filed_at": "2026-07-30", "model": "m",
           "datos": {"guidance": [
               {"metrica": "Ingresos", "periodo": "Q3 2026", "valor_bajo": 15.0, "valor_alto": 15.5,
                "unidad": "miles de millones USD", "texto_literal": "...", "cita_verificada": True},
               {"metrica": "Margen bruto", "periodo": "tercer trimestre de 2026", "valor_bajo": 45.0,
                "valor_alto": 46.0, "unidad": "%", "texto_literal": "...", "cita_verificada": True},
               {"metrica": "EPS", "periodo": "Q3 2026", "valor_bajo": 1.5, "valor_alto": 1.5,
                "unidad": "USD por acción", "texto_literal": "...", "cita_verificada": False},
               {"metrica": "Ingresos", "periodo": "FY2027", "valor_bajo": 60, "valor_alto": 62,
                "unidad": "miles de millones USD", "texto_literal": "...", "cita_verificada": True},
           ]}}
    g = ev.guidance_como_expectativas([ext], "2026-Q3")
    por = {x["metrica"]: x for x in g["expectativas"]}
    assert por["revenue"]["bajo"] == 15.0e9 and por["revenue"]["alto"] == 15.5e9
    assert por["gross_margin"]["bajo"] == pytest.approx(0.45)
    assert por["revenue"]["detalle"]["generado_por"] == "ia"
    motivos = " ".join(d["motivo"] for d in g["descartadas"])
    assert "no verificada" in motivos and "FY2027" in motivos


# --- Modelo interno ---------------------------------------------------------------------------


def _trimestres_historicos():
    """Ocho trimestres: ingresos +10 % interanual, margen operativo del 20 %."""
    qs = []
    for ano in (2025, 2026):
        for q in (1, 2, 3, 4):
            if ano == 2026 and q > 2:
                continue
            base = 100.0 * (1.1 if ano == 2026 else 1.0) + q
            qs.append(trimestre(ano, q, f"{ano}-{q * 3 + 1:02d}-28" if q < 4 else f"{ano + 1}-02-10",
                                revenue=base, operating_income=base * 0.2, gross_profit=base * 0.45,
                                eps_diluted=base / 100))
    return qs


def test_el_modelo_interno_declara_su_metodo():
    est = {x["metrica"]: x for x in ev.estimacion_interna(_trimestres_historicos(), "2026-09-30")}
    assert est["revenue"]["valor"] == pytest.approx(103.0 * (1 + est["revenue"]["detalle"]["crecimiento_mediano"]))
    assert "mediana" in est["revenue"]["detalle"]["metodo"]
    assert est["operating_margin"]["valor"] == pytest.approx(0.2)


# --- Calibración ------------------------------------------------------------------------------


def test_la_calibracion_separa_fuentes_y_conserva_el_signo_del_sesgo():
    pares = (
        [{"symbol": "AAA", "metrica": "revenue", "fuente_tipo": "consenso", "esperado": 100.0, "real": 102.0}] * 6
        + [{"symbol": "BBB", "metrica": "revenue", "fuente_tipo": "consenso", "esperado": 100.0, "real": 90.0}] * 2
        + [{"symbol": "AAA", "metrica": "revenue", "fuente_tipo": "modelo_interno", "esperado": 100.0, "real": 102.0}] * 3
    )
    c = ev.calibrar(pares)
    cons = c["por_fuente"]["consenso"]
    assert cons["total"]["n"] == 8 and cons["total"]["suficiente"]
    assert cons["total"]["sesgo"] == pytest.approx((6 * 0.02 - 2 * 0.10) / 8)
    assert cons["empresas_menos_previsibles"][0] == "BBB"
    assert c["por_fuente"]["modelo_interno"]["total"]["suficiente"] is False


# --- Con base de datos y fuentes ---------------------------------------------------------------


AHORA = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def servicio():
    s = ServicioFalso(AHORA)
    s.financials["AAPL"] = {"periods": [], "quarters": _trimestres_historicos(), "as_of": AHORA.isoformat()}
    s.calendario = [{"symbol": "AAPL", "date": "2026-10-30", "eps_estimate": 1.2, "revenue_estimate": 115.0,
                     "eps_actual": None, "revenue_actual": None}]
    return s


def _tesis(s):
    inst = Instrument(symbol="AAPL")
    s.add(inst)
    s.commit()
    t = Thesis(instrument_id=inst.id, title="t", body_md="b", created_at=AHORA - timedelta(days=60),
               updated_at=AHORA - timedelta(days=60))
    s.add(t)
    s.commit()
    s.add(ThesisTrigger(thesis_id=t.id, kind="metrica", descripcion="margen operativo < 18 %",
                        config={"metrica": "operating_margin", "op": "lt", "umbral": 0.18}))
    s.add(ThesisTrigger(thesis_id=t.id, kind="noticia", descripcion="recall", config={"palabras": ["recall"]}))
    s.commit()


def test_capturar_antes_registrar_despues_y_leer(session_factory, servicio):
    with session_factory() as s:
        _tesis(s)
        e = svc.crear_evento(s, "AAPL", "earnings", periodo="2026-Q3", fecha_prevista="2026-10-30", ahora=AHORA)
        cap = svc.capturar(s, servicio, e, AHORA)
        tipos = {(x["fuente_tipo"], x["metrica"]) for x in cap["registradas"]}
        assert {("consenso", "revenue"), ("consenso", "eps_diluted"), ("modelo_interno", "revenue"),
                ("modelo_interno", "operating_margin"), ("reglas", "operating_margin")} <= tipos
        # Capturar dos veces no duplica.
        assert svc.capturar(s, servicio, e, AHORA + timedelta(hours=1))["registradas"] == []

        # Sale el trimestre: ingresos por encima, margen operativo al 18,5 %.
        servicio.financials["AAPL"]["quarters"].append(
            trimestre(2026, 3, "2026-10-30", revenue=118.0, operating_income=118.0 * 0.185,
                      gross_profit=118.0 * 0.45, eps_diluted=1.25))
        despues = datetime(2026, 11, 2, tzinfo=timezone.utc)
        servicio.ahora = despues
        reg = svc.registrar_reales(s, servicio, e, despues)
        assert {"revenue", "operating_margin", "eps_diluted"} <= set(reg["registrados"])
        lectura = svc.evaluar(s, e)
    assert lectura["por_fuente"]["consenso"][0]["lectura"] == "supera"
    impacto = {i["punto"]: i for i in lectura["impacto_en_tesis"]}
    # 18,5 % sigue por encima del 18 %, pero desde el 20 % previo: debilitada.
    assert impacto["margen operativo < 18 %"]["estado"] == "debilitado"
    assert impacto["recall"]["estado"] == "sin_resolver"


def test_capturar_cuando_el_resultado_ya_se_conoce_se_niega(session_factory, servicio):
    with session_factory() as s:
        e = svc.crear_evento(s, "AAPL", "earnings", periodo="2026-Q3", fecha_prevista="2026-10-30", ahora=AHORA)
        with pytest.raises(svc.EventoConocido):
            svc.capturar(s, servicio, e, datetime(2026, 10, 31, tzinfo=timezone.utc))
        with pytest.raises(svc.EventoConocido, match="mismo día"):
            svc.capturar(s, servicio, e, datetime(2026, 10, 30, 7, 0, tzinfo=timezone.utc))
        assert s.query(Expectation).count() == 0


def test_un_consenso_que_ya_trae_el_real_no_se_registra(session_factory, servicio):
    servicio.calendario[0].update(eps_actual=1.3, revenue_actual=120.0)
    with session_factory() as s:
        e = svc.crear_evento(s, "AAPL", "earnings", periodo="2026-Q3", fecha_prevista="2026-10-30", ahora=AHORA)
        cap = svc.capturar(s, servicio, e, AHORA)
    assert not any(x["fuente_tipo"] == "consenso" for x in cap["registradas"])
    assert any("ya trae el resultado real" in m for m in cap["sin_fuente"])


def test_las_expectativas_no_se_modifican_ni_se_borran(session_factory, servicio):
    with session_factory() as s:
        e = svc.crear_evento(s, "AAPL", "earnings", periodo="2026-Q3", fecha_prevista="2026-10-30", ahora=AHORA)
        svc.capturar(s, servicio, e, AHORA)
        x = s.query(Expectation).first()
        x.valor = 999.0
        with pytest.raises(ValueError, match="no se modifica"):
            s.commit()


def test_ni_con_sql_directo_sobre_una_base_migrada(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'x.db'}")
    migrar(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as s:
        e = svc.crear_evento(s, "AAPL", "earnings", periodo="2026-Q3", fecha_prevista="2026-10-30", ahora=AHORA)
        s.add(Expectation(event_id=e.id, metrica="revenue", fuente_tipo="usuario", fuente="yo", valor=1.0,
                          informacion_hasta=AHORA, registrado_en=AHORA))
        s.commit()
    for sql in ("UPDATE expectations SET valor = 2", "DELETE FROM expectations"):
        with pytest.raises(DatabaseError):
            with engine.begin() as c:
                c.execute(text(sql))
    with pytest.raises(DatabaseError):
        with engine.begin() as c:
            c.execute(text("INSERT INTO expectations (event_id, metrica, fuente_tipo, fuente, informacion_hasta, registrado_en) "
                           "VALUES (1, 'x', 'usuario', 'z', '2026-01-01', '2026-01-01')"))  # sin cifra: CHECK


def test_el_guidance_de_un_filing_analizado_se_captura_marcado(session_factory, servicio):
    with session_factory() as s:
        s.add(EarningsAnalysis(symbol="AAPL", kind="extraccion", form_type="8-K", accession_no="G-1",
                               source_url="https://www.sec.gov/x", filed_at="2026-07-30", doc_hash="h", model="m",
                               datos={"guidance": [{"metrica": "Revenue", "periodo": "Q3 2026", "valor_bajo": 110,
                                                    "valor_alto": 116, "unidad": "USD", "texto_literal": "x",
                                                    "cita_verificada": True}]}))
        s.commit()
        e = svc.crear_evento(s, "AAPL", "earnings", periodo="2026-Q3", fecha_prevista="2026-10-30", ahora=AHORA)
        svc.capturar(s, servicio, e, AHORA)
        g = s.query(Expectation).filter_by(fuente_tipo="guidance").one()
    assert (g.bajo, g.alto, g.fuente) == (110.0, 116.0, "8-K G-1")
    assert g.detalle["generado_por"] == "ia"


def test_calibracion_desde_la_base(session_factory, servicio):
    with session_factory() as s:
        e = svc.crear_evento(s, "AAPL", "earnings", periodo="2026-Q3", fecha_prevista="2026-10-30", ahora=AHORA)
        svc.capturar(s, servicio, e, AHORA)
        servicio.financials["AAPL"]["quarters"].append(trimestre(2026, 3, "2026-10-30", revenue=118.0))
        svc.registrar_reales(s, servicio, e, datetime(2026, 11, 2, tzinfo=timezone.utc))
        # Una expectativa «tardía» colada a mano no cuenta.
        s.add(Expectation(event_id=e.id, metrica="revenue", fuente_tipo="usuario", fuente="tarde", valor=118.0,
                          informacion_hasta=AHORA, registrado_en=datetime(2026, 11, 3, tzinfo=timezone.utc)))
        s.commit()
        c = svc.calibracion(s, "AAPL")
    assert c["por_fuente"]["consenso"]["total"]["n"] == 1
    assert "usuario" not in c["por_fuente"]


def test_los_endpoints(session_factory, servicio):
    from fastapi.testclient import TestClient

    from app.db.engine import get_session
    from app.deps import get_service
    from app.main import app

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
        e = c.post("/api/expectativas/eventos", json={"symbol": "aapl", "periodo": "2027-Q1",
                                                       "fecha_prevista": "2099-01-30"}).json()
        assert c.post("/api/expectativas/eventos", json={"symbol": "AAPL", "periodo": "2027-Q1"}).status_code == 409
        r = c.post(f"/api/expectativas/eventos/{e['id']}/expectativas",
                   json={"metrica": "kpi:suscriptores", "fuente": "mi estimación", "valor": 1.2e6})
        assert r.status_code == 200
        assert c.post(f"/api/expectativas/eventos/{e['id']}/expectativas",
                      json={"metrica": "kpi:suscriptores", "fuente": "mi estimación", "valor": 1.3e6}).status_code == 409
        assert c.post(f"/api/expectativas/eventos/{e['id']}/expectativas",
                      json={"metrica": "x", "fuente": "y"}).status_code == 422
        d = c.get(f"/api/expectativas/eventos/{e['id']}").json()
        assert d["expectativas_por_fuente"]["usuario"][0]["detalle"]["generado_por"] == "usuario"
        assert d["clasificacion"] == "desconocido"
        assert c.get("/api/expectativas/eventos/999").status_code == 404
        assert "por_fuente" in c.get("/api/expectativas/calibracion").json()
    finally:
        app.dependency_overrides.clear()


# --- Escala del consenso y del guidance --------------------------------------------------


def test_un_consenso_en_otra_escala_no_se_registra_y_se_dice(session_factory, servicio):
    """Ingresos esperados de 115 000 con trimestres de ~112: miles frente a
    unidades. Registrarlo daría una «sorpresa» del −99,9 % en la lectura y en
    la calibración del consenso."""
    servicio.calendario[0]["revenue_estimate"] = 115_000.0
    with session_factory() as s:
        e = svc.crear_evento(s, "AAPL", "earnings", periodo="2026-Q3", fecha_prevista="2026-10-30", ahora=AHORA)
        cap = svc.capturar(s, servicio, e, AHORA)
        consenso = {x.metrica: x for x in s.query(Expectation).filter_by(fuente_tipo="consenso")}
    assert "revenue" not in consenso
    assert any("revenue con escala dudosa" in m and "×1.03e+03" in m for m in cap["sin_fuente"])
    # El BPA, en su escala, entra con la comprobación a la vista.
    assert consenso["eps_diluted"].detalle["escala"]["estado"] == "ok"
    assert consenso["eps_diluted"].detalle["escala"]["periodo_referencia"] == "2026-06-30"


def test_un_guidance_en_otra_escala_que_los_trimestres_no_entra(session_factory, servicio):
    with session_factory() as s:
        s.add(EarningsAnalysis(symbol="AAPL", kind="extraccion", form_type="8-K", accession_no="G-2",
                               source_url="https://www.sec.gov/x", filed_at="2026-07-30", doc_hash="h2", model="m",
                               datos={"guidance": [{"metrica": "Revenue", "periodo": "Q3 2026", "valor_bajo": 110,
                                                    "valor_alto": 116, "unidad": "million USD", "texto_literal": "x",
                                                    "cita_verificada": True}]}))
        s.commit()
        e = svc.crear_evento(s, "AAPL", "earnings", periodo="2026-Q3", fecha_prevista="2026-10-30", ahora=AHORA)
        cap = svc.capturar(s, servicio, e, AHORA)
        assert s.query(Expectation).filter_by(fuente_tipo="guidance").count() == 0
    assert any(m.startswith("guidance: revenue con escala dudosa") for m in cap["sin_fuente"])


def test_la_escala_sin_referencia_o_con_perdidas_no_se_juzga():
    qs = _trimestres_historicos()
    assert ev.comprobar_escala({"metrica": "revenue", "valor": 115.0}, [])["estado"] == "sin_referencia"
    # De pérdida a beneficio es legítimo: la proporción no mide escala.
    perdidas = [{**qs[-1], "eps_diluted": -0.4}]
    assert ev.comprobar_escala({"metrica": "eps_diluted", "valor": 0.3}, perdidas)["estado"] == "sin_referencia"
    # Un rango se mide por su punto medio; unos ingresos no positivos, nunca.
    assert ev.comprobar_escala({"metrica": "revenue", "bajo": 100.0, "alto": 120.0}, qs)["estado"] == "ok"
    assert ev.comprobar_escala({"metrica": "revenue", "valor": 0.0}, qs)["estado"] == "dudosa"
    # Céntimos frente a dólares en el BPA: ×100.
    assert ev.comprobar_escala({"metrica": "eps_diluted", "valor": 112.0}, qs)["estado"] == "dudosa"
