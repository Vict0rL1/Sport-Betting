"""Una sola forma de escribir cifras para una persona (ítem 1.7: V4, V5, V8).

Antes cada módulo formateaba a su manera: el backend con f-strings en inglés
(«31.2 %», «EPS estimado 1.12», «0.210») y el frontend en es-ES («45,5 %»), en
la misma pantalla; la regla es-ES no agrupa los números de cuatro cifras y
salía «6000,00» encima de «20.000,00» en la misma columna; y un -0,0001
redondeado se escribía «-0 %». Todo texto con cifras para el usuario pasa por
aquí, y `frontend/src/lib/formato.ts` es su gemelo exacto: los dos se prueban
contra la misma tabla de casos (`frontend/src/lib/formato.casos.json`) y tienen
que dar la misma cadena, carácter a carácter.

Reglas:
- coma decimal y punto de miles, también con cuatro cifras (6.000,00);
- espacio duro antes de «%» y de la moneda: la cifra no se parte al final de
  una línea;
- un cero negativo se escribe 0 («-0,00» no existe);
- `None`, NaN e infinito son «—»: ausente ≠ cero;
- la moneda se escribe con su código (USD, CAD, EUR), nunca con «$», que no
  distingue el dólar de EE. UU. del canadiense;
- redondeo a la mitad hacia arriba sobre la representación decimal más corta
  del número, como ICU en el navegador: con el `format` de Python, 2,675 a dos
  decimales salía 2,67 y en el frontend 2,68.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

GUION = "—"
ESPACIO_DURO = " "

MESES = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic")

# Una hora de mercado lleva la zona de su bolsa (§1.7): «16:00 ET» no es lo mismo
# que las 16:00 de quien lo lee.
ETIQUETAS_ZONA = {"America/New_York": "ET", "America/Toronto": "ET", "UTC": "UTC"}


def _finito(valor) -> bool:
    return isinstance(valor, (int, float)) and not isinstance(valor, bool) and math.isfinite(valor)


def _redondear(valor: float, decimales: int) -> Decimal:
    return Decimal(repr(float(valor))).quantize(Decimal(1).scaleb(-decimales), rounding=ROUND_HALF_UP)


def _es_es(d: Decimal, decimales: int) -> str:
    """|d| con punto de miles y coma decimal: 6000.00 → «6.000,00»."""
    return format(abs(d), f",.{decimales}f").translate(str.maketrans(",.", ".,"))


def _con_signo(d: Decimal, texto: str, signo: bool) -> str:
    if d == 0:
        return texto  # -0,0001 redondeado es 0, no «-0,00» (V8)
    if d < 0:
        return "-" + texto
    return ("+" if signo else "") + texto


def fmt_num(valor, decimales: int = 2, *, signo: bool = False) -> str:
    """6000 → «6.000,00». `signo`: «+» delante de los positivos (variaciones)."""
    if not _finito(valor):
        return GUION
    d = _redondear(valor, decimales)
    return _con_signo(d, _es_es(d, decimales), signo)


def fmt_pct(valor, decimales: int = 1, *, signo: bool = False, en_puntos: bool = False) -> str:
    """0,123 → «12,3 %». Con `en_puntos`, el valor ya viene en puntos (12,3)."""
    if not _finito(valor):
        return GUION
    return f"{fmt_num(valor if en_puntos else valor * 100, decimales, signo=signo)}{ESPACIO_DURO}%"


def fmt_dinero(valor, moneda: str | None, decimales: int = 2, *, signo: bool = False) -> str:
    """6000 USD → «6.000,00 USD». Sin moneda conocida, solo la cifra."""
    if not _finito(valor):
        return GUION
    cifra = fmt_num(valor, decimales, signo=signo)
    return f"{cifra}{ESPACIO_DURO}{moneda}" if moneda else cifra


def _corto(valor: float, max_decimales: int) -> str:
    """Hasta `max_decimales`, sin ceros a la derecha: 400,0 → «400»; 1,25 → «1,25»."""
    d = _redondear(valor, max_decimales)
    texto = _es_es(d, max_decimales)
    if max_decimales:
        texto = texto.rstrip("0").rstrip(",")
    return _con_signo(d, texto, False)


def fmt_compacto(valor, moneda: str | None = None) -> str:
    """Cifras grandes en M (millones) y mil M (miles de millones).

    Nunca «B»: en inglés es mil millones y en español un billón; el ETF de
    400 000 millones salía «400.0 B$». Por encima del billón se sigue en mil M
    («3.400 mil M»), que no se puede leer mal."""
    if not _finito(valor):
        return GUION
    a = abs(valor)
    if a >= 1e9:
        cifra = f"{_corto(valor / 1e9, 1)}{ESPACIO_DURO}mil{ESPACIO_DURO}M"
    elif a >= 1e6:
        cifra = f"{_corto(valor / 1e6, 1)}{ESPACIO_DURO}M"
    else:
        cifra = _corto(valor, 2)
    return f"{cifra}{ESPACIO_DURO}{moneda}" if moneda else cifra


def _a_fecha(valor) -> date | datetime | None:
    """Una fecha (día) o un instante con zona. Un instante sin zona es UTC: es la
    convención del backend, y SQLite la pierde al guardar."""
    if isinstance(valor, datetime):
        instante = valor
    elif isinstance(valor, date):
        return valor
    elif isinstance(valor, str) and valor:
        texto = valor.strip()
        if len(texto) == 10:
            try:
                return date.fromisoformat(texto)
            except ValueError:
                return None
        try:
            instante = datetime.fromisoformat(texto.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return instante if instante.tzinfo else instante.replace(tzinfo=timezone.utc)


def fmt_fecha(valor, *, hora: bool = False, zona: str | None = None) -> str:
    """«6 oct 2026» o, con `hora`, «12 sept 2026, 10:35 ET».

    Un día suelto («2026-10-06») no se mueve de zona: es un día del calendario.
    Un instante se pasa a `zona` (UTC si no se da) y, si es la de una bolsa, se
    rotula. Lo que no se puede leer como fecha se devuelve tal cual."""
    if valor is None or valor == "":
        return GUION
    f = _a_fecha(valor)
    if f is None:
        return str(valor)
    if isinstance(f, datetime):
        nombre = zona or "UTC"
        f = f.astimezone(ZoneInfo(nombre))
        dia = f"{f.day} {MESES[f.month - 1]} {f.year}"
        if not hora:
            return dia
        etiqueta = ETIQUETAS_ZONA.get(nombre)
        return f"{dia}, {f.hour:02d}:{f.minute:02d}" + (f"{ESPACIO_DURO}{etiqueta}" if etiqueta else "")
    return f"{f.day} {MESES[f.month - 1]} {f.year}"


def fmt_antiguedad(valor, ahora: datetime) -> str:
    """«hace 15 min». `ahora` es obligatorio: el pasado se reconstruye con su
    propio reloj (punto en el tiempo), no con el de la máquina."""
    f = _a_fecha(valor)
    if not isinstance(f, datetime):
        return GUION
    segundos = (ahora - f).total_seconds()
    minutos = math.floor(segundos / 60 + 0.5)
    # Unos segundos de desfase de reloj entre el servidor y el dato no son «el futuro».
    if minutos < 1:
        return "hace segundos"
    if minutos < 60:
        return f"hace {minutos} min"
    horas = math.floor(minutos / 60 + 0.5)
    if horas < 48:
        return f"hace {horas} h"
    return f"hace {math.floor(horas / 24 + 0.5)} días"
