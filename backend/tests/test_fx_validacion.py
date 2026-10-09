"""Un tipo de cambio fuera de su banda es un fallo del proveedor (ítem 1.12).

Antes la banda solo se miraba al convertir la cartera: una serie de FRED leída
del revés (CAD a 0,73 por dólar en vez de 1,37) se guardaba en caché como si
fuera buena y se rechazaba en cada lectura, sin probar otra fuente. Ahora se
rechaza al recibirla, igual que un NaN o un precio negativo.
"""

from __future__ import annotations

import pytest

from app.providers.base import DataProvider
from app.providers.router import DataRouter, RateLimiter
from app.validacion import PayloadInvalido, validar


def serie(series_id: str, valor: float) -> dict:
    return {"series_id": series_id, "as_of": "2026-09-30T00:00:00+00:00",
            "points": [{"date": f"2026-09-{d:02d}", "value": valor} for d in range(1, 21)]}


def test_una_serie_de_cad_leida_del_reves_se_rechaza():
    with pytest.raises(PayloadInvalido, match="leída del revés"):
        validar("macro", serie("DEXCAUS", 0.73))


def test_la_serie_buena_pasa():
    assert validar("macro", serie("DEXCAUS", 1.37))["points"][0]["value"] == 1.37


def test_un_dato_raro_suelto_no_es_una_inversion():
    s = serie("DEXCAUS", 1.37)
    s["points"][3]["value"] = 0.73
    assert validar("macro", s)["points"][3]["value"] == 0.73


def test_una_serie_que_no_es_de_tipo_de_cambio_no_se_mira():
    assert validar("macro", serie("DGS10", 0.73))["series_id"] == "DGS10"


class FuenteFalsa(DataProvider):
    capabilities = frozenset({"macro"})

    def __init__(self, name, valor):
        self.name, self.valor, self.calls = name, valor, 0

    def get_macro(self, series_id, start):
        self.calls += 1
        return serie(series_id, self.valor)


def test_la_fuente_invertida_pierde_frente_a_la_siguiente(session_factory):
    a, b = FuenteFalsa("a", 0.73), FuenteFalsa("b", 1.37)
    router = DataRouter({"a": a, "b": b}, RateLimiter(session_factory, {"a": (100, 60), "b": (100, 60)}),
                        source_order={"macro": ["a", "b"]}, sleep=lambda s: None)
    out = router.fetch("macro", series_id="DEXCAUS", start="2026-09-01")
    assert out["source"] == "b"
    assert out["points"][0]["value"] == 1.37
