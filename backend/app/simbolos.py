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
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import HTTPException, Path, Query
from pydantic import StringConstraints

# Empieza por letra o número: «..» o «-» cumplían el patrón anterior y acababan
# como «símbolo» de un evento y, potencialmente, en el nombre de un fichero.
PATRON_SIMBOLO = r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,11}$"
# Varios separados por comas, en una sola query («AAPL,MSFT,KO»).
PATRON_LISTA_SIMBOLOS = r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,11}(,[A-Za-z0-9][A-Za-z0-9.\-]{0,11})*$"
SIMBOLO_RE = re.compile(PATRON_SIMBOLO)
DESCRIPCION = "Ticker: letras, números, «.» y «-»; 12 caracteres como mucho."

# En la ruta (/api/stocks/{symbol}/…), en la query (?symbol=) y en un cuerpo JSON.
SimboloRuta = Annotated[str, Path(pattern=PATRON_SIMBOLO, description=DESCRIPCION)]
SimboloQuery = Annotated[str | None, Query(pattern=PATRON_SIMBOLO, description=DESCRIPCION)]
ListaSimbolosQuery = Annotated[str, Query(pattern=PATRON_LISTA_SIMBOLOS,
                                          description="Tickers separados por comas. " + DESCRIPCION)]
Simbolo = Annotated[str, StringConstraints(pattern=PATRON_SIMBOLO)]


def mensaje_invalido(valor) -> str:
    return f"Símbolo inválido: «{str(valor)[:24]}». {DESCRIPCION}"


def validar_simbolo(symbol: str) -> str:
    """Para lo que no pasa por los tipos de arriba. Devuelve el ticker en mayúsculas."""
    if not isinstance(symbol, str) or not SIMBOLO_RE.match(symbol):
        raise HTTPException(status_code=422, detail=mensaje_invalido(symbol))
    return symbol.upper()
