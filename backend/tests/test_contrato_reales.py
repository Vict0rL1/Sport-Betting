"""Contrato con los proveedores reales, sin red (ítem 0.7 del plan).

Dos partes:

1. **El mecanismo** (siempre): grabar no guarda claves ni cabeceras y tacha
   cualquier clave que aparezca en un cuerpo; reproducir devuelve lo mismo; lo
   no grabado se comporta como un proveedor caído.
2. **Las grabaciones reales** (si existen en `tests/fixtures/reales/`): cada
   respuesta pasa por los proveedores de verdad, la frontera de validación y el
   motor, y tiene que salir sin romperse, con cifras plausibles y en sus
   unidades. Sin grabaciones, se saltan diciendo cómo grabar.
"""

from __future__ import annotations

import json
import math
from datetime import datetime

import httpx
import pytest
import time_machine

from tests.fixtures import reales

SIN_GRABACIONES = (
    "Sin respuestas reales grabadas en tests/fixtures/reales/. Grábalas una vez con tus claves: "
    "`python scripts/validar_con_datos_reales.py --grabar` (AAPL, T y RY.TO por defecto)."
)


# --- 1. El mecanismo ----------------------------------------------------------------------


class _RespuestaFalsa:
    def __init__(self, status: int, cuerpo: dict):
        self.status_code, self._cuerpo = status, cuerpo
        self.text, self.headers = json.dumps(cuerpo), {"content-type": "application/json"}

    def json(self):
        return self._cuerpo


def _red_falsa(llamadas: list):
    def get(url, params=None, headers=None, timeout=None, **kw):
        llamadas.append((url, dict(params or {}), dict(headers or {})))
        if url.endswith("/quote"):
            # Un proveedor que devuelve la clave en el cuerpo (pasa con mensajes de error).
            return _RespuestaFalsa(200, {"c": 101.5, "d": 1.0, "dp": 1.0, "h": 102, "l": 99, "o": 100,
                                         "pc": 100.5, "t": 1790000000, "eco": f"token={params.get('token')}"})
        return _RespuestaFalsa(404, {"error": "no existe"})
    return get


@pytest.fixture
def clave_configurada(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "finnhub_api_key", "CLAVE-SECRETA-123")
    monkeypatch.setattr(settings, "edgar_user_agent", "Victor Prueba correo@ejemplo.com")
    return "CLAVE-SECRETA-123"


def test_grabar_no_guarda_claves_ni_cabeceras(monkeypatch, clave_configurada):
    from app.providers.finnhub import FinnhubProvider

    llamadas: list = []
    monkeypatch.setattr(httpx, "get", _red_falsa(llamadas))
    casete = reales.casete_vacio("PRUEBA", ["finnhub"])
    with reales.grabar(casete):
        cotizacion = FinnhubProvider(clave_configurada).fetch("quote", symbol="AAPL")
    assert llamadas[0][1]["token"] == clave_configurada  # la petición real sí la lleva
    texto = json.dumps(casete)
    assert clave_configurada not in texto and "correo@ejemplo.com" not in texto
    assert casete["http"][0]["params"] == {"symbol": "AAPL"}
    assert "headers" not in casete["http"][0]
    assert cotizacion["price"] == 101.5


def test_reproducir_devuelve_lo_grabado_y_lo_no_grabado_es_un_fallo(monkeypatch, clave_configurada, tmp_path):
    from app.providers.base import ProviderError
    from app.providers.finnhub import FinnhubProvider

    monkeypatch.setattr(httpx, "get", _red_falsa([]))
    casete = reales.casete_vacio("PRUEBA", ["finnhub"])
    with reales.grabar(casete):
        original = FinnhubProvider(clave_configurada).fetch("quote", symbol="AAPL")
    casete = reales.cargar(reales.guardar(casete, tmp_path))  # ida y vuelta por disco, comprimido

    def sin_red(*a, **kw):
        raise AssertionError("la reproducción no puede salir a la red")

    monkeypatch.setattr(httpx, "get", sin_red)
    with reales.reproducir(casete):
        assert FinnhubProvider("otra-clave").fetch("quote", symbol="AAPL") == original
        with pytest.raises(ProviderError):
            FinnhubProvider("otra-clave").fetch("quote", symbol="MSFT")


