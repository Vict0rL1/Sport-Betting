"""Una sola regla para todo lo histórico: lo que se sabía, cuando se sabía.

    information_available_at <= decision_timestamp

Antes cada módulo la escribía a su manera —el backtest comparaba fechas de
filing, el replay no comparaba nada, las noticias se filtraban por «últimos 14
días» sin límite superior— y una regla escrita cinco veces acaba con cinco
interpretaciones. Aquí vive una, y todo lo que reconstruye el pasado (replay de
decisiones, expectativas frente a resultados, backtests) pregunta aquí.

## Tres respuestas, no dos

`disponible_en` devuelve True, False o **None**. None significa «no se puede
probar»: un dato sin fecha, o con una fecha que no basta para decidir. Quien
reconstruye el pasado trata None como NO disponible — un dato que no se puede
fechar no entra en una decisión histórica, porque meterlo es exactamente el
sesgo que esto evita — pero lo cuenta aparte: «excluido por fecha futura» y
«excluido por no tener fecha» son cosas distintas que hay que poder leer.

## Granularidad: un día no es un instante

EDGAR fecha los filings por DÍA, sin hora. Una decisión de las 14:35 y un 8-K
«del 12 de septiembre» que la SEC aceptó a las 21:00 caen el mismo día, y el 8-K
NO se conocía a las 14:35. Por eso:

- dato con fecha y decisión con hora, el mismo día → no se puede probar que
  fuera anterior. Solo cuenta si hay prueba de cuándo LO OBTUVO el sistema
  (`obtenido_en`, la hora de la descarga), y esa prueba es anterior.
- dato con fecha y decisión con fecha (un backtest que decide al cierre) → se
  compara por día, con `<=`: es la convención que ya usaba el backtest.
"""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Callable, Iterable

DISPONIBLE = "disponible"
FUTURO = "futuro"
DESCONOCIDO = "desconocido"


def marca(valor) -> tuple[datetime | date, bool] | None:
    """(momento, es_instante). None si no hay forma de fecharlo.

    Un `datetime` sin zona se lee como UTC —SQLite la pierde al guardar y toda
    la app escribe en UTC—; una cadena de 10 caracteres es un DÍA, no la
    medianoche de ese día: tratarla como medianoche la adelantaría.
    """
    if valor is None or valor == "":
        return None
    if isinstance(valor, datetime):
        return (valor if valor.tzinfo else valor.replace(tzinfo=timezone.utc)), True
    if isinstance(valor, date):
        return valor, False
    texto = str(valor).strip()
    try:
        if len(texto) == 10:
            return date.fromisoformat(texto), False
        dt = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)), True


def _dia(m: datetime | date) -> date:
    return m.astimezone(timezone.utc).date() if isinstance(m, datetime) else m


def disponible_en(publicado, decision, obtenido_en=None) -> bool | None:
    """¿Se podía conocer `publicado` en el momento `decision`?

    True / False / None (no se puede probar). `obtenido_en` es la hora a la que
    el sistema tuvo el dato en la mano; solo se usa para deshacer el empate de
    un dato fechado por día en el mismo día de una decisión con hora.
    """
    p, d = marca(publicado), marca(decision)
    if p is None or d is None:
        return None
    (mp, p_instante), (md, d_instante) = p, d
    if p_instante and d_instante:
        return mp <= md
    if not d_instante:
        # Decisión fechada por día (backtest al cierre): se compara por día.
        return _dia(mp) <= md
    # Dato fechado por día, decisión con hora.
    if _dia(mp) < _dia(md):
        return True
    if _dia(mp) > _dia(md):
        return False
    prueba = marca(obtenido_en)
    if prueba is not None and prueba[1]:
        return prueba[0] <= md
    return None


def estado(publicado, decision, obtenido_en=None) -> str:
    r = disponible_en(publicado, decision, obtenido_en)
    return DISPONIBLE if r else FUTURO if r is False else DESCONOCIDO


def filtrar(
    items: Iterable,
    fecha: Callable[[object], object],
    decision,
    obtenido_en: Callable[[object], object] | None = None,
) -> dict:
    """Separa lo que se podía conocer de lo que no, sin perder la cuenta.

    `fecha(item)` devuelve la marca de publicación del elemento. Lo futuro y lo
    sin fecha se devuelven aparte: quien reconstruye decide qué enseñar, pero
    nunca los mezcla con lo disponible.
    """
    salida = {"disponibles": [], "futuros": [], "sin_fecha": []}
    for item in items:
        r = disponible_en(fecha(item), decision, obtenido_en(item) if obtenido_en else None)
        clave = "disponibles" if r else "futuros" if r is False else "sin_fecha"
        salida[clave].append(item)
    return salida


def fin_del_dia(d: date) -> datetime:
    """El último instante de un día UTC. Para convertir una fecha de corte en
    una decisión con hora sin adelantarla."""
    return datetime.combine(d, time.max, tzinfo=timezone.utc)
