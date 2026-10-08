"""Respuestas REALES de los proveedores, grabadas y reproducibles (ítem 0.7).

El mayor riesgo de la app es que nada se ha probado contra datos reales. Esto lo
convierte en algo comprobable sin red: se graba una vez, con tus claves,

    python scripts/validar_con_datos_reales.py --grabar            # AAPL, T, RY.TO

y los tests de contrato (`tests/test_contrato_reales.py`) reproducen después esas
respuestas por la cadena entera —proveedor → frontera de validación → motor— en
cada ejecución de la suite, aquí y en la CI.

**Qué se guarda y qué no.** Por cada petición HTTP (EDGAR, Finnhub, Twelve Data,
FRED): la URL, los parámetros SIN las claves (`token`, `apikey`, `api_key`), el
estado y el cuerpo. NO se guardan cabeceras (la de EDGAR lleva tu nombre y tu
email). Cualquier aparición de una clave configurada dentro de un cuerpo se tacha.
yfinance no usa httpx: se graba lo que devuelve el proveedor. Los ficheros van
comprimidos (`<nombre>.json.gz`): el companyfacts de EDGAR pesa megas.
"""

from __future__ import annotations

import contextlib
import gzip
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import httpx

DIR = Path(__file__).resolve().parent
PARAMS_SECRETOS = frozenset({"token", "apikey", "api_key", "apiKey"})
VERSION = 1


def _sanear_params(params) -> dict:
    return {str(k): str(v) for k, v in (params or {}).items() if str(k) not in PARAMS_SECRETOS}


def _clave(url: str, params: dict) -> str:
    return url + ("?" + urlencode(sorted(params.items())) if params else "")


def _secretos() -> list[str]:
    from app.config import settings

    candidatos = [settings.finnhub_api_key, settings.twelvedata_api_key, settings.fred_api_key,
                  getattr(settings, "anthropic_api_key", ""), settings.edgar_user_agent]
    return [s for s in candidatos if s and len(s) >= 6]


def _tachar(texto: str, secretos: list[str]) -> str:
    for s in secretos:
        texto = texto.replace(s, "***")
    return texto


def casete_vacio(nombre: str, proveedores: list[str]) -> dict:
    return {"version": VERSION, "nombre": nombre, "grabado_en": datetime.now(timezone.utc).isoformat(),
            "proveedores": sorted(proveedores), "http": [], "yfinance": []}


@contextlib.contextmanager
def grabar(casete: dict, recortar_tickers: set[str] | None = None):
    """Mientras dura, cada `httpx.get` y cada `YFinanceProvider.fetch` se anotan
    en `casete`. `recortar_tickers`: del mapa de tickers de la SEC (≈1 MB) solo se
    guardan esas entradas, que son las únicas que el reproductor va a pedir."""
    from app.providers import yfinance_provider as yfp

    get_real, fetch_real = httpx.get, yfp.YFinanceProvider.fetch
    secretos = _secretos()

    def get(url, *args, params=None, **kw):
        resp = get_real(url, *args, params=params, **kw)
        entrada = {"url": str(url), "params": _sanear_params(params), "status": resp.status_code}
        try:
            cuerpo = resp.json()
            if recortar_tickers and str(url).endswith("company_tickers.json") and isinstance(cuerpo, dict):
                cuerpo = {k: v for k, v in cuerpo.items()
                          if isinstance(v, dict) and str(v.get("ticker", "")).upper() in recortar_tickers}
            entrada["json"] = json.loads(_tachar(json.dumps(cuerpo), secretos))
        except ValueError:
            entrada["text"] = _tachar(resp.text, secretos)
        casete["http"].append(entrada)
        return resp

    def fetch(self, data_type, **kwargs):
        entrada = {"data_type": data_type, "kwargs": {k: v for k, v in kwargs.items()}}
        try:
            r = fetch_real(self, data_type, **kwargs)
            entrada["payload"] = json.loads(_tachar(json.dumps(r, default=str), secretos))
            return r
        except Exception as exc:
            entrada["error"] = [type(exc).__name__, str(exc)[:300]]
            raise
        finally:
            casete["yfinance"].append(entrada)

    httpx.get, yfp.YFinanceProvider.fetch = get, fetch
    try:
        yield casete
    finally:
        httpx.get, yfp.YFinanceProvider.fetch = get_real, fetch_real


