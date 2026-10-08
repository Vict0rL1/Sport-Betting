"""El paquete de casos extremos (ítem 0.4): que estén todos y que cada uno sea
de verdad el caso raro que dice ser.

El golden master, los tests contra fugas de texto y el barrido de capturas se
apoyan en este paquete. Si un caso deja de provocar su rareza —un «precio NaN»
que llega limpio, un «tipo invertido» que nadie rechaza—, esos tres pierden
cobertura sin avisar. Esto avisa.
"""

from __future__ import annotations

import math

import pytest

from app import analisis_empresa
from tests.fixtures import extremos as ex


def test_estan_todos_los_casos_del_plan():
    assert {"completa", "todo_ausente", "deuda_parcial", "precio_nan", "precio_nan_sin_historico",
            "precio_negativo", "solo_cache_viejo", "no_sec"} <= set(ex.EMPRESAS)
    assert {"vacia", "una_posicion", "cad_en_usd", "fx_invertido"} <= set(ex.CARTERAS)
    assert {"dia_completo_502", "dia_sin_candidatas", "sector_pequeno"} <= set(ex.LISTAS)


def _analizar(session_factory, empresa: str, cartera: str = "vacia") -> dict:
    sv, symbol = ex.montar_empresa(empresa)
    with session_factory() as s:
        ex.montar_cartera(cartera, s, sv)
        return analisis_empresa.analizar(symbol, sv, s, ahora=ex.AHORA, con_pares=False)


def test_un_precio_nan_sin_historico_acaba_sin_precio_y_no_cruza_la_frontera(session_factory):
    """La otra mitad de `precio_nan`: sin cierre al que recurrir, el NaN no puede
    llegar a `decide` como número; el análisis se queda sin precio y lo dice."""
    sv, symbol = ex.montar_empresa("precio_nan_sin_historico")
    assert math.isnan(sv.quotes[symbol]["price"]) and symbol not in sv.historias
    a = _analizar(session_factory, "precio_nan_sin_historico")
    precio = a["mercado"]["precio"]
    assert precio.get("valor") is None and precio.get("estado") != "valido", precio
    assert a["decision"]["action"] != "comprar"


@pytest.mark.parametrize("empresa", ["precio_nan", "precio_nan_sin_historico", "precio_negativo", "solo_cache_viejo"])
def test_un_precio_dudoso_nunca_produce_una_compra(session_factory, empresa):
    sv, symbol = ex.montar_empresa(empresa)
    precio = sv.quotes[symbol]["price"]
    assert math.isnan(precio) or precio < 0 or sv.quotes[symbol].get("estado") == "viejo"
    a = _analizar(session_factory, empresa)
    assert a["decision"]["action"] != "comprar"


def test_todo_ausente_es_desconocido_y_no_cero(session_factory):
    a = _analizar(session_factory, "todo_ausente")
    assert a["decision"]["action"] == "sin_datos"
    assert a["mercado"]["precio"]["valor"] is None
    assert all(m.get("valor") is None for m in a["fundamentales"]["metricas"].values())


def test_la_deuda_parcial_se_marca(session_factory):
    a = _analizar(session_factory, "deuda_parcial")
    assert a["fundamentales"]["metricas"]["deuda_neta"]["parcial"] == ["short_term_debt"]


def test_sin_registro_en_la_sec_no_hay_fundamentales(session_factory):
    a = _analizar(session_factory, "no_sec")
    assert a["fundamentales"]["estado"] != "valido"
    assert a["mercado"]["precio"]["moneda"] == "CAD"


@pytest.mark.parametrize("caso,fuera", [("cad_en_usd", False), ("fx_invertido", True)])
def test_un_tipo_de_cambio_invertido_deja_la_posicion_fuera_y_lo_dice(session_factory, caso, fuera):
    from app.contexto_cartera import construir

    sv, _ = ex.montar_empresa("completa")
    with session_factory() as s:
        ex.montar_cartera(caso, s, sv)
        ctx = construir(s, sv, ahora=ex.AHORA)
    excluidas = {x["symbol"]: x["motivo"] for x in ctx["sin_peso"]}
    assert ("SHOP.TO" in excluidas) is fuera
    if fuera:
        assert "CAD" in excluidas["SHOP.TO"]


def test_el_stop_perforado_en_cartera_vende(session_factory):
    a = _analizar(session_factory, "stop_perforado", "con_stop_perforado")
    assert a["decision"]["action"] == "vender"


def test_las_listas_diarias(session_factory):
    import time_machine

    from app.routers.signals import _today

    with time_machine.travel(ex.AHORA, tick=False):
        resultados = {}
        for caso in ex.LISTAS:
            with session_factory() as s:
                resultados[caso] = _today("us_sp500", False, 600, ex.servicio_lista(caso), s)
    completo = resultados["dia_completo_502"]
    assert completo["scored"] == completo["requested"] == 502 and completo["shortlist"]["ideas"]
    assert resultados["dia_sin_candidatas"]["shortlist"]["ideas"] == []
    assert not any(x["decision"]["action"] == "comprar" for x in resultados["dia_sin_candidatas"]["signals"])
    pequeno = {x["key"]: x for x in resultados["sector_pequeno"]["sectors"]}
    assert pequeno["Real Estate"]["scored"] == 2 and pequeno["Real Estate"]["usable"] is False
