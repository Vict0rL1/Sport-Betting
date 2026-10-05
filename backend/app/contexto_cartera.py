"""La cartera como entrada de cálculo: pesos en moneda base y series convertidas.

La contribución al riesgo, el riesgo de añadir una idea y el coste de
oportunidad necesitan lo mismo: cada posición abierta con su peso sobre el
total (en dólares, convertido con el tipo de hoy) y su histórico de cierres EN
DÓLARES (convertido con el tipo de CADA fecha: con el de hoy, el riesgo de
divisa de una acción canadiense desaparecería). Se construye aquí una vez, con
las reglas de la cartera:

- sin precio → sin peso, fuera, nombrada; no vale cero;
- sin moneda o sin tipo de cambio → fuera, nombrada; no se supone dólar;
- varios lotes del mismo símbolo → una posición.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import datos
from app import punto_en_el_tiempo as pit
from app.analysis import fx
from app.analysis import historial as hist
from app.db.models import Instrument, Position

INDICE_MERCADO = "SPY"


def convertir_serie(serie: list[tuple[date, float]], moneda: str | None, fx_series: dict) -> list[tuple[date, float]] | None:
    """Cierres en moneda local → en dólares, con el tipo vigente en cada fecha."""
    if moneda == fx.BASE:
        return serie
    tipos = fx_series.get(moneda) or []
    if not tipos:
        return None
    fechas, valores = [f for f, _ in sorted(tipos)], [v for _, v in sorted(tipos)]
    salida = []
    for d, p in serie:
        t = hist._vigente(fechas, valores, d)
        if t:
            salida.append((d, p / t))
    return salida or None


def construir(session: Session, service, *, descargar: bool = False, ahora: datetime | None = None) -> dict:
    """{posiciones, series (en USD), sin_peso, mercado, total_usd}. Nunca lanza
    por una posición: la que falla queda fuera con su motivo."""
    from app.routers.portfolio import _cotizacion, _fx_completo, _historico_largo, _moneda_segura, _resolver_divisa

    ahora = ahora or datetime.now(timezone.utc)
    filas = session.execute(
        select(Position, Instrument).join(Instrument, Position.instrument_id == Instrument.id)
        .where(Position.closed_at.is_(None))
    ).all()
    agregadas: dict[str, dict] = {}
    for pos, inst in filas:
        if pit.disponible_en(pos.opened_at, ahora) is False:
            continue
        a = agregadas.setdefault(inst.symbol, {"symbol": inst.symbol, "nombre": inst.name, "sector": inst.sector,
                                               "industria": inst.industry, "cantidad": 0.0, "coste": 0.0,
                                               "stops": [], "abierta_desde": pos.opened_at, "instrument": inst})
        a["cantidad"] += pos.quantity
        a["coste"] += pos.quantity * pos.cost_basis
        a["stops"].append(pos.stop)
        a["abierta_desde"] = min(a["abierta_desde"], pos.opened_at)

    sin_peso, valoradas = [], []
    monedas = set()
    for a in agregadas.values():
        precio, moneda, estado = _cotizacion(service, a["symbol"])
        moneda = _moneda_segura(_resolver_divisa(session, service, a["instrument"], moneda))
        a.update(precio=datos.precio(precio), moneda=moneda, precio_estado=estado.get("estado"))
        if a["precio"] is None:
            sin_peso.append({"symbol": a["symbol"], "motivo": "sin precio: fuera de los pesos (no vale cero)"})
            continue
        if moneda is None:
            sin_peso.append({"symbol": a["symbol"], "motivo": "moneda desconocida: no se supone dólar"})
            continue
        monedas.add(moneda)
        valoradas.append(a)

    tipos, fx_series, _ = _fx_completo(service, monedas)
    for a in valoradas:
        por_usd = 1.0 if a["moneda"] == fx.BASE else datos.numero((tipos.get(a["moneda"]) or {}).get("por_usd"))
        a["valor_usd"] = a["precio"] * a["cantidad"] / por_usd if por_usd else None
        if a["valor_usd"] is None:
            sin_peso.append({"symbol": a["symbol"], "motivo": f"sin tipo de cambio para {a['moneda']}"})
    valoradas = [a for a in valoradas if a.get("valor_usd")]
    total = sum(a["valor_usd"] for a in valoradas)

    simbolos = [a["symbol"] for a in valoradas]
    crudas, fallos = _historico_largo(service, simbolos + [INDICE_MERCADO], descargar)
    series = {}
    for a in valoradas:
        s = crudas.get(a["symbol"])
        conv = convertir_serie(s, a["moneda"], fx_series) if s else None
        if conv:
            series[a["symbol"]] = [(d, p) for d, p in conv if pit.disponible_en(d, ahora.date()) is not False]

    posiciones = [
        {
            "symbol": a["symbol"], "nombre": a["nombre"], "sector": a["sector"], "industria": a["industria"],
            "moneda": a["moneda"], "peso": a["valor_usd"] / total if total else None,
            "valor_usd": round(a["valor_usd"], 2), "cantidad": a["cantidad"],
            "coste_medio": a["coste"] / a["cantidad"] if a["cantidad"] else None,
            "precio": a["precio"], "precio_estado": a["precio_estado"],
            "stop": max(a["stops"]) if a["stops"] and all(s is not None for s in a["stops"]) else None,
            "abierta_desde": a["abierta_desde"].isoformat() if a["abierta_desde"] else None,
            **({"motivo": f"sin histórico: {fallos.get(a['symbol'])}"} if a["symbol"] not in series else {}),
        }
        for a in valoradas
    ] + [{"symbol": x["symbol"], "peso": None, "motivo": x["motivo"]} for x in sin_peso]
    return {
        "posiciones": posiciones,
        "series": series,
        "mercado": crudas.get(INDICE_MERCADO),
        "total_usd": round(total, 2) if total else None,
        "sin_peso": sin_peso,
        "fx_series": fx_series,
    }