class _Respuesta:
    def __init__(self, e: dict):
        self.status_code = e["status"]
        # Se mira si se GRABÓ un JSON, no si vale None: un cuerpo `null` es un JSON
        # válido y antes se reproducía como «sin JSON».
        self._con_json = "json" in e
        self._json = e.get("json")
        self.text = e.get("text") if "text" in e else json.dumps(self._json)
        self.headers = {"content-type": "application/json" if self._con_json else "text/html"}

    def json(self):
        if not self._con_json:
            raise ValueError("sin JSON")
        return self._json


@contextlib.contextmanager
def reproducir(casete: dict):
    """Sin red: cada petición se contesta con lo grabado. Lo no grabado es un
    error de red, como si el proveedor estuviera caído."""
    from app.providers import yfinance_provider as yfp
    from app.providers.base import DataNotFoundError, ProviderError

    http: dict[str, list[dict]] = {}
    for e in casete["http"]:
        http.setdefault(_clave(e["url"], e["params"]), []).append(e)
    yf = {(e["data_type"], json.dumps(e["kwargs"], sort_keys=True)): e for e in casete["yfinance"]}
    get_real, fetch_real = httpx.get, yfp.YFinanceProvider.fetch

    def get(url, *args, params=None, **kw):
        cola = http.get(_clave(str(url), _sanear_params(params)))
        if not cola:
            raise httpx.ConnectError(f"sin grabación para {url}")
        return _Respuesta(cola[0] if len(cola) == 1 else cola.pop(0))

    def fetch(self, data_type, **kwargs):
        e = yf.get((data_type, json.dumps(kwargs, sort_keys=True)))
        if e is None:
            raise ProviderError(f"yfinance: sin grabación para {data_type} {kwargs}")
        if "error" in e:
            cls = DataNotFoundError if e["error"][0] == "DataNotFoundError" else ProviderError
            raise cls(e["error"][1])
        return e["payload"]

    httpx.get, yfp.YFinanceProvider.fetch = get, fetch
    try:
        yield
    finally:
        httpx.get, yfp.YFinanceProvider.fetch = get_real, fetch_real


def guardar(casete: dict, directorio: Path = DIR) -> Path:
    ruta = directorio / f"{casete['nombre']}.json.gz"
    with gzip.open(ruta, "wt", encoding="utf-8") as f:
        json.dump(casete, f, ensure_ascii=False, sort_keys=True)
    return ruta


def cargar(ruta: Path) -> dict:
    with gzip.open(ruta, "rt", encoding="utf-8") as f:
        return json.load(f)


def disponibles(directorio: Path = DIR) -> list[Path]:
    return sorted(directorio.glob("*.json.gz"))


def servicio(casete: dict, session_factory):
    """El servicio de datos de la app con los MISMOS proveedores que había al
    grabar (con claves falsas: no van a salir de aquí), su router con la
    frontera de validación y una caché en la base de pruebas."""
    from app.cache.cache import CacheStore, MarketDataService
    from app.providers.edgar import EdgarProvider
    from app.providers.finnhub import FinnhubProvider
    from app.providers.fred import FredProvider
    from app.providers.router import DataRouter, RateLimiter
    from app.providers.twelvedata import TwelveDataProvider
    from app.providers.yfinance_provider import YFinanceProvider

    fabricas = {
        "finnhub": lambda: FinnhubProvider("reproduccion"),
        "twelvedata": lambda: TwelveDataProvider("reproduccion"),
        "edgar": lambda: EdgarProvider("reproduccion reproduccion@example.com"),
        "fred": lambda: FredProvider("reproduccion"),
        "yfinance": YFinanceProvider,
    }
    proveedores = {n: fabricas[n]() for n in casete["proveedores"] if n in fabricas}
    router = DataRouter(proveedores, RateLimiter(session_factory), sleep=lambda _s: None)
    return MarketDataService(router, CacheStore(session_factory))
