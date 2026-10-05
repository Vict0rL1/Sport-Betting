"""La traza de reglas y «qué cambiaría la decisión», salidas del mismo motor.

La explicación de una decisión no se le pregunta a nadie: se lee de las reglas
que la tomaron. Y «qué tendría que pasar para que fuera otra» se lee de los
mismos umbrales. Si estos tests fallan, la explicación y la decisión se han
separado — que es exactamente lo que no puede pasar.
"""

from __future__ import annotations

from app.analysis import decision

FAV, DESF = 0.35, -0.35


def _d(score, last, sma=100.0, position=None, **kw):
    return decision.decide(
        {"score": score}, {"last": last, "sma200": sma}, position,
        favorable_min=FAV, desfavorable_max=DESF, **kw,
    )


def _por_id(r):
    return {x["id"]: x for x in r["reglas"]}


def test_comprar_lo_deciden_dos_reglas_y_se_ven_sus_valores():
    r = _d(0.6, 105.0)
    assert r["action"] == "comprar"
    reglas = _por_id(r)
    assert reglas["puntuacion_favorable"]["resultado"] == "cumple"
    assert reglas["puntuacion_favorable"]["papel"] == "decide"
    assert reglas["puntuacion_favorable"]["datos"] == {"valor": 0.6, "umbral": FAV}
    assert reglas["tendencia_a_favor"]["datos"]["umbral"] == 102.0  # media + 2 %


def test_vigilar_dice_que_regla_bloquea_la_compra():
    r = _d(0.6, 99.0)
    assert r["action"] == "vigilar"
    assert _por_id(r)["tendencia_a_favor"]["papel"] == "bloquea"
    comprar = next(c for c in r["cambiaria"] if c["hacia"] == "comprar")
    # Solo falta la tendencia: la puntuación ya cumple y no se pide otra vez.
    assert [c["regla"] for c in comprar["condiciones"]] == ["tendencia_a_favor"]
    assert comprar["condiciones"][0]["umbral"] == 102.0
    assert comprar["condiciones"][0]["distancia"] == round((102.0 / 99.0 - 1) * 100, 2)


def test_ninguna_dice_cuanto_falta_para_comprar_y_para_evitar():
    r = _d(0.10, 105.0)
    assert r["action"] == "ninguna"
    comprar = next(c for c in r["cambiaria"] if c["hacia"] == "comprar")
    assert comprar["condiciones"][0]["regla"] == "puntuacion_favorable"
    assert comprar["condiciones"][0]["distancia"] == 0.25
    evitar = next(c for c in r["cambiaria"] if c["hacia"] == "evitar")
    assert evitar["condiciones"][0]["distancia"] == -0.45


def test_los_resultados_proximos_modifican_y_se_ve():
    r = _d(0.6, 105.0, resultados_en="2026-10-01")
    assert r["action"] == "vigilar"
    reglas = _por_id(r)
    assert reglas["resultados_proximos"]["papel"] == "modifica"
    comprar = next(c for c in r["cambiaria"] if c["hacia"] == "comprar")
    assert any(c["regla"] == "resultados_proximos" for c in comprar["condiciones"])


def test_con_posicion_decide_la_primera_regla_que_se_cumple():
    pos = {"cost_basis": 100.0, "quantity": 1, "stop": 90.0}
    r = _d(0.1, 95.0, sma=100.0, position=pos)  # 95 ≤ 99: tendencia perdida
    assert r["action"] == "reducir"
    reglas = _por_id(r)
    assert reglas["tendencia_perdida"]["papel"] == "decide"
    assert reglas["stop_perforado"]["resultado"] == "no_cumple"
    hacia = {c["hacia"]: c for c in r["cambiaria"]}
    assert set(hacia) == {"mantener", "vender"}
    vender = hacia["vender"]["condiciones"]
    assert {c["regla"] for c in vender} == {"puntuacion_desfavorable", "stop_perforado"}
    stop = next(c for c in vender if c["regla"] == "stop_perforado")
    assert stop["umbral"] == 90.0 and stop["distancia"] == round((90 / 95 - 1) * 100, 2)


def test_sin_media_la_tendencia_es_desconocida_no_incumplida():
    """Una regla que no se puede evaluar no es una regla que no se cumple."""
    r = decision.decide({"score": 0.6}, {"last": 105.0}, None)
    assert _por_id(r)["tendencia_a_favor"]["resultado"] == "desconocido"
    comprar = next(c for c in r["cambiaria"] if c["hacia"] == "comprar")
    tendencia = next(c for c in comprar["condiciones"] if c["regla"] == "tendencia_a_favor")
    assert tendencia["umbral"] is None and "desconocido" in tendencia["nota"]


def test_dentro_de_la_banda_no_cumple_pero_se_sabe():
    r = _d(0.6, 101.0)  # entre 99 y 102: ni encima ni debajo
    assert _por_id(r)["tendencia_a_favor"]["resultado"] == "no_cumple"


def test_sin_datos_tiene_su_traza_y_dice_que_falta():
    r = decision.decide({"score": None}, {"last": 100.0}, None)
    assert r["action"] == "sin_datos"
    assert r["reglas"][0]["id"] == "datos_minimos" and r["reglas"][0]["papel"] == "decide"
    assert "puntuación" in r["cambiaria"][0]["condiciones"][0]["condicion"]


def test_la_accion_sale_siempre_de_la_regla_decisiva():
    """Propiedad sobre una rejilla: la acción es el efecto de la regla que
    decide (o de la que modifica). Si se separan, la explicación miente."""
    for score in (-1.0, -0.35, 0.0, 0.34, 0.35, 0.9):
        for last in (80.0, 98.9, 99.0, 101.0, 102.0, 110.0):
            for pos in (None, {"cost_basis": 100.0, "quantity": 1, "stop": 85.0}):
                for res in (None, "2026-10-01"):
                    r = _d(score, last, position=pos, resultados_en=res)
                    modifica = [x for x in r["reglas"] if x["papel"] == "modifica"]
                    decide = [x for x in r["reglas"] if x["papel"] == "decide"]
                    if modifica:
                        assert r["action"] == modifica[-1]["efecto"]
                    elif decide:
                        assert all(x["efecto"] == r["action"] for x in decide)
                    else:
                        # Las acciones «por defecto»: ninguna regla las dispara.
                        assert r["action"] in ("mantener", "ninguna", "vigilar")