def test_yfinance_se_graba_a_nivel_de_proveedor(monkeypatch):
    from app.providers import yfinance_provider as yfp
    from app.providers.base import DataNotFoundError

    def fetch_falso(self, data_type, **kw):
        if kw.get("symbol") == "NOEXISTE":
            raise DataNotFoundError("yfinance: sin datos")
        return {"symbol": kw["symbol"], "price": 50.0, "source": "yfinance"}

    monkeypatch.setattr(yfp.YFinanceProvider, "fetch", fetch_falso)
    casete = reales.casete_vacio("PRUEBA", ["yfinance"])
    with reales.grabar(casete):
        yfp.YFinanceProvider().fetch("quote", symbol="KO")
        with pytest.raises(DataNotFoundError):
            yfp.YFinanceProvider().fetch("quote", symbol="NOEXISTE")
    monkeypatch.setattr(yfp.YFinanceProvider, "fetch", lambda *a, **k: (_ for _ in ()).throw(AssertionError("red")))
    with reales.reproducir(casete):
        assert yfp.YFinanceProvider().fetch("quote", symbol="KO")["price"] == 50.0
        with pytest.raises(DataNotFoundError):
            yfp.YFinanceProvider().fetch("quote", symbol="NOEXISTE")


# --- 2. Las grabaciones reales --------------------------------------------------------------

GRABACIONES = [r for r in reales.disponibles() if not r.name.startswith("_")]
COMUN = next((r for r in reales.disponibles() if r.name.startswith("_comun")), None)


def _finito(x) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)


# Lo que una grabación TIENE que traer bien. Antes todo iba dentro de
# `if pedidos[...]["ok"]`: una grabación hecha con claves caducadas (todo 401)
# pasaba el contrato sin comprobar nada. RY.TO no está en la SEC: sin estados.
OBLIGATORIOS = {
    "AAPL": {"quote", "price_history", "financials", "fundamentals"},
    "T": {"quote", "price_history", "financials", "fundamentals"},
    "RY.TO": {"quote", "price_history"},
}
OBLIGATORIOS_POR_DEFECTO = {"quote", "price_history"}
MARGENES = ("gross_margin", "operating_margin", "net_margin")


def comprobar_unidades(simbolo: str, precio: float | None, ultimo: dict | None, metricas: dict | None) -> None:
    """Unidades que no dependen del tamaño de la empresa.

    «Ingresos > 1 millón» no veía unos ingresos de Apple en miles (3,9e8 sigue
    siendo > 1e6). Un cociente sí: precio × acciones / ingresos (el P/S) sale
    1.000 veces mayor con los ingresos en miles, y el BPA deja de cuadrar con
    beneficio / acciones si cualquiera de los dos viene en otra escala."""
    if ultimo:
        ingresos, acciones, beneficio, bpa = (ultimo.get(k) for k in ("revenue", "shares_outstanding",
                                                                       "net_income", "eps_diluted"))
        if precio and ingresos and acciones and ingresos > 0:
            ps = precio * acciones / ingresos
            assert 0.05 < ps < 200, f"{simbolo}: P/S de {ps:.4g}; ¿ingresos o acciones en otra escala?"
        if bpa and beneficio and acciones and abs(beneficio / acciones) > 0.01:
            cociente = bpa / (beneficio / acciones)
            assert 0.5 < cociente < 2, f"{simbolo}: BPA {bpa} frente a beneficio/acciones {beneficio / acciones:.4g}"
    if metricas:
        for m in MARGENES:
            v = metricas.get(m)
            assert v is None or -5 <= v <= 1, f"{simbolo}: {m} = {v}; ¿en porcentaje en vez de fracción?"
        cap = metricas.get("market_cap")
        assert cap is None or cap > 1e8, f"{simbolo}: capitalización {cap}; ¿en millones en vez de dólares?"
        if cap and precio and ultimo and ultimo.get("shares_outstanding"):
            r = cap / (precio * ultimo["shares_outstanding"])
            assert 0.5 < r < 2, f"{simbolo}: capitalización {cap:.4g} frente a precio × acciones ({r:.3g}×)"


