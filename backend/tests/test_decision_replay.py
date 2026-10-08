"""Decision Replay: lo que el sistema sabía en su momento, y nada después.

Las garantías que piden estos tests, una por una:

- una decisión histórica no cambia aunque cambien los fundamentales de hoy;
- no entra información futura, ni al analizar ni al reproducir;
- cambiar el precio actual no modifica la instantánea;
- cambiar la tesis actual no modifica la instantánea;
- una instantánea incompleta se enseña incompleta y nunca inventa datos;
- abrir la misma empresa diez veces no crea diez decisiones.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app import analisis_empresa
from app import snapshots as sn
from app.db.models import DecisionSnapshot, Instrument, Position, Thesis, ThesisTrigger
from app.routers.empresa import analizar_y_congelar
from tests.fakes_empresa import AHORA, ServicioFalso, financieros_base


@pytest.fixture
def servicio():
    return ServicioFalso(AHORA).empresa("AAPL", precio=104.0, score=0.6, periodos=financieros_base())


def _congelar(s, servicio, cuando=AHORA):
    r = analizar_y_congelar("AAPL", servicio, s, ahora=cuando, con_pares=False)
    return s.get(DecisionSnapshot, r["instantanea"]["id"]), r


def test_el_analisis_trae_todo_lo_que_entra_en_la_decision(session_factory, servicio):
    with session_factory() as s:
        snap, r = _congelar(s, servicio)
    a = r["analisis"]
    assert a["decision"]["action"] == "comprar"
    assert snap.accion == "comprar" and snap.origen.startswith("analisis:")
    # Cada cifra con su linaje hasta el filing.
    ingresos = a["fundamentales"]["metricas"]["revenue"]
    assert ingresos["valor"] == 1100.0 and ingresos["formulario"] == "10-K"
    assert ingresos["publicado"] == "2026-02-10" and ingresos["accn"] == "A-2025"
    # Una métrica derivada nunca sin sus entradas.
    margen = a["fundamentales"]["metricas"]["operating_margin"]
    assert margen["valor"] == pytest.approx(0.21)
    assert margen["entradas"]["resultado_operativo"]["valor"] == 231.0
    assert a["mercado"]["precio"]["fuente"] == "finnhub"
    assert a["senal"]["origen"].startswith("lista diaria")
    assert a["generado_por"] == "app"


def test_una_decision_historica_no_cambia_aunque_cambien_los_fundamentales(session_factory, servicio):
    with session_factory() as s:
        snap, _ = _congelar(s, servicio)
        antes = sn.reproducir(snap)
        # Hoy la empresa presenta un año horrible.
        servicio.financials["AAPL"]["periods"][-1].update(revenue=10.0, operating_income=-500.0)
        _congelar(s, servicio, AHORA + timedelta(days=1))
        despues = sn.reproducir(s.get(DecisionSnapshot, snap.id))
    assert despues["secciones"] == antes["secciones"]
    assert despues["secciones"]["fundamentales"]["metricas"]["revenue"]["valor"] == 1100.0
    assert despues["integridad"]["huella_coincide"]


def test_cambiar_el_precio_actual_no_modifica_la_instantanea(session_factory, servicio):
    with session_factory() as s:
        snap, _ = _congelar(s, servicio)
        servicio.quotes["AAPL"]["price"] = 50.0
        r = sn.reproducir(s.get(DecisionSnapshot, snap.id))
    assert r["secciones"]["mercado"]["precio"]["valor"] == 104.0
    assert r["precio"]["valor"] == 104.0


def test_cambiar_la_tesis_actual_no_modifica_la_instantanea(session_factory, servicio):
    with session_factory() as s:
        inst = Instrument(symbol="AAPL", name="Apple")
        s.add(inst)
        s.commit()
        tesis = Thesis(instrument_id=inst.id, title="Servicios", body_md="Crece en servicios.",
                       created_at=AHORA - timedelta(days=30), updated_at=AHORA - timedelta(days=30))
        s.add(tesis)
        s.commit()
        s.add(ThesisTrigger(thesis_id=tesis.id, kind="metrica", descripcion="margen",
                            config={"metrica": "operating_margin", "op": "lt", "umbral": 0.18}))
        s.commit()
        snap, _ = _congelar(s, servicio)
        congelada = sn.reproducir(snap)["secciones"]["tesis"]
        # Se reescribe la tesis y se le añade un punto.
        tesis.title, tesis.body_md = "Otra cosa", "Ya no creo en servicios."
        tesis.updated_at = AHORA + timedelta(days=2)
        s.add(ThesisTrigger(thesis_id=tesis.id, kind="noticia", descripcion="x",
                            config={"palabras": ["recall"]}))
        s.commit()
        despues = sn.reproducir(s.get(DecisionSnapshot, snap.id))["secciones"]["tesis"]
    assert despues == congelada
    assert congelada["titulo"] == "Servicios" and congelada["estado"] == "intacta"
    assert len(congelada["disparadores"]) == 1


def test_no_entra_una_noticia_publicada_despues_del_analisis(session_factory, servicio):
    servicio.noticias["AAPL"] = [
        {"headline": "Antes", "published_at": (AHORA - timedelta(hours=3)).isoformat(), "url": "u1"},
        {"headline": "Después", "published_at": (AHORA + timedelta(hours=3)).isoformat(), "url": "u2"},
        {"headline": "Sin fecha", "published_at": None, "url": "u3"},
    ]
    with session_factory() as s:
        snap, r = _congelar(s, servicio)
    noticias = r["analisis"]["noticias"]
    assert [n["headline"] for n in noticias["items"]] == ["Antes"]
    assert noticias["excluidas_futuras"] == 1 and noticias["excluidas_sin_fecha"] == 1


def test_un_analisis_a_una_fecha_pasada_no_usa_filings_posteriores(session_factory, servicio):
    """El ejercicio 2025 se presentó el 10-02-2026: el 1-02-2026 no existía."""
    cuando = datetime(2026, 2, 1, 12, 0, tzinfo=timezone.utc)
    servicio.quotes["AAPL"]["as_of"] = AHORA.isoformat()  # cotización de HOY: futura para entonces
    with session_factory() as s:
        a = analisis_empresa.analizar("AAPL", servicio, s, ahora=cuando, con_pares=False)
    fund = a["fundamentales"]
    assert fund["ejercicio"] == "2024" and fund["excluidos_por_fecha"] == 1
    # Ni la cotización de hoy: se usa el último cierre ANTERIOR, marcado viejo.
    assert a["mercado"]["precio"]["estado"] == "viejo"
    assert a["mercado"]["historico"]["hasta"] <= "2026-02-01"
    # Y la señal de una lista calculada después tampoco existía.
    assert a["senal"]["score"] is None and a["decision"]["action"] == "sin_datos"


def test_el_replay_retira_lo_fechado_despues_de_la_decision(session_factory, servicio):
    """Si algo llegó fechado en el futuro (un reloj adelantado, un proveedor
    roto), la instantánea lo guarda como lo vio, pero el replay no lo enseña
    como conocido."""
    with session_factory() as s:
        a = analisis_empresa.analizar("AAPL", servicio, s, ahora=AHORA, con_pares=False)
        futura = {"headline": "Del futuro", "published_at": (AHORA + timedelta(days=1)).isoformat()}
        a["noticias"]["items"].append(futura)
        a["fundamentales"]["metricas"]["revenue"]["publicado"] = "2026-12-31"
        a["marcas"] = analisis_empresa.marcas_de_tiempo(a)
        snap, nueva = sn.congelar_analisis(s, a, AHORA)
        assert nueva
        assert snap.contexto["analisis"]["anomalias_temporales"]["futuras"]
        r = sn.reproducir(snap)
    retirado = r["proteccion_anticipacion"]["retiradas_por_fecha_futura"]
    assert "revenue" in retirado and any("Del futuro" in x for x in retirado)
    assert r["secciones"]["fundamentales"]["metricas"]["revenue"]["valor"] is None
    assert all(n["headline"] != "Del futuro" for n in r["secciones"]["noticias"]["items"])
    assert r["completo"] is False


def test_una_instantanea_incompleta_se_ensena_incompleta_sin_inventar(session_factory):
    servicio = ServicioFalso(AHORA).empresa("ZZZ", precio=50.0, score=None, periodos=None)
    with session_factory() as s:
        r = analizar_y_congelar("ZZZ", servicio, s, ahora=AHORA, con_pares=False)
        rep = sn.reproducir(s.get(DecisionSnapshot, r["instantanea"]["id"]))
    assert rep["completo"] is False
    assert {"fundamentales", "senal"} <= set(rep["incompletas"])
    assert rep["secciones"]["fundamentales"]["metricas"] == {}
    assert rep["secciones"]["senal"]["score"] is None
    assert rep["secciones"]["decision"]["action"] == "sin_datos"
    datos_que_faltan = {f["dato"] for f in rep["faltaban"]}
    assert {"estados financieros", "puntuación"} <= datos_que_faltan


def test_una_instantanea_de_la_lista_diaria_dice_lo_que_no_se_congelo(session_factory):
    from tests.test_snapshots import _payload, _senal

    with session_factory() as s:
        sn.congelar_lista_diaria(s, _payload(ideas=[_senal()]), "hoy:sp500", AHORA)
        r = sn.reproducir(s.query(DecisionSnapshot).one())
    assert r["completo"] is False and r["esquema"] == 1
    assert "fundamentales" in r["no_congelado"] and "tesis" in r["no_congelado"]
    assert "no se rellenan con los de hoy" in r["nota"]


def test_la_misma_empresa_diez_veces_no_son_diez_decisiones(session_factory, servicio):
    with session_factory() as s:
        ids = {_congelar(s, servicio, AHORA + timedelta(minutes=i))[0].id for i in range(10)}
        assert len(ids) == 1
        # Solo cambia el precio: sigue sin ser una decisión nueva.
        servicio.quotes["AAPL"]["price"] = 105.0
        assert _congelar(s, servicio, AHORA + timedelta(minutes=20))[0].id in ids
        # Cambia la decisión: sí.
        servicio.senal("AAPL", -0.8)
        snap, r = _congelar(s, servicio, AHORA + timedelta(minutes=30))
        assert snap.id not in ids and r["instantanea"]["nueva"] and snap.accion == "evitar"
        # Y al día siguiente, aunque nada cambie, hay instantánea del día.
        otro, r2 = _congelar(s, servicio, AHORA + timedelta(days=1))
        assert r2["instantanea"]["nueva"] and otro.id != snap.id
        assert r2["anterior"]["id"] == snap.id


def test_un_analisis_a_una_fecha_pasada_no_ve_tesis_ni_posiciones_posteriores(session_factory, servicio):
    with session_factory() as s:
        inst = Instrument(symbol="AAPL")
        s.add(inst)
        s.commit()
        s.add(Thesis(instrument_id=inst.id, title="t", body_md="b",
                     created_at=AHORA + timedelta(days=1), updated_at=AHORA + timedelta(days=1)))
        s.add(Position(instrument_id=inst.id, quantity=5, cost_basis=90.0,
                       opened_at=AHORA + timedelta(days=1)))
        s.commit()
        a = analisis_empresa.analizar("AAPL", servicio, s, ahora=AHORA, con_pares=False)
        assert a["tesis"]["estado"] == "sin_tesis" and a["posicion"] is None
        # Editada después de existir: su texto de entonces no se conoce.
        t = Thesis(instrument_id=inst.id, title="vieja", body_md="b",
                   created_at=AHORA - timedelta(days=5), updated_at=AHORA + timedelta(hours=1))
        s.add(t)
        s.commit()
        a = analisis_empresa.analizar("AAPL", servicio, s, ahora=AHORA, con_pares=False)
    assert a["tesis"]["estado"] == "desconocido" and "no se conserva" in a["tesis"]["motivo"]


def test_el_forward_testing_no_mide_lecturas_como_apuestas(session_factory, servicio, monkeypatch):
    """Un análisis que dice «mantener» se congela para poder reconstruirlo, pero
    no es una afirmación que medir."""
    import importlib.util
    from pathlib import Path

    ruta = Path(__file__).resolve().parent.parent / "scripts" / "evaluar_instantaneas.py"
    spec = importlib.util.spec_from_file_location("evaluar_instantaneas_r", ruta)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    servicio.senal("AAPL", 0.1)  # «ninguna»
    with session_factory() as s:
        snap, _ = _congelar(s, servicio)
        assert snap.accion == "ninguna"
    monkeypatch.setattr(mod, "init_db", lambda: None)
    monkeypatch.setattr(mod, "SessionLocal", session_factory)
    monkeypatch.setattr(mod, "get_service", lambda: servicio)
    assert mod.evaluar(ahora=AHORA + timedelta(days=5))["evaluadas"] == 0


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
        r = c.get("/api/empresa/aapl/analisis?pares=false").json()
        assert r["instantanea"]["nueva"] and r["analisis"]["decision"]["action"] == "comprar"
        h = c.get("/api/empresa/AAPL/historial").json()
        assert h["decisiones"][0]["replay"] is True
        rep = c.get(f"/api/snapshots/{r['instantanea']['id']}/replay").json()
        assert rep["esquema"] == 2 and rep["integridad"]["huella_coincide"]
        assert rep["proteccion_anticipacion"]["regla"] == "cada dato estaba disponible antes del momento de la decisión"
        assert c.get("/api/snapshots/999/replay").status_code == 404
        assert c.get("/api/empresa/A$B/analisis").status_code == 422
        lista = c.get("/api/snapshots?origen=analisis").json()
        assert lista["instantaneas"][0]["origen"].startswith("analisis:")
    finally:
        app.dependency_overrides.clear()


def test_las_fechas_se_sirven_siempre_con_zona(session_factory, servicio):
    """SQLite pierde la zona: sin marcarla, el navegador lee el instante como
    hora LOCAL y una decisión de las 14:35 UTC aparece a otra hora."""
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
        r = c.get("/api/empresa/AAPL/analisis?pares=false").json()
        c.get("/api/empresa/AAPL/analisis?pares=false")
        h = c.get("/api/empresa/AAPL/historial").json()["decisiones"][0]
        rep = c.get(f"/api/snapshots/{r['instantanea']['id']}/replay").json()
        det = c.get(f"/api/snapshots/{r['instantanea']['id']}").json()
        lista = c.get("/api/snapshots").json()["instantaneas"][0]
    finally:
        app.dependency_overrides.clear()
    for valor in (h["creado_en"], rep["creado_en"], rep["momento"], det["creado_en"], lista["creado_en"]):
        assert valor.endswith("+00:00"), valor


def test_no_tener_posicion_es_un_dato_congelado_no_una_seccion_ausente(session_factory, servicio):
    with session_factory() as s:
        snap, r = _congelar(s, servicio)
        rep = sn.reproducir(snap)
    assert r["analisis"]["posicion"] is None
    assert "posicion" not in rep["no_congelado"]
    assert rep["completo"] is True, (rep["no_congelado"], rep["incompletas"])


def test_una_deuda_parcial_no_se_lee_como_completa(session_factory):
    """Sin deuda a corto en el filing cuenta como cero, pero en dirección
    imprudente: la métrica, la lista de lo que falta y el DCF inverso lo dicen."""
    periodos = financieros_base()
    for p in periodos:
        p["short_term_debt"] = None
    servicio = ServicioFalso(AHORA).empresa("AAPL", precio=104.0, score=0.6, periodos=periodos)
    with session_factory() as s:
        a = analisis_empresa.analizar("AAPL", servicio, s, ahora=AHORA, con_pares=False)
    neta = a["fundamentales"]["metricas"]["deuda_neta"]
    assert neta["valor"] == pytest.approx(300.0 - 120.0)
    assert neta["parcial"] == ["short_term_debt"] and "sobreestimado" in neta["nota"]
    assert any(f["dato"] == "deuda neta (parcial)" for f in a["faltan"])
    assert a["valoracion"]["dcf_inverso"]["deuda_parcial"] == ["short_term_debt"]
    assert "PARCIAL" in a["valoracion"]["dcf_inverso"]["nota"]


def test_un_analisis_pasado_con_hora_no_ve_el_cierre_de_esa_tarde(session_factory, servicio):
    """Encontrado por `scripts/validar_con_datos_reales.py`. Las barras se
    filtraban por DÍA: un análisis a las 14:35 de un día pasado metía el cierre
    de esa misma tarde. Con la regla común, la barra del mismo día solo entra si
    se descargó antes de la decisión."""
    momento = datetime(2026, 5, 15, 14, 35, tzinfo=timezone.utc)
    servicio.historias["AAPL"] = [
        {"ts": "2026-05-14", "close": 100.0},
        {"ts": "2026-05-15", "close": 150.0},  # el cierre de esa tarde
    ]
    with session_factory() as s:
        a = analisis_empresa.analizar("AAPL", servicio, s, ahora=momento, con_pares=False)
    assert a["mercado"]["historico"]["hasta"] == "2026-05-14"
    assert a["mercado"]["precio"]["valor"] == 100.0


def test_en_vivo_la_barra_de_hoy_descargada_antes_si_entra(session_factory, servicio):
    servicio.historias["AAPL"][-1]["ts"] = AHORA.date().isoformat()
    servicio.quotes.pop("AAPL")  # sin cotización: el precio sale del histórico
    with session_factory() as s:
        a = analisis_empresa.analizar("AAPL", servicio, s, ahora=AHORA + timedelta(minutes=5), con_pares=False)
    # El histórico se obtuvo a las 14:35 (`as_of`) y se analiza a las 14:40.
    assert a["mercado"]["historico"]["hasta"] == AHORA.date().isoformat()
