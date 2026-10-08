"""Forma canónica de una salida del motor: lo que DECIDE, sin el texto.

El golden master tiene que sobrevivir a que se reescriban todas las frases de
la app (es el objetivo del plan de correcciones) y romperse en cuanto cambie
una decisión. Por eso se queda solo con:

- **códigos**: `comprar`, `puntuacion_favorable`, `NO_TRADE`, `baja`, tickers,
  fechas ISO, periodos («2026-Q3»), orígenes («analisis:14:35:00»);
- **números**, redondeados a 6 decimales (NaN e infinitos como texto, −0 como 0);
- booleanos y nulos.

Todo lo demás es texto para personas y se descarta, pero solo si su clave está
clasificada como prosa (`razones`, `nota`, `motivo`…). También se descartan las
huellas SHA-256: dependen del documento entero, texto incluido.

Hay decisiones que el motor expresa con palabras corrientes: qué tope recortó
el tamaño (`limite: "posición"`), qué dato falta (`faltan: ["puntuación"]`),
hacia dónde cambiaría (`hacia: "cualquier acción"`). Antes se descartaban por
llevar tilde o espacio, y el golden no veía si un arreglo cambiaba el tope
aplicado. Ahora sus claves están en `CODIGOS_EN_PALABRAS` y se guardan tal cual.

Y nada se descarta en silencio: una cadena que no es código, bajo una clave que
no está clasificada, es un error. Quien añada un campo nuevo al motor decide si
es prosa o decisión; el golden no lo decide por él.
"""

from __future__ import annotations

import math
import re

# Claves que siempre llevan prosa, aunque alguna vez sea una sola palabra.
PROSA = frozenset({
    "reasons", "razones", "nota", "notas", "note", "motivo", "motivos", "detalle", "condicion",
    "texto", "texto_literal", "descripcion", "aviso", "avisos", "aviso_cartera", "disparadores", "triggers",
    "resumen", "explicacion", "titulo", "title", "etiqueta", "label", "disclaimer", "mensaje", "lectura_texto",
    "nombre", "name", "body_md", "regla_texto", "por_que", "que_haria", "advertencia", "advertencias",
    "metodo", "formula", "leyenda", "fuente_texto", "nota_supuestos", "nota_geografia", "probability_note",
    "market_description", "market_name", "headline", "url", "source_url", "controles_texto",
    "nota_deuda", "interpretacion", "conclusion", "lectura_humana", "descripcion_regla",
    "aviso_general", "aviso_cobertura", "peor_ventana_nota",
})

# Claves que a veces llevan un código (que se guarda, como siempre) y a veces
# un rótulo para personas que acompaña a un código guardado aparte: el factor
# «Precio actual» es el id `frescura_precio`; la regla «Puntuación ≥ +0.35», su
# id y su resultado. Del rótulo se prescinde; del código, no.
ROTULOS = frozenset({
    "cuerpo", "detail", "factor", "regla", "regla_global", "recortes", "dato", "fuente", "origen", "unidad",
    "contexto", "criterio", "cobertura", "source",
})

# Claves cuyo valor es una decisión dicha con palabras («posición», «sin
# plusvalía», nombres de sector). Se guardan aunque lleven tildes o espacios.
CODIGOS_EN_PALABRAS = frozenset({"faltan", "hacia", "impuestos", "key", "limite", "posicion", "sector", "industria",
                                 "inclinacion"})
_PALABRAS = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 &.\-]{0,39}$")


class TextoSinClasificar(ValueError):
    """Una cadena que no es código bajo una clave que nadie ha clasificado."""

_CODIGO = re.compile(
    r"^(?:[a-z][a-z0-9_]*"                       # comprar, puntuacion_favorable
    r"|[A-Z0-9][A-Z0-9_.\-]{0,39}"               # NO_TRADE, COMPRAR_CON_EFECTIVO, AAPL, RY.TO
    r"|\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+\-Z]*)?"   # fechas e instantes ISO
    r"|\d{4}-Q[1-4]"                             # periodos
    r"|[a-z_]+:[a-z0-9_:.]+"                     # analisis:14:35:00, hoy:us_sp500
    r")$"
)
_HEX = re.compile(r"^[0-9a-f]{24,}$")


def es_codigo(s: str) -> bool:
    return bool(_CODIGO.match(s)) and not _HEX.match(s)


def _numero(x: float):
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "inf" if x > 0 else "-inf"
    r = round(x, 6)
    return 0.0 if r == 0 else r


_DESCARTE = object()


def _es_texto(v) -> bool:
    """Una clave de prosa solo se descarta si lleva texto: con datos dentro
    (la lista de disparadores de una tesis, por ejemplo) se recorre."""
    if isinstance(v, str):
        return True
    if isinstance(v, (list, tuple)):
        return all(isinstance(e, str) for e in v)
    return False


def _es_frase(s: str) -> bool:
    """Una frase hecha y derecha: la calidad de beneficios usa `limite` para
    decir el límite del método («Las partidas no recurrentes salen de…»), no
    para nombrar un tope."""
    return " " in s and s.rstrip().endswith(".")


def canon(x):
    """Forma canónica (ver el docstring del módulo)."""
    r = _canon(x, None)
    return None if r is _DESCARTE else r


def _canon(x, clave: str | None):
    if x is None or isinstance(x, bool):
        return x
    if isinstance(x, int):
        return x
    if isinstance(x, float):
        return _numero(x)
    if isinstance(x, str):
        if es_codigo(x):
            return x
        if clave in CODIGOS_EN_PALABRAS:
            if _PALABRAS.match(x):
                return x
            if _es_frase(x):
                return _DESCARTE
        if clave in PROSA or clave in ROTULOS:
            return _DESCARTE
        raise TextoSinClasificar(
            f"«{x[:60]}» bajo la clave {clave!r}: ni es un código ni la clave está clasificada. "
            "Añádela a PROSA o ROTULOS (texto para personas) o a CODIGOS_EN_PALABRAS (una decisión dicha "
            "con palabras).")
    if isinstance(x, dict):
        salida = {}
        for k in sorted(x, key=str):
            ks = str(k)
            if ks.startswith("huella") or ks.startswith("_") or ks.endswith("_sha256"):
                continue
            if ks in PROSA and _es_texto(x[k]):
                continue
            v = _canon(x[k], ks)
            if v is not _DESCARTE:
                salida[ks] = v
        return salida
    if isinstance(x, (list, tuple)):
        return [v for v in (_canon(e, clave) for e in x) if v is not _DESCARTE]
    if hasattr(x, "isoformat"):
        return x.isoformat()
    return _DESCARTE