def comprobar_empresa(casete: dict, session_factory) -> dict:
    """Lo grabado de UNA empresa, por proveedores → validación → motor."""
    from app import analisis_empresa
    from app import coherencia as co
    from tests.golden.canon import canon

    simbolo = casete["nombre"]
    momento = datetime.fromisoformat(casete["grabado_en"])
    pedidos = {p["tipo"]: p for p in casete.get("pedidos") or []}
    faltan = sorted(t for t in OBLIGATORIOS.get(simbolo, OBLIGATORIOS_POR_DEFECTO)
                    if not pedidos.get(t, {}).get("ok"))
    assert not faltan, (f"La grabación de {simbolo} no trae {', '.join(faltan)} "
                        f"({'; '.join(str(pedidos.get(t, {}).get('motivo', 'no se pidió')) for t in faltan)}). "
                        "¿Claves caducadas o sin red al grabar? Vuelve a grabar.")
    with reales.reproducir(casete), time_machine.travel(momento, tick=False):
        sv = reales.servicio(casete, session_factory)

        q = ultimo = metricas = None
        if pedidos.get("quote", {}).get("ok"):
            q = sv.get("quote", symbol=simbolo)
            assert _finito(q["price"]) and q["price"] > 0, q
        if pedidos.get("price_history", {}).get("ok"):
            h = sv.get("price_history", symbol=simbolo, interval="1day", outputsize=252)
            cierres = [b["close"] for b in h["bars"]]
            assert len(cierres) >= 100 and all(_finito(c) and c > 0 for c in cierres)
            fechas = [str(b["ts"])[:10] for b in h["bars"]]
            assert fechas == sorted(fechas), "el histórico tiene que venir ordenado"
            if q:
                assert co.cotizacion_frente_a_cierre(simbolo, q, h["bars"], momento.date())[0]["estado"] != co.FAIL
        if pedidos.get("financials", {}).get("ok"):
            f = sv.get("financials", symbol=simbolo)
            ultimo = f["periods"][-1]
            assert ultimo.get("revenue") is None or ultimo["revenue"] > 1e6, ultimo.get("revenue")
            assert ultimo.get("shares_outstanding") is None or ultimo["shares_outstanding"] > 1e5
            assert ultimo.get("eps_diluted") is None or -100 < ultimo["eps_diluted"] < 500
            for fila in co.trimestres_frente_al_ano(simbolo, f) + co.fechas_de_publicacion(simbolo, f, momento.date()):
                assert fila["estado"] != co.FAIL, fila
        if pedidos.get("fundamentals", {}).get("ok"):
            metricas = sv.get("fundamentals", symbol=simbolo).get("metrics") or {}
        comprobar_unidades(simbolo, q["price"] if q else None, ultimo, metricas)

        with session_factory() as s:
            a = analisis_empresa.analizar(simbolo, sv, s, ahora=momento, con_pares=False)
        assert a["decision"]["action"] in {"comprar", "vigilar", "ninguna", "evitar", "sin_datos"}
        assert "NaN" not in json.dumps(canon(a)), "un NaN llegó al análisis"
    assert "analisis_error" not in casete, casete.get("analisis_error")
    return a


def comprobar_comun(casete: dict, session_factory) -> int:
    """Los tipos de cambio grabados, en su banda y con la dirección buena."""
    from app import coherencia as co
    from app.analysis import fx

    momento = datetime.fromisoformat(casete["grabado_en"])
    comprobados = 0
    with reales.reproducir(casete), time_machine.travel(momento, tick=False):
        sv = reales.servicio(casete, session_factory)
        for p in casete.get("pedidos") or []:
            if p["tipo"] != "macro" or not p["ok"]:
                continue
            moneda = next(m for m, d in fx.SERIES.items() if d["serie"] == p["kwargs"]["series_id"])
            puntos = sv.get("macro", **p["kwargs"])["points"]
            fila = co.tipo_de_cambio(moneda, fx.tipo_desde_observaciones(moneda, puntos, momento.date()))[0]
            assert fila["estado"] == co.PASS, fila
            comprobados += 1
    return comprobados


@pytest.mark.parametrize("ruta", GRABACIONES or [None], ids=[r.name for r in GRABACIONES] or ["sin_grabaciones"])
def test_las_respuestas_reales_atraviesan_proveedor_validacion_y_motor(ruta, session_factory):
    if ruta is None:
        pytest.skip(SIN_GRABACIONES)
    comprobar_empresa(reales.cargar(ruta), session_factory)


def test_los_tipos_de_cambio_reales_tienen_la_direccion_buena(session_factory):
    if COMUN is None:
        pytest.skip(SIN_GRABACIONES)
    assert comprobar_comun(reales.cargar(COMUN), session_factory) > 0


# --- 3. De punta a punta, sin red: --grabar sobre una red simulada y reproducción ------------


