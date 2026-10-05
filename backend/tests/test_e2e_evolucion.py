"""El flujo entero, de punta a punta, con la base migrada y sin red:

    empresa analizada → instantánea → earnings → expectativas vs realidad
    → la señal cambia → What Changed lo detecta → el riesgo de cartera cambia
    → el coste de oportunidad evalúa → la nueva instantánea queda guardada

Cada paso usa las piezas reales (análisis, congelación, diff, expectativas,
contribución al riesgo, coste de oportunidad). Lo único falso es el servicio de
datos, que es determinista y mutable.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import expectativas as seguimiento
from app import snapshots as sn
from app.db.migraciones import migrar
from app.db.models import CashBalance, DecisionSnapshot, Instrument, Position, Thesis, ThesisTrigger
from app.routers.empresa import analizar_y_congelar
from tests.fakes_empresa import ServicioFalso, barras, periodo, trimestre

T0 = datetime(2026, 10, 1, 14, 0, tzinfo=timezone.utc)      # análisis A, antes de resultados
T1 = datetime(2026, 11, 3, 14, 0, tzinfo=timezone.utc)      # tras resultados del 30-10


def _trimestres():
    qs = []
    for ano in (2025, 2026):
        for q in (1, 2, 3, 4):
            if ano == 2026 and q > 2:
                break
            ingresos = 1000.0 * (1.1 if ano == 2026 else 1.0) + q * 10
            qs.append(trimestre(ano, q, f"{ano}-{q * 3 + 1:02d}-28" if q < 4 else f"{ano + 1}-02-10",
                                revenue=ingresos, operating_income=ingresos * 0.21, gross_profit=ingresos * 0.45,
                                net_income=ingresos * 0.15, eps_diluted=ingresos / 1000, cfo=ingresos * 0.2,
                                capex=ingresos * 0.04))
    return qs


def _anuales():
    return [
        periodo(a, f"{a + 1}-02-10", revenue=4000.0 * 1.1 ** i, gross_profit=1800.0 * 1.1 ** i,
                operating_income=840.0 * 1.1 ** i, net_income=600.0 * 1.1 ** i, cfo=760.0 * 1.1 ** i,
                capex=150.0 * 1.1 ** i, eps_diluted=6.0 * 1.1 ** i, shares_outstanding=100.0,
                cash=500.0, long_term_debt=1000.0, short_term_debt=0.0, total_assets=8000.0 * 1.1 ** i,
                accounts_receivable=400.0 * 1.1 ** i, inventory=300.0 * 1.1 ** i, sbc=80.0 * 1.1 ** i)
        for i, a in enumerate((2023, 2024, 2025))
    ]


@pytest.fixture
def entorno(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'e2e.db'}")
    migrar(engine)  # la base REAL migrada: triggers de inmutabilidad incluidos
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    servicio = ServicioFalso(T0)
    servicio.empresa("ACME", precio=104.0, score=0.6, periodos=_anuales(), trimestres=_trimestres())
    servicio.calendario = [{"symbol": "ACME", "date": "2026-10-30", "eps_estimate": 1.14,
                            "revenue_estimate": 1135.0, "eps_actual": None, "revenue_actual": None}]
    # Cartera: una posición que se mueve con el mercado, otra independiente.
    servicio.empresa("HOLD", precio=50.0, score=None)
    servicio.historias["HOLD"] = [{"ts": b["ts"], "close": 50.0 * (1 + 0.004 * (((i * 7919) % 11) - 5) / 5)}
                                  for i, b in enumerate(barras(T0.date() - timedelta(days=1)))]
    for sym in ("ACME", "HOLD"):
        servicio.cache.set("price_history_long", {"symbol": sym}, {"bars": servicio.historias[sym]})
    with factory() as s:
        hold = Instrument(symbol="HOLD", currency="USD")
        acme = Instrument(symbol="ACME", name="Acme", currency="USD")
        s.add_all([hold, acme])
        s.commit()
        s.add(Position(instrument_id=hold.id, quantity=200, cost_basis=40.0, opened_at=T0 - timedelta(days=300)))
        t = Thesis(instrument_id=acme.id, title="Margen", body_md="El margen operativo aguanta por encima del 18 %.",
                   created_at=T0 - timedelta(days=40), updated_at=T0 - timedelta(days=40))
        s.add(t)
        s.commit()
        s.add(ThesisTrigger(thesis_id=t.id, kind="metrica", descripcion="margen operativo < 18 %",
                            config={"metrica": "operating_margin", "op": "lt", "umbral": 0.18}))
        s.add(CashBalance(moneda="USD", importe=300.0, as_of=T0 - timedelta(days=1)))
        s.commit()
    return factory, servicio


def test_el_flujo_completo(entorno):
    factory, servicio = entorno
    with factory() as s:
        # 1) Análisis A y su instantánea.
        a = analizar_y_congelar("ACME", servicio, s, ahora=T0, con_pares=False)
        snap_a = s.get(DecisionSnapshot, a["instantanea"]["id"])
        assert snap_a.accion == "comprar" and a["cambios"]["primer_analisis"]
        assert a["analisis"]["tesis"]["estado"] == "intacta"
        assert a["analisis"]["riesgo"]["en_cartera"] is False  # lo que aportaría si se añade
        oc_a = a["analisis"]["coste_oportunidad"]
        assert oc_a["veredicto"]["accion"] in ("REVISAR_PARA_FINANCIAR", "NO_TRADE")
        assert oc_a["tamano"]["efectivo_disponible"] is not None

        # 2) Antes de los resultados: se capturan las expectativas, cada fuente aparte.
        evento = seguimiento.crear_evento(s, "ACME", "earnings", periodo="2026-Q3",
                                          fecha_prevista="2026-10-30", ahora=T0)
        captura = seguimiento.capturar(s, servicio, evento, T0)
        fuentes = {x["fuente_tipo"] for x in captura["registradas"]}
        assert {"consenso", "modelo_interno", "reglas"} <= fuentes

        # 3) Salen los resultados: ingresos por encima, margen operativo hundido al 15 %.
        servicio.ahora = T1
        servicio.financials["ACME"]["quarters"].append(
            trimestre(2026, 3, "2026-10-30", revenue=1160.0, operating_income=1160.0 * 0.15,
                      gross_profit=1160.0 * 0.40, net_income=1160.0 * 0.10, eps_diluted=1.16,
                      cfo=1160.0 * 0.12, capex=1160.0 * 0.04))
        servicio.quotes["ACME"].update(price=95.0, as_of=T1.isoformat())
        servicio.quotes["HOLD"].update(as_of=T1.isoformat())
        servicio.senal("ACME", 0.2, as_of=T1)  # la puntuación cae tras los resultados
        seguimiento.registrar_reales(s, servicio, evento, T1)
        lectura = seguimiento.evaluar(s, evento)
        assert lectura["clasificacion"] == "mixto"  # batió en ingresos, no en margen
        tesis = {i["punto"]: i["estado"] for i in lectura["impacto_en_tesis"]}
        assert tesis["margen operativo < 18 %"] == "invalidado"

        # 4) Análisis B: la señal cambia y What Changed lo explica con las reglas.
        b = analizar_y_congelar("ACME", servicio, s, ahora=T1, con_pares=False)
        snap_b = s.get(DecisionSnapshot, b["instantanea"]["id"])
        assert b["instantanea"]["nueva"] and snap_b.id != snap_a.id
        d = b["cambios"]["decision"]
        assert d["antes"] == "comprar" and d["ahora"] != "comprar" and d["cambio"]
        assert {c["regla"] for c in d["reglas_que_cambiaron"]} & {"puntuacion_favorable", "tendencia_a_favor"}
        categorias = b["cambios"]["categorias"]
        assert any(c["clave"] == "trimestre" for c in categorias["fundamentales"])
        assert any(c["clave"] == "trimestre_operating_margin" for c in categorias["fundamentales"])
        assert any(c["clave"] == "resultado_evento" for c in categorias["resultados"])
        assert b["cambios"]["tesis"]["estado"]["antes"] == "intacta"
        # La vigilancia anual aún no lo ve; los resultados del trimestre, sí.
        invalidas = b["cambios"]["tesis"]["invalidaciones"]
        assert invalidas and invalidas[0]["origen"] == "resultados" and "2026-Q3" in invalidas[0]["detalle"]

        # 5) El riesgo de cartera y el coste de oportunidad se recalculan.
        assert b["analisis"]["riesgo"]["estado"] == "valido"
        assert b["analisis"]["coste_oportunidad"]["veredicto"]["accion"] == "NO_ACCION"

        # 6) Las dos instantáneas quedan guardadas, intactas y reproducibles.
        rep_a = sn.reproducir(s.get(DecisionSnapshot, snap_a.id))
        rep_b = sn.reproducir(snap_b)
    assert rep_a["integridad"]["huella_coincide"] and rep_b["integridad"]["huella_coincide"]
    assert rep_a["secciones"]["decision"]["action"] == "comprar"
    assert rep_a["secciones"]["fundamentales"]["trimestre"]["periodo"] == "2026-Q2"  # el Q3 no existía aún
    assert rep_a["proteccion_anticipacion"]["retiradas_por_fecha_futura"] == []
    assert rep_b["secciones"]["expectativas"]["ultimo"]["clasificacion"] == "mixto"
