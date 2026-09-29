"""Lo que entra de fuera se comprueba aquí, antes de que nadie lo crea.

Hasta ahora no había frontera. `providers/base.py` documenta la forma de cada
payload —«-> {symbol, price, change, ..., currency}»— pero era documentación,
no un contrato: `DataRouter.fetch()` devolvía lo que el proveedor hubiera
puesto, y `CacheStore.set()` lo persistía sin mirarlo. Un `{"price": None}` o
un `{"price": NaN}` entraba, se guardaba, y se servía durante todo el TTL.

Eso es lo que convertía un fallo de una API en una decisión de inversión: los
P0-1 a P0-4 de la auditoría son todos el mismo dato corrupto viajando sin que
nadie lo parara, y los saneadores de `datos.py` los cazan uno a uno aguas abajo
— pero cazarlos aguas abajo es parchear cada desembocadura del río.

## Dos decisiones que definen el comportamiento

**Un payload inválido es un fallo del proveedor, no un dato.** Por eso la
validación vive dentro del router, entre `provider.fetch()` y el `return`: si
lo que llega no sirve, se trata como si la llamada hubiera fallado y se pasa a
la siguiente fuente. Antes, el primer proveedor con una respuesta rota ganaba.

**Lo inválido no se cachea.** Guardar un precio corrupto lo convierte en la
respuesta oficial durante horas, y el reintento que lo arreglaría no llega a
hacerse porque la caché contesta antes.

## Lo que NO hace

No comprueba que el precio sea *correcto* — eso no se puede saber desde aquí.
Comprueba que sea *utilizable*: que exista, que sea finito y que esté en un
rango donde un precio puede estar. Detectar un 150,00 que en realidad era
151,20 no es trabajo de esta capa ni de ninguna otra de esta app.
"""

from __future__ import annotations

from app import datos


class PayloadInvalido(Exception):
    """Lo que llegó del proveedor no se puede usar. El motivo va en el mensaje."""


# --- Validadores por tipo de dato ----------------------------------------
#
# Cada uno devuelve el payload (posiblemente saneado) o lanza PayloadInvalido.
# Sanear y rechazar son cosas distintas y la línea está en si lo que falta es
# el dato principal: una barra suelta corrupta se tira y se sigue; un precio
# corrupto en una cotización no deja nada que servir.


def _quote(payload: dict) -> dict:
    precio = datos.precio(payload.get("price"))
    if precio is None:
        raise PayloadInvalido(
            f"cotización sin precio utilizable (llegó {payload.get('price')!r}): "
            "ni None, ni NaN, ni cero, ni negativo sirven como precio"
        )
    saneado = {**payload, "price": precio}

    # Los acompañantes se sanean pero no tumban la respuesta: sin `change` se
    # puede vivir, sin `price` no.
    for campo in ("change", "change_pct", "prev_close"):
        if campo in saneado:
            saneado[campo] = datos.numero(saneado[campo])

    moneda = saneado.get("currency")
    if isinstance(moneda, str) and moneda.strip():
        saneado["currency"] = moneda.strip().upper()
    elif moneda is not None:
        saneado["currency"] = None
    return saneado


def _barras(payload: dict) -> dict:
    barras = payload.get("bars")
    if not isinstance(barras, list) or not barras:
        raise PayloadInvalido("histórico sin barras")

    limpias, tiradas = [], 0
    for b in barras:
        if not isinstance(b, dict):
            tiradas += 1
            continue
        cierre = datos.precio(b.get("close"))
        if cierre is None or not b.get("ts"):
            tiradas += 1
            continue
        fila = {**b, "close": cierre}
        for campo in ("open", "high", "low"):
            if campo in fila:
                fila[campo] = datos.precio(fila[campo])
        if "volume" in fila:
            # El volumen SÍ puede ser cero: un día sin negociación es un hecho.
            v = datos.numero(fila["volume"])
            fila["volume"] = v if v is not None and v >= 0 else None
        limpias.append(fila)

    if not limpias:
        raise PayloadInvalido(
            f"histórico con {len(barras)} barra(s), ninguna utilizable"
        )

    salida = {**payload, "bars": limpias}
    if tiradas:
        # Se dice cuántas se cayeron. Un histórico al que le faltan barras sin
        # avisar se lee como «esta acción no cotizó esos días».
        salida["barras_descartadas"] = tiradas
    return salida


def _fundamentales(payload: dict) -> dict:
    """Aquí casi todo puede faltar legítimamente, así que solo se sanea.

    Una empresa sin dividendo no tiene `dividend_yield`, y eso es un hecho, no
    una carencia. Lo que sí se hace es no dejar pasar NaN disfrazado de número:
    un NaN en `pe_ttm` atraviesa un filtro del screener sin que nada lo señale.
    """
    metricas = payload.get("metrics")
    if not isinstance(metricas, dict):
        return payload
    return {**payload, "metrics": {k: datos.numero(v) for k, v in metricas.items()}}


def _macro(payload: dict) -> dict:
    puntos = payload.get("points")
    if not isinstance(puntos, list):
        raise PayloadInvalido("serie macro sin puntos")
    # Los huecos de FRED (`.`) son normales y se dejan pasar como None: quien
    # consume la serie ya sabe saltárselos. Lo que se limpia es el NaN.
    return {
        **payload,
        "points": [
            {**p, "value": datos.numero(p.get("value"))}
            for p in puntos
            if isinstance(p, dict)
        ],
    }


VALIDADORES = {
    "quote": _quote,
    "price_history": _barras,
    "price_history_long": _barras,
    "fundamentals": _fundamentales,
    "macro": _macro,
}


def validar(data_type: str, payload: dict) -> dict:
    """El payload saneado, o `PayloadInvalido` si no hay nada que salvar.

    Un tipo sin validador pasa tal cual: noticias, filings o perfiles no
    alimentan ningún cálculo de riesgo, y validar por validar añade un sitio
    donde equivocarse sin añadir seguridad.
    """
    if not isinstance(payload, dict):
        raise PayloadInvalido(f"el proveedor devolvió {type(payload).__name__}, no un dict")
    validador = VALIDADORES.get(data_type)
    return validador(payload) if validador else payload
