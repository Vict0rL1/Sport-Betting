"""Paquete de casos extremos (ítem 0.4 del plan de correcciones).

Una sola fuente de escenarios raros, reutilizada por el golden master del motor
(0.3), los tests contra fugas de texto (0.5) y el barrido de capturas (0.6). Si
un caso nuevo hace falta en uno de ellos, se añade AQUÍ y lo ven los tres.

Todo es ficticio y determinista: cifras redondas, fechas fijas (`AHORA`), sin
red. Tres familias:

- `EMPRESAS`: el servicio de datos de UNA empresa (cotización, histórico,
  EDGAR, puntuación). `montar_empresa(caso)` → (servicio, símbolo).
- `CARTERAS`: posiciones, efectivo y tipos de cambio. `montar_cartera(caso,
  sesión, servicio)` siembra la base y el servicio.
- `LISTAS`: la lista diaria completa de un mercado. `servicio_lista(caso)` →
  servicio que puntúa el S&P 500 entero con datos inventados.
"""

from __future__ import annotations

import math
from datetime import timedelta

from app.db.models import CashBalance, Instrument, Position, Thesis, ThesisTrigger
from app.providers.base import DataNotFoundError, iso_utc
from tests.fakes_empresa import AHORA, ServicioFalso, barras, financieros_base, periodo, trimestre

__all__ = [
    "AHORA", "EMPRESAS", "CARTERAS", "LISTAS",
    "montar_empresa", "montar_cartera", "servicio_lista", "sembrar_cartera_lista", "trimestres_base",
]

# --- Empresas ---------------------------------------------------------------------------------


def trimestres_base() -> list[dict]:
    """Ocho trimestres coherentes con `financieros_base()`: ~275 de ingresos por
    trimestre en 2025, margen operativo del 21 %, publicados un mes tras cerrar."""
    qs = []
    for ano in (2024, 2025):
        for q in (1, 2, 3, 4):
            ing = 250.0 * (1.1 if ano == 2025 else 1.0) + q * 2
            publicado = f"{ano}-{q * 3 + 1:02d}-28" if q < 4 else f"{ano + 1}-02-10"
            qs.append(trimestre(ano, q, publicado, revenue=ing, operating_income=ing * 0.21,
                                gross_profit=ing * 0.4, net_income=ing * 0.15, eps_diluted=ing / 600,
                                cfo=ing * 0.22, capex=ing * 0.045))
    return qs


def _completa(sv: ServicioFalso, symbol: str = "ACME") -> str:
    sv.empresa(symbol, precio=104.0, score=0.6, periodos=financieros_base(), trimestres=trimestres_base())
    return symbol


def _todo_ausente(sv: ServicioFalso) -> str:
    """Cada campo falta: sin cotización, sin histórico, ejercicios sin una cifra y sin puntuación."""
    symbol = "VACIA"
    sv.financials[symbol] = {
        "symbol": symbol, "source": "edgar", "as_of": AHORA.isoformat(),
        "periods": [periodo(2024, "2025-02-12"), periodo(2025, "2026-02-10")],
        "quarters": [],
    }
    sv.noticias[symbol] = []
    return symbol


def _deuda_parcial(sv: ServicioFalso) -> str:
    symbol = _completa(sv, "PARC")
    for p in sv.financials[symbol]["periods"]:
        p["short_term_debt"] = None
        p["fuentes"].pop("short_term_debt", None)
    return symbol


def _precio_nan(sv: ServicioFalso) -> str:
    symbol = _completa(sv, "PNAN")
    sv.quotes[symbol]["price"] = float("nan")
    return symbol


def _precio_negativo(sv: ServicioFalso) -> str:
    symbol = _completa(sv, "PNEG")
    sv.quotes[symbol]["price"] = -5.0
    return symbol


def _solo_cache_viejo(sv: ServicioFalso) -> str:
    """Todas las fuentes fallaron: la cotización es la última copia, de hace 30 min."""
    symbol = _completa(sv, "VIEJ")
    sv.quotes[symbol].update(estado="viejo", antiguedad_segundos=1800,
                             aviso="Todas las fuentes fallaron: última copia guardada.")
    return symbol


def _no_sec(sv: ServicioFalso) -> str:
    """Cotizada en Toronto y sin registro en la SEC: EDGAR no tiene nada."""
    symbol = "RY.TO"
    sv.empresa(symbol, precio=140.0, score=None, moneda="CAD")
    return symbol


def _stop_perforado(sv: ServicioFalso) -> str:
    """La que se tiene en cartera con el stop por encima del precio (ver `CARTERAS`)."""
    return _completa(sv, "STOP")


