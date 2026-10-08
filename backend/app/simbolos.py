"""Un ticker en la frontera de la API: una sola definición para toda la app.

Antes la misma expresión regular estaba copiada a mano en nueve routers, y
donde nadie la copió no había validación: `/api/news?symbol=` y
`/api/etfs/recomendar?symbols=` mandaban al proveedor lo que llegara, y otras
cuatro rutas filtraban la base con cualquier cosa. Un ticker es letras, números,
punto y guion, 12 caracteres como mucho («AAPL», «BRK-B», «RY.TO»,
«BTC-USD»); cualquier otra cosa es un 422, nunca una llamada a un proveedor ni
una ruta de fichero.

Los tipos de aquí declaran el patrón en el esquema OpenAPI, así que un test
puede recorrer TODAS las rutas y exigir que cada parámetro con símbolo lo lleve
(`tests/test_seguridad.py`). El mensaje de error en español lo pone el
manejador de 422 de `main.py`.

Y normalizan, para que la validación común no cambie lo que ya funcionaba
(la revisión de la Fase 0 vio que sí lo cambiaba): el ticker llega en
mayúsculas; un `?symbol=` vacío sigue siendo «sin filtro»; los espacios de los
extremos en la query y en el cuerpo se recortan, como antes; y «AAPL, MSFT» en
una lista vale igual que «AAPL,MSFT».
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import HTTPException, Path, Query
from pydantic import BeforeValidator, StringConstraints

# Empieza por letra o número: «..» o «-» cumplían el patrón anterior y acababan
# como «símbolo» de un evento y, potencialmente, en el nombre de un fichero.
PATRON_SIMBOLO = r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,11}$"
# Varios separados por comas, en una sola query («AAPL,MSFT,KO»).
PATRON_LISTA_SIMBOLOS = r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,11}(,[A-Za-z0-9][A-Za-z0-9.\-]{0,11})*$"
SIMBOLO_RE = re.compile(PATRON_SIMBOLO)
DESCRIPCION = "Ticker: letras, números, «.» y «-»; 12 caracteres como mucho."


def _vacio_es_ninguno(valor):
    """«?symbol=» vacío o con espacios era «sin filtro» antes de la validación
    común, y lo sigue siendo: un parámetro opcional vacío no es un ticker malo."""
    if isinstance(valor, str):
        valor = valor.strip()
        return valor or None
    return valor


def _lista_sin_espacios(valor):
    """«AAPL, MSFT» → «AAPL,MSFT»: los espacios junto a las comas siempre se aceptaron."""
    return re.sub(r"\s*,\s*", ",", valor.strip()) if isinstance(valor, str) else valor


# El ticker, ya en mayúsculas. En la query y en un cuerpo JSON se perdonan los
# espacios de los extremos (siempre se recortaron); en la ruta, no.
_Ticker = Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=PATRON_SIMBOLO)]
_TickerRuta = Annotated[str, StringConstraints(to_upper=True, pattern=PATRON_SIMBOLO)]
_Lista = Annotated[str, StringConstraints(to_upper=True, pattern=PATRON_LISTA_SIMBOLOS)]

# En la ruta (/api/stocks/{symbol}/…), en la query (?symbol=) y en un cuerpo JSON.
# El patrón va en el tipo de dentro: así llega al esquema OpenAPI (y a la guarda
# de `tests/test_seguridad.py`) y se comprueba DESPUÉS de convertir el vacío en
# `None`, no antes.
SimboloRuta = Annotated[_TickerRuta, Path(description=DESCRIPCION)]
SimboloQuery = Annotated[_Ticker | None, BeforeValidator(_vacio_es_ninguno), Query(description=DESCRIPCION)]
ListaSimbolosQuery = Annotated[_Lista, BeforeValidator(_lista_sin_espacios),
                               Query(description="Tickers separados por comas. " + DESCRIPCION)]
Simbolo = _Ticker
SimboloOpcional = Annotated[_Ticker | None, BeforeValidator(_vacio_es_ninguno)]


def mensaje_invalido(valor) -> str:
    return f"Símbolo inválido: «{str(valor)[:24]}». {DESCRIPCION}"


def validar_simbolo(symbol: str) -> str:
    """Para lo que no pasa por los tipos de arriba. Devuelve el ticker en mayúsculas.

    Es la única comprobación a mano de toda la app: los routers la llaman en vez
    de tener cada uno su copia de la expresión regular (había nueve)."""
    if not isinstance(symbol, str) or not SIMBOLO_RE.match(symbol.strip()):
        raise HTTPException(status_code=422, detail=mensaje_invalido(symbol))
    return symbol.strip().upper()