def test_grabar_y_reproducir_de_punta_a_punta(monkeypatch, tmp_path, session_factory):
    """El modo `--grabar` del script, sobre una red con la forma de la real, y
    los mismos tests de contrato sobre lo grabado. Prueba la tubería que usarás
    con tus claves; no prueba a los proveedores (para eso hay que grabar de verdad)."""
    import importlib.util
    from datetime import date
    from pathlib import Path

    from app.config import settings
    from app.providers import edgar
    from tests.fixtures.reales import red_simulada

    for clave, valor in (("finnhub_api_key", "fh-SECRETO-1"), ("twelvedata_api_key", "td-SECRETO-2"),
                         ("fred_api_key", "fred-SECRETO-3"), ("edgar_user_agent", "Nombre Real yo@correo.es")):
        monkeypatch.setattr(settings, clave, valor)
    monkeypatch.setitem(edgar._cik_cache, "fetched_at", 0.0)
    monkeypatch.setitem(edgar._cik_cache, "map", {})
    monkeypatch.setattr(httpx, "get", red_simulada.red(date.today()))

    ruta = Path(__file__).resolve().parent.parent / "scripts" / "validar_con_datos_reales.py"
    spec = importlib.util.spec_from_file_location("validar_con_datos_reales_contrato", ruta)
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    archivos = script.grabar([red_simulada.TICKER], destino=tmp_path, sesiones_cuota=session_factory)
    assert sorted(a.name for a in archivos) == ["SIMU.json.gz", "_comun.json.gz"]

    crudo = "".join(json.dumps(reales.cargar(a)) for a in archivos)
    for secreto in ("fh-SECRETO-1", "td-SECRETO-2", "fred-SECRETO-3", "yo@correo.es"):
        assert secreto not in crudo
    empresa = reales.cargar(tmp_path / "SIMU.json.gz")
    assert {p["tipo"] for p in empresa["pedidos"] if p["ok"]} >= {"quote", "price_history", "financials"}
    # Del mapa de tickers de la SEC solo queda la empresa grabada.
    mapa = next(e for e in empresa["http"] if e["url"].endswith("company_tickers.json"))
    assert [v["ticker"] for v in mapa["json"].values()] == ["SIMU"]

    def sin_red(*a, **kw):
        raise AssertionError("la reproducción no puede salir a la red")

    monkeypatch.setattr(httpx, "get", sin_red)
    monkeypatch.setitem(edgar._cik_cache, "fetched_at", 0.0)
    monkeypatch.setitem(edgar._cik_cache, "map", {})
    a = comprobar_empresa(empresa, session_factory)
    # Lo que el análisis pidió al grabar se reproduce entero: sin huecos.
    assert a["mercado"]["precio"]["estado"] == "valido" and a["fundamentales"]["estado"] == "valido"
    assert a["noticias"]["items"], "las noticias que pidió el análisis no se reprodujeron"
    assert a["resultados_proximos"], "el calendario que pidió el análisis no se reprodujo"
    assert comprobar_comun(reales.cargar(tmp_path / "_comun.json.gz"), session_factory) == 2


# --- 4. Que el contrato no pueda pasar en vacío (revisión de la Fase 0) ----------------------


def test_una_grabacion_con_las_claves_caducadas_no_pasa_el_contrato(session_factory):
    casete = {"nombre": "AAPL", "grabado_en": "2026-10-08T10:00:00+00:00", "http": [], "yfinance": [],
              "pedidos": [{"tipo": t, "kwargs": {}, "ok": False, "motivo": "401 Unauthorized"}
                          for t in ("quote", "price_history", "financials", "fundamentals")]}
    with pytest.raises(AssertionError, match="Claves caducadas"):
        comprobar_empresa(casete, session_factory)


BUENOS = {"revenue": 3.9e11, "shares_outstanding": 1.5e10, "net_income": 9.4e10, "eps_diluted": 6.1}


@pytest.mark.parametrize("ultimo,metricas,culpa", [
    ({**BUENOS, "revenue": 3.9e8}, None, "P/S"),                              # ingresos en miles
    ({**BUENOS, "shares_outstanding": 1.5e7}, None, "P/S"),                   # acciones en miles
    ({**BUENOS, "eps_diluted": 6100.0}, None, "BPA"),
    (BUENOS, {"operating_margin": 30.5}, "porcentaje"),                       # margen en %, no en fracción
    (BUENOS, {"market_cap": 3.4e6}, "millones"),                              # capitalización en millones
    (BUENOS, {"market_cap": 3.4e13}, "precio × acciones"),
])
def test_las_unidades_raras_se_detectan_sea_cual_sea_el_tamano(ultimo, metricas, culpa):
    with pytest.raises(AssertionError, match=culpa):
        comprobar_unidades("AAPL", 227.0, ultimo, metricas)


def test_las_unidades_buenas_pasan():
    comprobar_unidades("AAPL", 227.0, BUENOS, {"operating_margin": 0.31, "gross_margin": 0.46,
                                               "net_margin": 0.24, "market_cap": 3.4e12})


def test_un_cuerpo_json_null_se_reproduce_como_null():
    casete = reales.casete_vacio("PRUEBA", ["finnhub"])
    casete["http"].append({"url": "https://x.example/api", "params": {}, "status": 200, "json": None})
    with reales.reproducir(casete):
        assert httpx.get("https://x.example/api").json() is None


def test_una_grabacion_que_cruza_la_medianoche_no_se_guarda():
    import importlib.util
    from datetime import timedelta, timezone
    from pathlib import Path

    ruta = Path(__file__).resolve().parent.parent / "scripts" / "validar_con_datos_reales.py"
    spec = importlib.util.spec_from_file_location("validar_con_datos_reales_medianoche", ruta)
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    ayer = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    with pytest.raises(RuntimeError, match="medianoche"):
        script._sin_cruzar_medianoche({"nombre": "AAPL", "grabado_en": ayer})
    script._sin_cruzar_medianoche({"nombre": "AAPL", "grabado_en": datetime.now(timezone.utc).isoformat()})
