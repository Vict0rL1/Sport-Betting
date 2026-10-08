"""Una red de mentira con la FORMA de las respuestas reales (ítem 0.7).

Sirve para probar de punta a punta la grabación y la reproducción —el modo
`--grabar` del script, los casetes, los tests de contrato— en un entorno sin
claves ni salida a internet. Las cifras son inventadas; la forma de cada
respuesta (campos, unidades, anidamiento) es la de la documentación de cada
proveedor: companyfacts de la SEC, /quote y /stock/profile2 de Finnhub,
/time_series de Twelve Data y observations de FRED.

No sustituye a una grabación real: precisamente lo que no puede saber es si los
proveedores cambiaron algo. Para eso está `--grabar` con tus claves.
"""

from __future__ import annotations

import json
from datetime import date, timedelta

TICKER, CIK = "SIMU", 1234567
ANOS = (2022, 2023, 2024, 2025)


class Respuesta:
    def __init__(self, status: int, cuerpo):
        self.status_code, self._cuerpo = status, cuerpo
        self.text = json.dumps(cuerpo)
        self.headers = {"content-type": "application/json"}

    def json(self):
        return self._cuerpo


def _anual(valor_2025: float, crecimiento: float = 0.08) -> list[dict]:
    salida = []
    for i, ano in enumerate(ANOS):
        v = round(valor_2025 / (1 + crecimiento) ** (len(ANOS) - 1 - i), 2)
        salida.append({"start": f"{ano}-01-01", "end": f"{ano}-12-31", "val": v, "fy": ano, "fp": "FY",
                       "form": "10-K", "filed": f"{ano + 1}-02-10", "accn": f"0000-{ano}-10K"})
    return salida


def _trimestral(valor_2025: float) -> list[dict]:
    """Trimestres de 2025 como los da un 10-Q (Q1-Q3 sueltos) más el año del 10-K."""
    q = valor_2025 / 4
    salida = []
    for n, (ini, fin, pub) in enumerate((("01-01", "03-31", "04-30"), ("04-01", "06-30", "07-30"),
                                          ("07-01", "09-30", "10-30")), start=1):
        salida.append({"start": f"2025-{ini}", "end": f"2025-{fin}", "val": round(q * (0.97 + 0.02 * n), 2),
                       "fy": 2025, "fp": f"Q{n}", "form": "10-Q", "filed": f"2025-{pub}", "accn": f"0000-25-Q{n}"})
    return salida


def _instante(valor: float) -> list[dict]:
    return [{"end": f"{ano}-12-31", "val": valor, "fy": ano, "fp": "FY", "form": "10-K",
             "filed": f"{ano + 1}-02-10", "accn": f"0000-{ano}-10K"} for ano in ANOS]


def companyfacts() -> dict:
    flujo = {
        "RevenueFromContractWithCustomerExcludingAssessedTax": 40_000e6,
        "GrossProfit": 18_000e6, "OperatingIncomeLoss": 9_000e6, "NetIncomeLoss": 7_000e6,
        "NetCashProvidedByUsedInOperatingActivities": 8_500e6,
        "PaymentsToAcquirePropertyPlantAndEquipment": 1_500e6, "InterestExpense": 600e6,
    }
    gaap = {tag: {"units": {"USD": _anual(v) + _trimestral(v)}} for tag, v in flujo.items()}
    gaap["EarningsPerShareDiluted"] = {"units": {"USD/shares": _anual(7.0)}}
    for tag, v in {"Assets": 90_000e6, "StockholdersEquity": 35_000e6, "LongTermDebtNoncurrent": 25_000e6,
                   "LongTermDebtCurrent": 3_000e6, "CashAndCashEquivalentsAtCarryingValue": 6_000e6,
                   "AssetsCurrent": 30_000e6, "LiabilitiesCurrent": 20_000e6}.items():
        gaap[tag] = {"units": {"USD": _instante(v)}}
    dei = {"EntityCommonStockSharesOutstanding": {"units": {"shares": _instante(1_000e6)}}}
    return {"cik": CIK, "entityName": "Simulada Corp", "facts": {"us-gaap": gaap, "dei": dei}}


def _serie(hoy: date, dias: int, base: float) -> list[dict]:
    return [{"datetime": (hoy - timedelta(days=d)).isoformat(), "open": f"{base:.2f}", "high": f"{base * 1.01:.2f}",
             "low": f"{base * 0.99:.2f}", "close": f"{base * (1 + 0.0004 * (dias - d)):.2f}", "volume": "1000000"}
            for d in range(dias, 0, -1) if (hoy - timedelta(days=d)).weekday() < 5]


def red(hoy: date):
    """Un `httpx.get` falso. Sin claves válidas, nada: igual que el proveedor real."""

    def get(url, params=None, headers=None, timeout=None, **kw):
        p = dict(params or {})
        if url.endswith("company_tickers.json"):
            return Respuesta(200, {"0": {"cik_str": CIK, "ticker": TICKER, "title": "Simulada Corp"},
                                   "1": {"cik_str": 999, "ticker": "OTRA", "title": "Otra"}})
        if "companyfacts" in url:
            return Respuesta(200, companyfacts()) if f"{CIK:010d}" in url else Respuesta(404, {})
        if "finnhub.io" in url:
            if not p.get("token"):
                return Respuesta(401, {"error": "Invalid API key"})
            if url.endswith("/quote"):
                return Respuesta(200, {"c": 182.4, "d": 1.2, "dp": 0.66, "h": 183.0, "l": 180.9, "o": 181.0,
                                       "pc": 181.2, "t": 1790000000})
            if url.endswith("/stock/profile2"):
                return Respuesta(200, {"name": "Simulada Corp", "ticker": TICKER, "currency": "USD", "country": "US",
                                       "finnhubIndustry": "Technology", "marketCapitalization": 182400})
            if url.endswith("/stock/metric"):
                return Respuesta(200, {"metric": {"peTTM": 26.0, "pbAnnual": 5.2, "roeTTM": 20.0}})
            if url.endswith("/company-news"):
                return Respuesta(200, [{"headline": "Simulada presenta resultados", "datetime": 1789900000,
                                        "url": "https://example.com/n", "source": "Ejemplo", "summary": "…"}])
            if url.endswith("/calendar/earnings"):
                return Respuesta(200, {"earningsCalendar": [
                    {"symbol": TICKER, "date": (hoy + timedelta(days=20)).isoformat(), "epsEstimate": 1.9,
                     "revenueEstimate": 10_500e6, "epsActual": None, "revenueActual": None, "quarter": 4,
                     "year": 2025}]})
            return Respuesta(404, {})
        if "twelvedata.com" in url:
            if not p.get("apikey"):
                return Respuesta(401, {"status": "error"})
            if url.endswith("/time_series"):
                return Respuesta(200, {"meta": {"symbol": TICKER, "currency": "USD"},
                                       "values": _serie(hoy, 370, 150.0), "status": "ok"})
            return Respuesta(404, {})
        if "stlouisfed.org" in url:
            if not p.get("api_key"):
                return Respuesta(400, {})
            base = {"DEXCAUS": 1.37, "DEXUSEU": 1.09}.get(p.get("series_id"))
            if base is None:
                return Respuesta(400, {})
            return Respuesta(200, {"observations": [{"date": (hoy - timedelta(days=d)).isoformat(),
                                                      "value": f"{base:.4f}"} for d in range(60, 0, -1)]})
        return Respuesta(404, {})

    return get
