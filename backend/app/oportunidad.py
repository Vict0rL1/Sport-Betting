"""El coste de oportunidad con datos reales: efectivo, cartera y lecturas congeladas.

El motor (`analysis/coste_de_oportunidad.py`) es puro. Aquí se le dan sus
entradas, sin inventar ninguna:

- el **efectivo** que el usuario anotó (la última anotación de cada moneda,
  convertida); sin anotación, desconocido;
- el **tamaño máximo** de la idea, del dimensionador de siempre, con la cartera
  abierta y la confianza de la idea como entrada declarada;
- de cada **posición**: su última lectura CONGELADA (acción, tesis, valoración,
  confianza) —no se reanaliza toda la cartera cada vez—, su contribución al
  riesgo, su correlación con la idea, su plusvalía y cuánto lleva en cartera.
"""

from __future__ import annotations

from datetime import datetime

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import datos
from app import punto_en_el_tiempo as pit
from app import snapshots as sn
from app.analysis import coste_de_oportunidad as motor
from app.analysis import portfolio_risk
from app.analysis.rule_backtest import costes_por_lado
from app.analysis.sizing import MAX_POR_POSICION_PCT, dimensionar
from app.db.models import CashBalance, DecisionSnapshot


def efectivo_usd(session: Session, ctx: dict, ahora: datetime) -> dict:
    """{usd, detalle}. Una moneda sin tipo de cambio deja el total DESCONOCIDO."""
    ultimas = session.execute(
        select(CashBalance).where(
            CashBalance.id.in_(select(func.max(CashBalance.id)).group_by(CashBalance.moneda))
        )
    ).scalars().all()
    ultimas = [c for c in ultimas if pit.disponible_en(c.as_of, ahora) is not False]
    if not ultimas:
        return {"usd": None, "estado": "desconocido", "motivo": "no hay efectivo anotado"}
    total, detalle = 0.0, []
    for c in ultimas:
        if c.moneda == "USD":
            usd = c.importe
        else:
            serie = sorted(ctx.get("fx_series", {}).get(c.moneda) or [])
            tipo = serie[-1][1] if serie else None
            if not tipo:
                return {"usd": None, "estado": "desconocido",
                        "motivo": f"efectivo en {c.moneda} sin tipo de cambio: no se supone 1:1"}
            usd = c.importe / tipo
        total += usd
        detalle.append({"moneda": c.moneda, "importe": c.importe, "usd": round(usd, 2),
                        "as_of": sn.iso_utc(c.as_of)})
    return {"usd": round(total, 2), "estado": "valido", "detalle": detalle}


def _lectura_congelada(session: Session, symbol: str, ahora: datetime) -> dict:
    """La última lectura de análisis de una posición, tal como se congeló."""
    snap = session.execute(
        select(DecisionSnapshot)
        .where(DecisionSnapshot.symbol == symbol, DecisionSnapshot.origen.like(f"{sn.ORIGEN_ANALISIS}:%"))
        .order_by(DecisionSnapshot.creado_en.desc(), DecisionSnapshot.id.desc())
    ).scalars().first()
    if snap is None or pit.disponible_en(snap.creado_en, ahora) is False:
        return {}
    a = (snap.contexto or {}).get("analisis") or {}
    return {
        "accion": snap.accion,
        "tesis": (a.get("tesis") or {}).get("estado"),
        "valoracion": valoracion_de(a),
        "confianza": (a.get("confianza") or {}).get("nivel"),
        "lectura_de": sn.iso_utc(snap.creado_en),
    }


def valoracion_de(analisis: dict) -> str | None:
    inv = ((analisis.get("valoracion") or {}).get("dcf_inverso") or {}).get("crecimiento_implicito")
    crec = (analisis.get("fundamentales") or {}).get("crecimiento_5a") or {}
    historico = crec.get("fcf_cagr") if crec.get("fcf_cagr") is not None else crec.get("revenue_cagr")
    return motor.lectura_de_valoracion(inv, historico)


def _pct(fraccion) -> float | None:
    v = datos.numero(fraccion)
    return v * 100 if v is not None else None


def _correlacion(a: list, b: list) -> float | None:
    da, db = dict(a), dict(b)
    fechas = sorted(set(da) & set(db))
    if len(fechas) < portfolio_risk.MIN_OBSERVACIONES + 1:
        return None
    ra = np.diff([da[d] for d in fechas]) / np.array([da[d] for d in fechas[:-1]])
    rb = np.diff([db[d] for d in fechas]) / np.array([db[d] for d in fechas[:-1]])
    if ra.std() == 0 or rb.std() == 0:
        return None
    return round(float(np.corrcoef(ra, rb)[0, 1]), 3)