EMPRESAS = {
    "completa": _completa,
    "todo_ausente": _todo_ausente,
    "deuda_parcial": _deuda_parcial,
    "precio_nan": _precio_nan,
    "precio_negativo": _precio_negativo,
    "solo_cache_viejo": _solo_cache_viejo,
    "no_sec": _no_sec,
    "stop_perforado": _stop_perforado,
}


def montar_empresa(caso: str, servicio: ServicioFalso | None = None) -> tuple[ServicioFalso, str]:
    sv = servicio or ServicioFalso(AHORA)
    return sv, EMPRESAS[caso](sv)


# --- Carteras ---------------------------------------------------------------------------------

# Tipos de FRED: DEXCAUS es «dólares canadienses por un dólar». 1,37 es la
# dirección buena; 0,73 es la misma serie leída del revés.
FX_BUENO = 1.37
FX_INVERTIDO = 1 / 1.37


def _serie_fx(valor: float, dias: int = 900) -> list[dict]:
    hoy = AHORA.date()
    return [{"ts": (hoy - timedelta(days=d)).isoformat(), "value": round(valor * (1 + 0.0004 * math.sin(d / 9)), 4)}
            for d in range(dias, 0, -1)]


def _historia_larga(sv: ServicioFalso, symbol: str, base: float, ruido: float, semilla: int) -> None:
    """Dos años de cierres en caché (la cartera lee el histórico largo de la caché)."""
    hasta = AHORA.date() - timedelta(days=1)
    puntos = [
        {"ts": b["ts"], "close": round(base * (1 + ruido * (((i * 7919 + semilla) % 11) - 5)) * (1 + i / 4000), 4)}
        for i, b in enumerate(barras(hasta, n=520))
    ]
    sv.historias.setdefault(symbol, puntos[-260:])
    sv.cache.set("price_history_long", {"symbol": symbol}, {"bars": puntos, "source": "yfinance",
                                                             "as_of": AHORA.isoformat()})


def _instrumento(session, symbol: str, sector: str, moneda: str = "USD") -> Instrument:
    inst = Instrument(symbol=symbol, name=f"{symbol} Corp", sector=sector, currency=moneda)
    session.add(inst)
    session.flush()
    return inst


def _posicion(session, inst: Instrument, cantidad: float, coste: float, stop: float | None, dias: int = 200) -> None:
    session.add(Position(instrument_id=inst.id, quantity=cantidad, cost_basis=coste, stop=stop,
                         opened_at=AHORA - timedelta(days=dias)))


def _vacia(session, sv: ServicioFalso) -> None:
    _historia_larga(sv, "SPY", 500.0, 0.001, 1)


def _una_posicion(session, sv: ServicioFalso) -> None:
    _vacia(session, sv)
    sv.empresa("KO", precio=60.0, score=None)
    _historia_larga(sv, "KO", 60.0, 0.0008, 3)
    _posicion(session, _instrumento(session, "KO", "Consumer Staples"), 300, 58.0, 50.0)
    session.add(CashBalance(moneda="USD", importe=1500.0, as_of=AHORA - timedelta(days=1)))


def _cad_en_usd(session, sv: ServicioFalso) -> None:
    _una_posicion(session, sv)
    sv.empresa("SHOP.TO", precio=140.0, score=None, moneda="CAD")
    _historia_larga(sv, "SHOP.TO", 140.0, 0.002, 5)
    _posicion(session, _instrumento(session, "SHOP.TO", "Technology", "CAD"), 100, 120.0, 110.0)
    sv.macro["DEXCAUS"] = _serie_fx(FX_BUENO)


def _fx_invertido(session, sv: ServicioFalso) -> None:
    _cad_en_usd(session, sv)
    sv.macro["DEXCAUS"] = _serie_fx(FX_INVERTIDO)


def _con_stop_perforado(session, sv: ServicioFalso) -> None:
    """La empresa `STOP` (de `EMPRESAS`) en cartera con un stop subido sobre el precio."""
    _una_posicion(session, sv)
    _historia_larga(sv, "STOP", 104.0, 0.0015, 7)
    _posicion(session, _instrumento(session, "STOP", "Technology"), 50, 90.0, 110.0)


CARTERAS = {
    "vacia": _vacia,
    "una_posicion": _una_posicion,
    "cad_en_usd": _cad_en_usd,
    "fx_invertido": _fx_invertido,
    "con_stop_perforado": _con_stop_perforado,
}


def montar_cartera(caso: str, session, servicio: ServicioFalso) -> None:
    CARTERAS[caso](session, servicio)
    session.commit()


