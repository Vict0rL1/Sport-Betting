"""El doble de los tests, con las respuestas completas que piden las pantallas.

`ServicioFalso` devuelve lo justo para el motor. Las pantallas antiguas (la
cabecera de la ficha, el gráfico) leen además campos que el servicio real
añade: frescura, variación del día, máximo y mínimo, velas con apertura y
volumen. Esto los completa A PARTIR de lo que el paquete de casos extremos ya
define, sin inventar nada: una empresa sin cotización sigue sin cotización (y
sin perfil), y un precio ausente no se convierte en cero.

Lo usan el exportador de respuestas para los tests del frontend y el servidor
de demostración de las capturas (que además inventa datos, pero solo para
símbolos que el paquete no conoce).
"""

from __future__ import annotations

from app import datos
from app.providers.base import DataNotFoundError
from tests.fakes_empresa import ServicioFalso


class ServicioPantallas(ServicioFalso):
    def get(self, tipo, **kw):
        symbol = kw.get("symbol")
        if tipo == "profile":
            # Un perfil solo para lo que algún proveedor conoce: sin cotización
            # (la empresa «sin un solo dato») tampoco hay perfil.
            if symbol not in self.quotes:
                raise DataNotFoundError(f"sin perfil de {symbol}")
            moneda = self.quotes[symbol].get("currency", "USD")
            return {"symbol": symbol, "name": f"{symbol} Corp", "sector": "Technology", "industry": "Software",
                    "country": "CA" if moneda == "CAD" else "US", "currency": moneda, "source": "finnhub",
                    "as_of": self.ahora.isoformat(), "cached": False}
        r = super().get(tipo, **kw)
        if tipo == "earnings_calendar":
            r = {"source": "finnhub", **r}
        if tipo == "quote":
            # Ausente ≠ cero: sin un precio utilizable no hay variación ni rango del día.
            p = datos.precio(r.get("price"))
            r = {"freshness": "delayed", "change": None if p is None else -1.2,
                 "change_pct": None if p is None else round(-1.2 / (p + 1.2) * 100, 4),
                 "prev_close": None if p is None else p + 1.2,
                 "day_high": None if p is None else p * 1.01, "day_low": None if p is None else p * 0.99, **r}
        if tipo in ("price_history", "price_history_long"):
            r = {**r, "interval": kw.get("interval", "1day"), "symbol": symbol,
                 "bars": [{**b, "open": b["close"] * 0.998, "high": b["close"] * 1.006, "low": b["close"] * 0.992,
                           "volume": 1e6 * (1 + (i % 7) / 10)} for i, b in enumerate(r["bars"])]}
        return r
