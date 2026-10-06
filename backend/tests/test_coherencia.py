"""Las comprobaciones de coherencia con datos reales, probadas con datos fabricados.

El script se corre con claves reales; aquí se fija que cada comprobación
distinga lo coherente de lo incoherente, y que «no se pudo comprobar» salga
UNKNOWN y nunca PASS.
"""

from __future__ import annotations

import importlib.util
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from app import coherencia as co
from tests.fakes_empresa import ServicioFalso, financieros_base, periodo, trimestre

HOY = date(2026, 9, 12)


def _financieros(anual_ingresos=1100.0, q4=None):
    """FY2025: cuatro trimestres que suman 1 100 de ingresos, 165 de beneficio y 250 de CFO."""
    ingresos = [260.0, 270.0, 280.0, q4 if q4 is not None else 290.0]
    qs = [
        trimestre(2025, i + 1, fecha, revenue=ingresos[i], net_income=[40.0, 40.0, 42.0, 43.0][i],
                  cfo=[60.0, 62.0, 63.0, 65.0][i])
        for i, fecha in enumerate(["2025-04-30", "2025-07-30", "2025-10-30", "2026-02-10"])
    ]
    qs[3]["fuentes"]["revenue"]["derivado"] = "año (10-K) − nueve meses"
    anual = periodo(2025, "2026-02-10", revenue=anual_ingresos, net_income=165.0, cfo=250.0)
    return {"periods": [anual], "quarters": qs}


def _estado(filas, nombre):
    return next(f for f in filas if f["comprobacion"] == nombre)["estado"]


# --- Trimestres frente al año ----------------------------------------------------------


def test_cuatro_trimestres_que_suman_el_ano_pasan():
    filas = co.trimestres_frente_al_ano("X", _financieros())
    assert {f["estado"] for f in filas} == {co.PASS}
    assert any("Q4 derivado" in f["detalle"] for f in filas)


def test_un_ano_reexpresado_no_cuadra_y_se_dice():
    filas = co.trimestres_frente_al_ano("X", _financieros(anual_ingresos=1160.0))  # +5,5 %
    f = next(f for f in filas if f["comprobacion"].endswith(":revenue"))
    assert f["estado"] == co.FAIL and "reexpresión" in f["detalle"]
    assert _estado(filas, "trimestres_suman_el_ano:cfo") == co.PASS


def test_un_cuarto_trimestre_negativo_es_un_trimestre_mal_asignado():
    filas = co.trimestres_frente_al_ano("X", _financieros(q4=-50.0))
    assert _estado(filas, "trimestres_suman_el_ano:revenue") == co.FAIL


def test_sin_los_cuatro_trimestres_no_se_sabe():
    fin = _financieros()
    fin["quarters"] = fin["quarters"][:3]
    assert co.trimestres_frente_al_ano("X", fin)[0]["estado"] == co.UNKNOWN


# --- Fechas de publicación -------------------------------------------------------------


def test_fechas_coherentes_pasan():
    assert co.fechas_de_publicacion("X", _financieros(), HOY)[0]["estado"] == co.PASS


@pytest.mark.parametrize("publicado,texto", [
    ("2025-03-15", "ANTES de cerrar"),     # Q1 cierra el 31-03
    ("2026-12-01", "en el futuro"),
    ("2025-12-15", "primera publicación"),  # 259 días tras el cierre
])
def test_fechas_incoherentes_fallan(publicado, texto):
    fin = _financieros()
    fin["quarters"][0]["filed_at"] = publicado
    f = co.fechas_de_publicacion("X", fin, HOY)[0]
    assert f["estado"] == co.FAIL and texto in f["detalle"]


def test_sin_fechas_no_se_sabe():
    assert co.fechas_de_publicacion("X", {"periods": [{"fiscal_year": "2025"}]}, HOY)[0]["estado"] == co.UNKNOWN


# --- Escala del consenso ---------------------------------------------------------------


def test_la_escala_del_consenso_usa_la_regla_del_registro():
    qs = _financieros()["quarters"]
    ok = co.escala_del_consenso("X", {"eps_estimate": None, "revenue_estimate": 300.0}, qs)
    assert _estado(ok, "escala_del_consenso:revenue") == co.PASS
    assert _estado(ok, "escala_del_consenso:eps_diluted") == co.UNKNOWN  # sin estimación
    mal = co.escala_del_consenso("X", {"revenue_estimate": 300_000.0}, qs)
    assert _estado(mal, "escala_del_consenso:revenue") == co.FAIL
    assert co.escala_del_consenso("X", None, qs)[0]["estado"] == co.UNKNOWN


# --- Tipos de cambio -------------------------------------------------------------------


def test_tipos_de_cambio():
    bueno = {"por_usd": 1.37, "fecha": "2026-09-10", "fresco": True, "serie": "DEXCAUS"}
    assert co.tipo_de_cambio("CAD", bueno)[0]["estado"] == co.PASS
    invertido = {**bueno, "por_usd": 0.73}
    assert "invertida" in co.tipo_de_cambio("CAD", invertido)[0]["detalle"]
    assert co.tipo_de_cambio("CAD", {**bueno, "fresco": False})[0]["estado"] == co.FAIL
    assert co.tipo_de_cambio("CAD", {"por_usd": None, "error": "FRED caído"})[0]["estado"] == co.FAIL
    assert co.tipo_de_cambio("CAD", None)[0]["estado"] == co.UNKNOWN


