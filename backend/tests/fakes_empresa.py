"""Un servicio de datos falso, determinista y mutable, para los análisis de empresa.

Mutable a propósito: los tests de replay CAMBIAN los datos de hoy —el precio,
los fundamentales, la tesis— y comprueban que lo congelado ayer no se mueve.
Ningún valor de mercado real: todo son cifras inventadas y redondas.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from app.providers.base import DataNotFoundError


def periodo(ano: int, presentado: str, **campos) -> dict:
    """Un ejercicio anual con linaje por partida, como lo deja el parser de EDGAR."""
    fin = f"{ano}-12-31"
    return {
        "fiscal_year": str(ano),
        "end_date": fin,
        "filed_at": presentado,
        **campos,
        "fuentes": {
            c: {"etiqueta": f"Tag{c}", "formulario": "10-K", "presentado": presentado,
                "accn": f"A-{ano}", "inicio": f"{ano}-01-01", "fin": fin}
            for c in campos
        },
    }


def trimestre(ano: int, q: int, presentado: str, **campos) -> dict:
    fin = {1: f"{ano}-03-31", 2: f"{ano}-06-30", 3: f"{ano}-09-30", 4: f"{ano}-12-31"}[q]
    return {
        "end_date": fin, "filed_at": presentado, "fiscal_year": str(ano),
        "fiscal_period": f"Q{q}", "periodo": f"{ano}-Q{q}", **campos,
        "fuentes": {
            c: {"etiqueta": f"Tag{c}", "formulario": "10-Q" if q < 4 else "10-K",
                "presentado": presentado, "accn": f"Q-{ano}-{q}", "fin": fin}
            for c in campos
        },
    }


def barras(hasta: date, n: int = 260, desde: float = 80.0, hasta_precio: float = 104.0) -> list[dict]:
    """Una subida lineal: la media de 200 sesiones queda claramente por debajo."""
    paso = (hasta_precio - desde) / (n - 1)
    return [
        {"ts": (hasta - timedelta(days=n - 1 - i)).isoformat(), "close": round(desde + paso * i, 4)}
        for i in range(n)
    ]


class CacheFalsa:
    def __init__(self):
        self.datos: dict[tuple, dict] = {}

    def _k(self, tipo, params):
        return tipo, json.dumps(params, sort_keys=True)

    def get(self, tipo, params):
        return self.datos.get(self._k(tipo, params))

    def set(self, tipo, params, payload):
        self.datos[self._k(tipo, params)] = payload


class ServicioFalso:
    def __init__(self, ahora: datetime):
        self.ahora = ahora
        self.cache = CacheFalsa()
        self.quotes: dict[str, dict] = {}
        self.historias: dict[str, list[dict]] = {}
        self.financials: dict[str, dict] = {}
        self.noticias: dict[str, list[dict]] = {}
        self.calendario: list[dict] = []
        self.fundamentales: dict[str, dict] = {}
        self.llamadas: list[tuple] = []

    # --- Atajos para montar escenarios ---
    def empresa(self, symbol="AAPL", precio=104.0, score=0.6, periodos=None, trimestres=None,
                moneda="USD", noticias=None):
        self.quotes[symbol] = {"symbol": symbol, "price": precio, "currency": moneda,
                               "source": "finnhub", "as_of": self.ahora.isoformat(), "estado": "valido"}
        self.historias[symbol] = barras(self.ahora.date() - timedelta(days=1))
        if periodos is not None:
            self.financials[symbol] = {"symbol": symbol, "source": "edgar", "periods": periodos,
                                       "quarters": trimestres or [], "as_of": self.ahora.isoformat()}
        self.noticias[symbol] = noticias or []
        if score is not None:
            self.senal(symbol, score)
        return self

    def senal(self, symbol, score, as_of=None, mercado="us_sp500"):
        params = {"v": 6, "market": mercado}
        lista = self.cache.get("daily_picks", params) or {"signals": [], "as_of": (as_of or self.ahora).isoformat()}
        lista["signals"] = [s for s in lista["signals"] if s["symbol"] != symbol] + [
            {"symbol": symbol, "score": score, "label": "favorable", "coverage": 1.0,
             "context": {"sector_name": "Technology"}}
        ]
        self.cache.set("daily_picks", params, lista)

    def get(self, tipo, **kw):
        self.llamadas.append((tipo, kw))
        symbol = kw.get("symbol")
        if tipo == "quote":
            if symbol not in self.quotes:
                raise DataNotFoundError(f"sin cotización de {symbol}")
            return dict(self.quotes[symbol])
        if tipo == "price_history":
            if symbol not in self.historias:
                raise DataNotFoundError("sin histórico")
            return {"bars": list(self.historias[symbol]), "source": "yfinance", "as_of": self.ahora.isoformat()}
        if tipo == "price_history_long":
            if symbol not in self.historias:
                raise DataNotFoundError("sin histórico")
            return {"bars": list(self.historias[symbol]), "source": "yfinance", "as_of": self.ahora.isoformat()}
        if tipo == "financials":
            if symbol not in self.financials:
                raise DataNotFoundError(f"edgar: {symbol} no está registrado")
            return json.loads(json.dumps(self.financials[symbol]))
        if tipo == "news":
            return {"items": list(self.noticias.get(symbol, [])), "source": "finnhub",
                    "as_of": self.ahora.isoformat()}
        if tipo == "earnings_calendar":
            # Como el proveedor real: solo los eventos dentro de la ventana pedida.
            desde, hasta = kw.get("start") or "0000", kw.get("end") or "9999"
            return {"events": [e for e in self.calendario if desde <= e.get("date", "") <= hasta],
                    "as_of": self.ahora.isoformat()}
        if tipo == "fundamentals":
            if symbol not in self.fundamentales:
                raise DataNotFoundError("sin fundamentales")
            return self.fundamentales[symbol]
        if tipo in ("peers", "profile"):
            raise DataNotFoundError(tipo)
        if tipo == "macro":
            raise DataNotFoundError("sin macro")
        raise DataNotFoundError(f"tipo no simulado: {tipo}")


def financieros_base(ano_final: int = 2025, presentado: str = "2026-02-10") -> list[dict]:
    """Dos ejercicios coherentes: crecimiento del 10 %, márgenes estables."""
    return [
        periodo(ano_final - 1, f"{ano_final}-02-12", revenue=1000.0, gross_profit=400.0,
                operating_income=200.0, net_income=150.0, cfo=220.0, capex=40.0,
                eps_diluted=1.5, shares_outstanding=100.0, cash=100.0,
                long_term_debt=300.0, short_term_debt=0.0),
        periodo(ano_final, presentado, revenue=1100.0, gross_profit=440.0,
                operating_income=231.0, net_income=165.0, cfo=250.0, capex=50.0,
                eps_diluted=1.65, shares_outstanding=100.0, cash=120.0,
                long_term_debt=300.0, short_term_debt=0.0),
    ]


AHORA = datetime(2026, 9, 12, 14, 35, tzinfo=timezone.utc)