def evaluar(
    session: Session,
    analisis: dict,
    ctx: dict,
    serie_candidata: list | None,
    ahora: datetime,
    tipo_impositivo: float | None = None,
) -> dict:
    symbol = analisis["symbol"]
    decision = analisis.get("decision") or {}
    efectivo = efectivo_usd(session, ctx, ahora)
    invertido = ctx.get("total_usd") or 0.0
    capital = invertido + (efectivo["usd"] or 0.0)

    posiciones = [p for p in ctx["posiciones"] if p.get("peso") is not None and p["symbol"] != symbol]
    # Con el efectivo conocido, los pesos son sobre el capital TOTAL. Sin él,
    # sobre lo invertido: pesos más altos, topes más estrictos — el error va
    # hacia el lado prudente y se dice.
    for p in posiciones:
        p["peso_capital"] = p["valor_usd"] / capital if capital else None

    contrib = portfolio_risk.contribucion_al_riesgo(posiciones, ctx["series"], mercado=ctx.get("mercado"))
    por_contrib = {x["symbol"]: x for x in contrib.get("posiciones") or []}

    vol_anual = None
    vol_d = datos.numero((analisis.get("mercado") or {}).get("vol_diaria_pct"))
    if vol_d is not None:
        vol_anual = vol_d * (252 ** 0.5)
    retornos = {}
    for s, serie in list(ctx["series"].items()) + ([(symbol, serie_candidata)] if serie_candidata else []):
        precios = [v for _, v in sorted(serie)][-253:]
        retornos[s] = [precios[i] / precios[i - 1] - 1 for i in range(1, len(precios)) if precios[i - 1]]
    tamano = None
    peso_bruto = ((decision.get("levels") or {}).get("peso_bruto_pct"))
    sizing = None
    if decision.get("action") == "comprar" and peso_bruto:
        sizing = dimensionar(
            [{"symbol": symbol, "sector": analisis.get("sector"), "peso_bruto_pct": peso_bruto,
              "vol_anual_pct": vol_anual, "confianza": (analisis.get("confianza") or {}).get("nivel")}],
            retornos=retornos,
            cartera=[{"symbol": p["symbol"], "sector": p.get("sector"),
                      "peso_pct": (p["peso_capital"] if efectivo["usd"] is not None else p["peso"]) * 100,
                      "vol_anual_pct": _pct((por_contrib.get(p["symbol"]) or {}).get("volatilidad"))}
                     for p in posiciones],
        )
        tamano = (sizing["pesos"].get(symbol) or 0.0) / 100

    candidata = {
        "symbol": symbol, "accion": decision.get("action"),
        "tesis": (analisis.get("tesis") or {}).get("estado"),
        "valoracion": valoracion_de(analisis),
        "confianza": (analisis.get("confianza") or {}).get("nivel"),
        "riesgo_por_peso": (analisis.get("riesgo") or {}).get("riesgo_por_peso"),
        "escenarios": decision.get("escenarios"),
    }
    comparables = []
    for p in posiciones:
        lectura = _lectura_congelada(session, p["symbol"], ahora)
        c = por_contrib.get(p["symbol"]) or {}
        abierta = pit.marca(p.get("abierta_desde"))
        comparables.append({
            "symbol": p["symbol"], "peso": p["peso_capital"] if efectivo["usd"] is not None else p["peso"],
            "precio": p.get("precio"), "coste_medio": p.get("coste_medio"),
            "contribucion": c.get("contribucion"), "riesgo_por_peso": c.get("riesgo_por_peso"),
            "correlacion_con_candidata": _correlacion(ctx["series"].get(p["symbol"]) or [], serie_candidata or []),
            "dias_en_cartera": (ahora - abierta[0]).days if abierta and abierta[1] else None,
            **lectura,
        })
    moneda_c = ((analisis.get("mercado") or {}).get("precio") or {}).get("moneda")
    resultado = motor.evaluar(
        candidata, comparables,
        tamano_maximo=tamano,
        efectivo=(efectivo["usd"] / capital) if efectivo["usd"] is not None and capital else None,
        coste_por_lado_pct=costes_por_lado(con_divisa=moneda_c not in (None, "USD")),
        tipo_impositivo=tipo_impositivo,
        max_posicion=MAX_POR_POSICION_PCT / 100,
        recortes=(sizing or {}).get("recortes"),
    )
    resultado["efectivo"] = efectivo
    resultado["sizing"] = {k: (sizing or {}).get(k) for k in ("controles", "recortes", "todos_los_limites_aplicados")}
    resultado["impuestos"] = ({"tipo": tipo_impositivo} if tipo_impositivo is not None
                              else {"tipo": None, "nota": "tipo impositivo no indicado: los impuestos son DESCONOCIDOS, no cero"})
    resultado["huella"] = f"{resultado['veredicto']['accion']}:{resultado['veredicto'].get('revisar')}"
    return resultado