# --- Cotización frente al último cierre ------------------------------------------------


def test_cotizacion_frente_a_cierre():
    barras = [{"ts": "2026-09-10", "close": 100.0}, {"ts": "2026-09-11", "close": 101.0}]
    assert co.cotizacion_frente_a_cierre("X", {"price": 102.0}, barras, HOY)[0]["estado"] == co.PASS
    # Un 50 % de diferencia: otra acción, otra moneda o un split.
    assert co.cotizacion_frente_a_cierre("X", {"price": 50.0}, barras, HOY)[0]["estado"] == co.FAIL
    viejas = [{"ts": "2026-08-01", "close": 101.0}]
    assert "días" in co.cotizacion_frente_a_cierre("X", {"price": 101.0}, viejas, HOY)[0]["detalle"]
    assert co.cotizacion_frente_a_cierre("X", None, barras, HOY)[0]["estado"] == co.UNKNOWN


# --- El script entero, con el servicio falso ---------------------------------------------


def _script():
    ruta = Path(__file__).resolve().parent.parent / "scripts" / "validar_con_datos_reales.py"
    spec = importlib.util.spec_from_file_location("validar_con_datos_reales_t", ruta)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


AHORA = datetime(2026, 9, 12, 14, 35, tzinfo=timezone.utc)


def test_el_script_con_datos_coherentes_no_falla_y_reproduce():
    servicio = ServicioFalso(AHORA).empresa("AAPL", precio=104.0, score=0.6, periodos=financieros_base(),
                                            trimestres=_financieros()["quarters"])
    servicio.calendario = [{"symbol": "AAPL", "date": "2026-10-30", "eps_estimate": 0.45,
                            "revenue_estimate": 300.0}]
    filas = _script().validar(servicio, ["AAPL"], ["CAD"], ahora=AHORA, con_fred=False)
    estados = {f["comprobacion"]: f["estado"] for f in filas}
    assert estados["replay:huella"] == estados["replay:decision"] == co.PASS
    assert estados["replay:sin_datos_futuros"] == co.PASS
    assert estados["pasado:sin_anticipacion"] == co.PASS
    assert estados["cotizacion_frente_a_cierre"] == co.PASS
    assert estados["escala_del_consenso:revenue"] == co.PASS
    assert estados["tipo_de_cambio:CAD"] == co.UNKNOWN  # sin FRED: no se pidió, y se dice
    assert co.FAIL not in estados.values()


def test_una_cotizacion_del_futuro_no_llega_a_la_instantanea():
    """Un proveedor con el reloj adelantado: la cotización llega fechada mañana.
    El análisis la descarta antes de congelar, así que el replay no tiene nada
    que retirar y el precio usado es el último cierre, marcado viejo."""
    servicio = ServicioFalso(AHORA).empresa("AAPL", precio=104.0, score=0.6, periodos=financieros_base())
    servicio.quotes["AAPL"]["as_of"] = (AHORA + timedelta(days=1)).isoformat()
    filas = _script().validar(servicio, ["AAPL"], [], ahora=AHORA, con_fred=False)
    assert _estado(filas, "replay:sin_datos_futuros") == co.PASS
    assert _estado(filas, "replay:decision") == co.PASS


def test_la_ida_y_vuelta_falla_si_algo_llego_del_futuro_o_la_huella_no_cuadra():
    analisis = {"decision": {"action": "comprar"}}
    replay = {"integridad": {"huella_coincide": False},
              "secciones": {"decision": {"action": "mantener"}},
              "proteccion_anticipacion": {"retiradas_por_fecha_futura": ["noticia: X"], "marcas_comprobadas": 3}}
    filas = co.ida_y_vuelta("X", analisis, replay)
    assert {f["comprobacion"]: f["estado"] for f in filas} == {
        "replay:huella": co.FAIL, "replay:decision": co.FAIL, "replay:sin_datos_futuros": co.FAIL}


def test_el_analisis_pasado_detecta_un_dato_posterior():
    momento = datetime(2026, 5, 15, 14, 35, tzinfo=timezone.utc)
    marcas = [{"dato": "precio", "publicado": "2026-05-14", "obtenido_en": None},
              {"dato": "trimestre", "publicado": "2026-07-30", "obtenido_en": None}]
    f = co.sin_anticipacion_en_el_pasado("X", {"marcas": marcas}, momento)[0]
    assert f["estado"] == co.FAIL and "trimestre" in f["detalle"]
    assert co.sin_anticipacion_en_el_pasado("X", {}, momento)[0]["estado"] == co.UNKNOWN


def test_solo_cache_no_descarga_nada_y_lo_que_falta_es_unknown():
    servicio = ServicioFalso(AHORA).empresa("AAPL", periodos=financieros_base())
    filas = _script().validar(servicio, ["AAPL"], [], ahora=AHORA, solo_cache=True)
    assert servicio.llamadas == []
    assert all(f["estado"] == co.UNKNOWN for f in filas)


def test_una_ida_y_vuelta_sin_marcas_no_es_un_pass():
    replay = {"integridad": {"huella_coincide": True}, "secciones": {"decision": {"action": "sin_datos"}},
              "proteccion_anticipacion": {"retiradas_por_fecha_futura": [], "marcas_comprobadas": 0}}
    filas = co.ida_y_vuelta("X", {"decision": {"action": "sin_datos"}}, replay)
    assert _estado(filas, "replay:sin_datos_futuros") == co.UNKNOWN