def tesis_con_punto(session, symbol: str, umbral: float = 0.18) -> None:
    """Una tesis con un punto métrico (margen operativo) y otro de noticias."""
    inst = session.query(Instrument).filter_by(symbol=symbol).one_or_none() or _instrumento(session, symbol, "Tech")
    t = Thesis(instrument_id=inst.id, title="El margen aguanta", body_md="Margen operativo por encima del umbral.",
               created_at=AHORA - timedelta(days=60), updated_at=AHORA - timedelta(days=60))
    session.add(t)
    session.flush()
    session.add(ThesisTrigger(thesis_id=t.id, kind="metrica", descripcion=f"margen operativo < {umbral:.0%}",
                              config={"metrica": "operating_margin", "op": "lt", "umbral": umbral}))
    session.add(ThesisTrigger(thesis_id=t.id, kind="noticia", descripcion="recall", config={"palabras": ["recall"]}))
    session.commit()


# --- Listas diarias ---------------------------------------------------------------------------


class ServicioLista:
    """Puntúa cualquier símbolo con fundamentales deterministas (como el doble
    de `test_today.py`), con precios que SÍ traen media de 200 sesiones y
    volatilidad, para que el motor pueda decidir de verdad.

    `tendencia`: "a_favor" (precio sobre la media: hay candidatas) o "en_contra"
    (todas por debajo: día sin candidatas). `fallan`: símbolos sin fundamentales.
    """

    def __init__(self, tendencia: str = "a_favor", fallan: set[str] | None = None):
        from tests.test_scan import FakeCache

        self.tendencia = tendencia
        self.fallan = fallan or set()
        self.cache = FakeCache()
        self.ahora = AHORA

    def _precio(self, i: int, s: str) -> dict:
        last = 100.0 + (sum(map(ord, s)) % 50)
        factor = 0.9 if self.tendencia == "a_favor" else 1.1
        spark = [round(last * (0.9 + 0.1 * k / 31) * (1 + 0.01 * (((i + k) * 7) % 5 - 2)), 2) for k in range(32)]
        return {
            "last": last, "change_pct": (i % 5) - 2.0, "low_52w": last * 0.8, "high_52w": last * 1.2,
            "range_position": 0.5, "sma50": last * 0.97, "sma200": round(last * factor, 2),
            "above_sma200": self.tendencia == "a_favor", "daily_vol_pct": 1.0 + (i % 4) * 0.4,
            "drawdown_pct": -8.0, "spark": spark, "points": 251,
        }

    def get(self, data_type, **kwargs):
        common = {"source": "fake", "as_of": iso_utc(), "cached": False}
        if data_type == "bulk_momentum":
            symbols = kwargs["symbols"]
            return {**common, "momentum": {s: (i % 7) / 10 - 0.3 for i, s in enumerate(symbols)},
                    "prices": {s: self._precio(i, s) for i, s in enumerate(symbols)}}
        symbol = kwargs.get("symbol", "")
        if symbol in self.fallan:
            raise DataNotFoundError(f"sin datos para {symbol}")
        if data_type == "fundamentals":
            seed = sum(ord(c) for c in symbol)
            payload = {**common, "symbol": symbol, "period": "ttm", "metrics": {
                "pe_ttm": 8 + seed % 30, "pb": 1 + (seed % 60) / 10, "roe": (seed % 25) / 100,
                "operating_margin": (seed % 35) / 100, "debt_to_equity": (seed % 30) / 10,
                "market_cap": 1e9 + seed * 1e7}}
            self.cache.set("fundamentals", {"symbol": symbol}, payload)
            return payload
        if data_type == "profile":
            return {**common, "symbol": symbol, "name": f"{symbol} Inc", "sector": "Tech"}
        raise DataNotFoundError(f"tipo no simulado: {data_type}")


def _sector_pequeno() -> ServicioLista:
    """Un sector entero con solo dos empresas puntuables (mínimo: 3)."""
    from app.analysis.markets import load_market

    sector = load_market("us_sp500")["sectors"]["Real Estate"]
    return ServicioLista(fallan={c["symbol"] for c in sector[2:]})


LISTAS = {
    "dia_completo_502": lambda: ServicioLista("a_favor"),
    "dia_sin_candidatas": lambda: ServicioLista("en_contra"),
    "sector_pequeno": _sector_pequeno,
}


def servicio_lista(caso: str) -> ServicioLista:
    return LISTAS[caso]()


def sembrar_cartera_lista(session) -> None:
    """Posiciones para la lista diaria: KO está en el S&P 500 (la lista la
    decide); CHIP no está en ningún universo (la lista no la cubre y lo dice)."""
    _posicion(session, _instrumento(session, "KO", "Consumer Staples"), 300, 58.0, 50.0)
    _posicion(session, _instrumento(session, "CHIP", "Technology"), 200, 20.0, 18.0)
    session.commit()

