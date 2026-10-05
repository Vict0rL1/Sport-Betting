"""El análisis de UNA empresa, tal como el sistema lo ve ahora, listo para congelar.

Es la pieza que hacen falta para contestar tres de las cuatro preguntas de esta
fase: «¿qué cambió desde la última vez?», «¿por qué el sistema decidió esto?» y
«¿qué sabía el sistema aquel día?». Las tres exigen lo mismo: un documento con
TODO lo que entró en la decisión, cada cifra con su fuente y su fecha, que se
pueda guardar y comparar.

No calcula nada nuevo. Reúne lo que la app ya calcula —el precio y su estado,
los estados financieros de EDGAR con su linaje, el DCF inverso, la tesis y sus
puntos de invalidación, la señal y la decisión del motor— en una forma fija y
versionada (`ESQUEMA`). Si una pieza falla, su sección queda en `desconocido` o
`error` con el motivo, y el resto sigue: un análisis incompleto que lo dice es
útil; uno que rellena huecos no lo es.

Tres reglas:

1. **Cero LLM.** Todo lo que hay aquí es determinista. Si algún día entra
   contenido generado por IA, irá marcado (`generado_por: "ia"`) y fuera de la
   huella material.
2. **Nada sin marca de tiempo.** Cada bloque dice cuándo se publicó lo que
   contiene (`publicado`) y cuándo lo obtuvo el sistema (`obtenido_en`). Con
   eso, `punto_en_el_tiempo` puede comprobar después que nada era posterior.
3. **Nada se descarga de más.** Las noticias y la señal salen de lo que ya hay;
   lo que no está, no está, y se dice.
"""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta, timezone

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import datos
from app import punto_en_el_tiempo as pit
from app.analysis import confianza, thesis_watch
from app.analysis.decision import decide
from app.analysis.fundamentals import derive_ratio_series, free_cash_flow, growth_summary, total_debt
from app.analysis.reverse_dcf import curva_de_crecimiento_implicito
from app.analysis.signal import FAVORABLE_MIN, UNFAVORABLE_MAX
from app.db.models import Instrument, Position, Thesis, ThesisTrigger
from app.providers.base import DataNotFoundError
from app.providers.router import AllProvidersFailedError
from app.registro import log

# Versión de la FORMA del documento. Cambia si cambian sus claves; dos
# análisis con esquemas distintos no se comparan como si fueran lo mismo.
ESQUEMA = 2

# Supuestos del DCF inverso que se congelan con el análisis. Son los del
# escenario base de la pestaña de valoración: el crecimiento implícito no es un
# dato de la empresa, es una función de estos supuestos, y por eso viajan.
DESCUENTO_BASE = 0.09
TERMINAL_BASE = 0.025
ANOS_DCF = 5

DIAS_RESULTADOS = 7     # «presenta resultados pronto»: la misma ventana que /today
DIAS_NOTICIAS = 14
MAX_NOTICIAS = 10
MAX_CUERPO_TESIS = 4000

VALIDO, DESCONOCIDO, VIEJO, ERROR = "valido", "desconocido", "viejo", "error"


# --- Utilidades ---------------------------------------------------------------


def _iso(valor) -> str | None:
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return (valor if valor.tzinfo else valor.replace(tzinfo=timezone.utc)).isoformat()
    return str(valor)


def _traer(service, tipo: str, **kw) -> tuple[dict | None, str | None]:
    """(payload, motivo del fallo). Nunca lanza: una sección rota no tumba el resto."""
    try:
        return service.get(tipo, **kw), None
    except (DataNotFoundError, AllProvidersFailedError) as exc:
        return None, str(exc)[:200]
    except Exception as exc:  # noqa: BLE001 — se aísla por sección y se registra
        log("dato").exception("análisis: fallo inesperado al pedir %s", tipo)
        return None, f"{type(exc).__name__}: {exc}"[:200]


def _partida(periodo: dict, campo: str, obtenido_en: str | None) -> dict:
    """Un número de los estados financieros con su linaje completo."""
    linaje = (periodo.get("fuentes") or {}).get(campo) or {}
    return {
        "valor": datos.numero(periodo.get(campo)),
        "fuente": "edgar",
        "etiqueta": linaje.get("etiqueta"),
        "formulario": linaje.get("formulario"),
        "accn": linaje.get("accn"),
        "publicado": linaje.get("presentado") or periodo.get("filed_at"),
        "periodo_fin": linaje.get("fin") or periodo.get("end_date"),
        "obtenido_en": obtenido_en,
        **({"derivado": linaje["derivado"]} if linaje.get("derivado") else {}),
    }


def _metrica(valor, unidad: str, metodo: str, entradas: dict) -> dict:
    """Una métrica DERIVADA: nunca sin sus entradas. Si falta una, es None."""
    return {
        "valor": None if valor is None else round(valor, 6),
        "unidad": unidad,
        "metodo": metodo,
        "entradas": entradas,
        "estado": VALIDO if valor is not None else DESCONOCIDO,
    }


def _cociente(a: dict, b: dict) -> float | None:
    va, vb = a.get("valor"), b.get("valor")
    if va is None or vb is None or vb == 0:
        return None
    return va / vb


def _crecimiento(nuevo: dict, viejo: dict) -> float | None:
    vn, vv = nuevo.get("valor"), viejo.get("valor")
    if vn is None or vv is None or vv <= 0:
        # Crecer «desde» cero o desde negativo no es un porcentaje: es otra cosa.
        return None
    return vn / vv - 1


# --- Secciones ----------------------------------------------------------------


def seccion_mercado(service, symbol: str, ahora: datetime) -> tuple[dict, dict]:
    """(sección de mercado, bloque de precio para el motor)."""
    from app.providers.yfinance_provider import _price_summary

    quote, fallo_q = _traer(service, "quote", symbol=symbol)
    historia, fallo_h = _traer(service, "price_history", symbol=symbol, interval="1day", outputsize=252)
    barras = [b for b in (historia or {}).get("bars") or [] if datos.precio(b.get("close")) is not None]
    # Solo el pasado: una barra fechada después del análisis no existe todavía.
    barras = [b for b in barras if pit.disponible_en(str(b.get("ts"))[:10], ahora.date()) is not False]
    resumen = _price_summary(pd.Series([float(b["close"]) for b in barras], dtype="float64")) if barras else None

    if quote is not None and pit.disponible_en(quote.get("as_of"), ahora) is False:
        # Una cotización fechada DESPUÉS del análisis (un análisis a una fecha
        # pasada, o un reloj adelantado) es información futura: fuera.
        quote, fallo_q = None, "cotización posterior al momento del análisis"
    precio = datos.precio((quote or {}).get("price"))
    estado = (quote or {}).get("estado", VALIDO) if precio is not None else DESCONOCIDO
    antiguedad = (quote or {}).get("antiguedad_segundos")
    fuente, publicado = (quote or {}).get("source"), (quote or {}).get("as_of")
    if precio is None and resumen:
        # Sin cotización, el último cierre: es un precio real con fecha, pero
        # viejo. El motor lo trata como tal (no compra sobre él).
        ultimo = barras[-1]
        precio, estado = resumen["last"], VIEJO
        fuente, publicado = (historia or {}).get("source"), str(ultimo.get("ts"))[:10]
        try:
            antiguedad = (ahora - pit.fin_del_dia(date.fromisoformat(publicado))).total_seconds()
            antiguedad = max(antiguedad, 0)
        except ValueError:
            antiguedad = None

    seccion = {
        "estado": estado,
        "precio": {
            "valor": precio,
            "moneda": (quote or {}).get("currency"),
            "fuente": fuente,
            "publicado": publicado,
            "obtenido_en": (quote or {}).get("as_of"),
            "estado": estado,
            "antiguedad_segundos": antiguedad,
            "motivo": None if precio is not None else (fallo_q or "sin cotización"),
        },
        "historico": {
            "fuente": (historia or {}).get("source"),
            "sesiones": len(barras),
            "hasta": str(barras[-1].get("ts"))[:10] if barras else None,
            "ultimo_cierre": (resumen or {}).get("last"),
            "obtenido_en": (historia or {}).get("as_of"),
            "motivo": None if barras else (fallo_h or "sin histórico"),
        },
        "sma200": (resumen or {}).get("sma200"),
        "vol_diaria_pct": (resumen or {}).get("daily_vol_pct"),
        "drawdown_pct": (resumen or {}).get("drawdown_pct"),
        "cambio_pct": (quote or {}).get("change_pct"),
    }
    bloque = {
        "last": precio,
        "sma200": seccion["sma200"],
        "above_sma200": (resumen or {}).get("above_sma200"),
        "daily_vol_pct": seccion["vol_diaria_pct"],
        "drawdown_pct": seccion["drawdown_pct"],
        "estado": estado,
        "antiguedad_segundos": antiguedad,
        "source": fuente,
        "as_of": publicado,
    }
    return seccion, bloque


def seccion_fundamentales(financials: dict | None, fallo: str | None, ahora: datetime | None = None) -> dict:
    """El último ejercicio y el último trimestre, cada cifra con su linaje.

    Solo lo PUBLICADO en `ahora`: un ejercicio presentado después no existía.
    """
    obtenido = (financials or {}).get("as_of")
    periodos = (financials or {}).get("periods") or []
    trimestres = (financials or {}).get("quarters") or []
    excluidos = 0
    if ahora is not None:
        def publicado(p):
            return pit.disponible_en(p.get("filed_at"), ahora, obtenido) is not False
        antes = len(periodos) + len(trimestres)
        periodos = [p for p in periodos if publicado(p)]
        trimestres = [q for q in trimestres if publicado(q)]
        excluidos = antes - len(periodos) - len(trimestres)
    if not periodos:
        return {"estado": DESCONOCIDO, "motivo": fallo or "sin estados financieros publicados", "metricas": {}}
    ultimo = periodos[-1]
    previo = periodos[-2] if len(periodos) >= 2 else {}

    p = {c: _partida(ultimo, c, obtenido) for c in (
        "revenue", "gross_profit", "operating_income", "net_income", "cfo", "capex",
        "eps_diluted", "shares_outstanding", "cash", "long_term_debt", "short_term_debt",
    )}
    a = {c: _partida(previo, c, obtenido) for c in ("revenue", "cfo", "capex")} if previo else {}

    fcf = free_cash_flow(ultimo)
    fcf_prev = free_cash_flow(previo) if previo else None
    m = {
        "revenue": {**p["revenue"], "unidad": "USD"},
        "revenue_growth": _metrica(
            _crecimiento(p["revenue"], a.get("revenue", {})), "fracción",
            "ingresos del ejercicio / ingresos del anterior − 1",
            {"ingresos": p["revenue"], "ingresos_anterior": a.get("revenue")},
        ),
        "gross_margin": _metrica(_cociente(p["gross_profit"], p["revenue"]), "fracción",
                                 "beneficio bruto / ingresos",
                                 {"beneficio_bruto": p["gross_profit"], "ingresos": p["revenue"]}),
        "operating_margin": _metrica(_cociente(p["operating_income"], p["revenue"]), "fracción",
                                     "resultado operativo / ingresos",
                                     {"resultado_operativo": p["operating_income"], "ingresos": p["revenue"]}),
        "net_margin": _metrica(_cociente(p["net_income"], p["revenue"]), "fracción",
                               "beneficio neto / ingresos",
                               {"beneficio_neto": p["net_income"], "ingresos": p["revenue"]}),
        "fcf": _metrica(fcf, "USD", "flujo operativo − capex",
                        {"cfo": p["cfo"], "capex": p["capex"]}),
        "fcf_growth": _metrica(
            (fcf / fcf_prev - 1) if fcf is not None and fcf_prev and fcf_prev > 0 else None,
            "fracción", "FCF del ejercicio / FCF del anterior − 1",
            {"cfo": p["cfo"], "capex": p["capex"], "cfo_anterior": a.get("cfo"), "capex_anterior": a.get("capex")},
        ),
        "eps_diluted": {**p["eps_diluted"], "unidad": "USD/acción"},
    }
    deuda = total_debt(ultimo)
    m["deuda_neta"] = _metrica(
        (deuda - (datos.numero(ultimo.get("cash")) or 0.0)) if deuda is not None else None,
        "USD", "deuda a largo + a corto − caja (caja ausente = 0: error en dirección prudente)",
        {"deuda_largo": p["long_term_debt"], "deuda_corto": p["short_term_debt"], "caja": p["cash"]},
    )

    trimestre = _ultimo_trimestre(trimestres, obtenido)
    return {
        "estado": VALIDO,
        "excluidos_por_fecha": excluidos,
        "ejercicios_disponibles": len(periodos),
        "fuente": (financials or {}).get("source", "edgar"),
        "ejercicio": ultimo.get("fiscal_year"),
        "periodo_fin": ultimo.get("end_date"),
        "publicado": ultimo.get("filed_at"),
        "obtenido_en": obtenido,
        "partidas_descartadas": (financials or {}).get("partidas_descartadas"),
        "metricas": m,
        "trimestre": trimestre,
        "crecimiento_5a": growth_summary(periodos),
        "_periodos": periodos,  # para otras secciones; no se congela
    }


def _ultimo_trimestre(trimestres: list[dict], obtenido: str | None) -> dict | None:
    if not trimestres:
        return None
    q = trimestres[-1]
    # El mismo trimestre del año anterior: cierre entre 350 y 380 días antes.
    try:
        fin = date.fromisoformat(q["end_date"])
    except (KeyError, ValueError):
        return None
    hace_un_ano = next(
        (t for t in reversed(trimestres[:-1])
         if 350 <= (fin - date.fromisoformat(t["end_date"])).days <= 380),
        None,
    )
    rev = _partida(q, "revenue", obtenido)
    oi = _partida(q, "operating_income", obtenido)
    rev_prev = _partida(hace_un_ano, "revenue", obtenido) if hace_un_ano else {}
    return {
        "periodo": q.get("periodo"),
        "periodo_fin": q.get("end_date"),
        "publicado": q.get("filed_at"),
        "revenue": rev,
        "revenue_yoy": _metrica(
            _crecimiento(rev, rev_prev), "fracción",
            "ingresos del trimestre / mismo trimestre del año anterior − 1",
            {"ingresos": rev, "ingresos_hace_un_ano": rev_prev or None},
        ),
        "operating_margin": _metrica(_cociente(oi, rev), "fracción", "resultado operativo / ingresos (trimestre)",
                                     {"resultado_operativo": oi, "ingresos": rev}),
    }


def seccion_valoracion(fund: dict, precio: float | None) -> dict:
    """Múltiplos y DCF inverso a precio de ahora. Sin precio objetivo."""
    if fund.get("estado") != VALIDO:
        return {"estado": DESCONOCIDO, "motivo": "sin estados financieros"}
    m = fund["metricas"]
    eps = m["eps_diluted"]
    precio_d = {"valor": precio, "fuente": "cotización"}
    pe = precio / eps["valor"] if precio and eps.get("valor") and eps["valor"] > 0 else None
    acciones = (fund["_periodos"][-1] or {}).get("shares_outstanding")
    market_cap = precio * acciones if precio and acciones else None
    fcf = m["fcf"]["valor"]
    seccion = {
        "estado": VALIDO,
        "pe": _metrica(pe, "veces", "precio / BPA diluido del último ejercicio",
                       {"precio": precio_d, "bpa": eps}),
        "fcf_yield": _metrica(fcf / market_cap if fcf is not None and market_cap else None, "fracción",
                              "FCF / (precio × acciones en circulación)",
                              {"fcf": m["fcf"], "precio": precio_d}),
    }
    neta = m["deuda_neta"]["valor"]
    supuestos = {"descuento": DESCUENTO_BASE, "terminal": TERMINAL_BASE, "anos": ANOS_DCF}
    if not market_cap or fcf is None or fcf <= 0 or neta is None:
        motivo = (
            "sin precio o sin acciones" if not market_cap
            else "FCF no positivo o desconocido" if fcf is None or fcf <= 0
            else "deuda neta desconocida"
        )
        seccion["dcf_inverso"] = {"estado": DESCONOCIDO, "motivo": motivo, "supuestos": supuestos}
        return seccion
    curva = curva_de_crecimiento_implicito(
        market_cap=market_cap, base_fcf=fcf, terminal_growth=TERMINAL_BASE,
        years=ANOS_DCF, net_debt=neta,
    )
    base = next((p for p in curva.get("puntos", []) if p["discount_rate"] == DESCUENTO_BASE), None)
    seccion["dcf_inverso"] = {
        "estado": VALIDO if curva.get("disponible") else DESCONOCIDO,
        "crecimiento_implicito": (base or {}).get("crecimiento_implicito"),
        "rango": curva.get("rango"),
        "supuestos": supuestos,
        "motivo": None if curva.get("disponible") else curva.get("nota"),
        "nota": "Crecimiento anual del FCF que justifica el precio de hoy CON estos supuestos. No es un dato de la empresa.",
    }
    return seccion


def seccion_tesis(
    session: Session, instrument: Instrument | None, fund: dict, noticias: list[dict], ahora: datetime
) -> dict:
    """La tesis vigente, congelada por contenido: si luego se edita, esto no cambia."""
    if instrument is None:
        return {"estado": "sin_tesis"}
    candidatas = session.execute(
        select(Thesis).where(Thesis.instrument_id == instrument.id)
        .order_by(Thesis.updated_at.desc(), Thesis.id.desc())
    ).scalars().all()
    candidatas = [t for t in candidatas if pit.disponible_en(t.created_at, ahora) is not False]
    tesis = candidatas[0] if candidatas else None
    if tesis is None:
        return {"estado": "sin_tesis"}
    if pit.disponible_en(tesis.updated_at, ahora) is False:
        # La tesis existía, pero se editó después: su texto de ENTONCES no se
        # guardó en ningún sitio. No se enseña el de hoy como si fuera aquel.
        return {"estado": DESCONOCIDO, "id": tesis.id,
                "motivo": "la tesis se modificó después de este momento; su contenido de entonces no se conserva"}
    disparadores = session.execute(
        select(ThesisTrigger).where(ThesisTrigger.thesis_id == tesis.id)
    ).scalars().all()
    periodos = fund.get("_periodos") or []
    vigilancia = thesis_watch.vigilar(
        [
            {"id": d.id, "kind": d.kind, "descripcion": d.descripcion,
             "config": d.config, "activo": d.activo}
            for d in disparadores
        ],
        {
            "ratios": derive_ratio_series(periodos) if periodos else [],
            "crecimiento": growth_summary(periodos) if periodos else {},
            "noticias": noticias,
        },
    )
    if not vigilancia["total"]:
        estado = "sin_puntos"
    elif vigilancia["saltan"]:
        estado = "puntos_cruzados"
    elif vigilancia["sin_medir"]:
        estado = "sin_comprobar"
    else:
        estado = "intacta"
    cuerpo = tesis.body_md or ""
    return {
        "estado": estado,
        "id": tesis.id,
        "titulo": tesis.title,
        "creada": _iso(tesis.created_at),
        "actualizada": _iso(tesis.updated_at),
        "cuerpo": cuerpo[:MAX_CUERPO_TESIS],
        "cuerpo_truncado": len(cuerpo) > MAX_CUERPO_TESIS,
        "cuerpo_sha256": hashlib.sha256(cuerpo.encode()).hexdigest(),
        "invalidacion": tesis.invalidation_criteria,
        "disparadores": [
            {
                "id": d.get("id"), "kind": d.get("kind"), "descripcion": d.get("descripcion"),
                "config": d.get("config"), "salta": bool(d.get("salta")),
                "medible": bool(d.get("medible")), "valor": d.get("valor"),
                "umbral": d.get("umbral"), "detalle": d.get("detalle") or d.get("motivo"),
            }
            for d in vigilancia["disparadores"]
        ],
        "resumen": vigilancia["nota"],
    }


def seccion_noticias(service, symbol: str, ahora: datetime) -> dict:
    """Titulares ya publicados en el momento del análisis. Solo hechos de la API."""
    payload, fallo = _traer(service, "news", symbol=symbol, days=DIAS_NOTICIAS)
    items = (payload or {}).get("items") or []
    separadas = pit.filtrar(items, lambda n: n.get("published_at"), ahora)
    disponibles = sorted(separadas["disponibles"], key=lambda n: str(n.get("published_at")), reverse=True)
    return {
        "estado": VALIDO if payload is not None else DESCONOCIDO,
        "fuente": (payload or {}).get("source"),
        "obtenido_en": (payload or {}).get("as_of"),
        "motivo": fallo,
        "items": [
            {"headline": n.get("headline"), "url": n.get("url"), "source": n.get("source"),
             "published_at": _iso(n.get("published_at"))}
            for n in disponibles[:MAX_NOTICIAS]
        ],
        # Lo que la API trajo con fecha posterior o sin fecha NO entra: no se
        # puede probar que se conociera.
        "excluidas_futuras": len(separadas["futuros"]),
        "excluidas_sin_fecha": len(separadas["sin_fecha"]),
    }


def _senal_cacheada(service, symbol: str) -> dict | None:
    """La señal de la última lista diaria calculada, si incluye la empresa.

    La puntuación es RELATIVA al sector dentro de ese barrido: se dice de qué
    lista sale y de cuándo es. No se recalcula aquí porque puntuar una empresa
    sola no tiene sentido — los factores se miden contra sus comparables.
    """
    from app.analysis.markets import MARKETS

    cache = getattr(service, "cache", None)
    if cache is None:
        return None
    for clave in MARKETS:
        try:
            lista = cache.get("daily_picks", {"v": 6, "market": clave})
        except Exception:  # noqa: BLE001 — una caché ilegible no es una señal
            log("cache").exception("análisis: lista diaria ilegible (%s)", clave)
            continue
        for s in (lista or {}).get("signals") or []:
            if s.get("symbol") == symbol and s.get("score") is not None:
                return {
                    "score": s.get("score"), "label": s.get("label"), "coverage": s.get("coverage"),
                    "probability": s.get("probability"), "families": s.get("families"),
                    "origen": f"lista diaria «{clave}»", "publicado": lista.get("as_of"),
                    "sector": (s.get("context") or {}).get("sector_name"),
                }
    return None


def seccion_senal(service, symbol: str, con_pares: bool, ahora: datetime) -> dict:
    s = _senal_cacheada(service, symbol)
    if s is not None and pit.disponible_en(s.get("publicado"), ahora) is not False:
        return {"estado": VALIDO, **s}
    if con_pares:
        from app.routers.deep_dive import _peer_signal

        fund, _ = _traer(service, "fundamentals", symbol=symbol)
        # Los fundamentales de los pares son los de HOY: para un análisis a una
        # fecha pasada serían información futura.
        if fund and fund.get("metrics") and pit.disponible_en(fund.get("as_of"), ahora) is not False:
            try:
                p = _peer_signal(service, symbol, dict(fund["metrics"]))
            except Exception:  # noqa: BLE001 — sin señal se decide «sin datos», no se cae
                log("calculo").exception("análisis: no se pudo puntuar %s contra sus pares", symbol)
                p = None
            if p and p.get("score") is not None:
                return {
                    "estado": VALIDO, "score": p["score"], "label": p.get("label"),
                    "coverage": p.get("coverage"), "probability": None, "families": p.get("families"),
                    "origen": f"pares de Finnhub ({', '.join(p.get('peer_group') or [])})",
                    "publicado": fund.get("as_of"), "sector": None,
                }
    return {
        "estado": DESCONOCIDO,
        "score": None,
        "motivo": (
            "La empresa no está en ninguna lista diaria calculada y no se pudo "
            "puntuar contra sus pares. Sin puntuación, el motor no decide."
        ),
    }


def _posicion(session: Session, instrument: Instrument | None, ahora: datetime) -> dict | None:
    """La posición abierta, agregando lotes. El stop: el más alto de los fijados,
    y solo si TODOS los lotes lo tienen (si no, se recalcula y se dice)."""
    if instrument is None:
        return None
    lotes = [
        l for l in session.execute(
            select(Position).where(Position.instrument_id == instrument.id)
        ).scalars().all()
        if pit.disponible_en(l.opened_at, ahora) is not False
        and (l.closed_at is None or pit.disponible_en(l.closed_at, ahora) is False)
    ]
    if not lotes:
        return None
    cantidad = sum(l.quantity for l in lotes)
    coste = sum(l.quantity * l.cost_basis for l in lotes) / cantidad if cantidad else None
    stops = [l.stop for l in lotes]
    return {
        "quantity": cantidad,
        "cost_basis": coste,
        "stop": max(stops) if stops and all(s is not None for s in stops) else None,
        "lotes": len(lotes),
        "abierta_desde": _iso(min(l.opened_at for l in lotes)),
    }


def _resultados_proximos(service, symbol: str, ahora: datetime) -> str | None:
    hoy = ahora.date()
    payload, _ = _traer(
        service, "earnings_calendar",
        start=hoy.isoformat(), end=(hoy + timedelta(days=DIAS_RESULTADOS)).isoformat(),
    )
    return next(
        (e.get("date") for e in (payload or {}).get("events") or [] if e.get("symbol") == symbol),
        None,
    )


def seccion_riesgo(session: Session, service, symbol: str, mercado: dict, decision: dict, ahora: datetime) -> dict:
    """Su riesgo DENTRO de tu cartera: lo que aporta si la tienes, o lo que
    aportaría al peso que el motor propone si no. Solo con histórico en caché:
    abrir una empresa no descarga décadas de precios de toda la cartera."""
    from app import contexto_cartera
    from app.analysis import portfolio_risk
    from app.analysis.sizing import MAX_POR_POSICION_PCT

    try:
        ctx = contexto_cartera.construir(session, service, descargar=False, ahora=ahora)
    except Exception:  # noqa: BLE001 — sección aislada
        log("calculo").exception("análisis: no se pudo construir el contexto de cartera")
        return {"estado": ERROR, "motivo": "no se pudo leer la cartera", "huella": None}
    if not any(p.get("peso") for p in ctx["posiciones"]):
        return {"estado": "sin_cartera", "huella": None,
                "nota": "No hay posiciones valoradas: no hay riesgo de cartera que medir."}

    total = portfolio_risk.contribucion_al_riesgo(ctx["posiciones"], ctx["series"], mercado=ctx["mercado"])
    propia = next((x for x in total.get("posiciones") or [] if x["symbol"] == symbol), None)
    en_cartera = any(p["symbol"] == symbol for p in ctx["posiciones"])
    if en_cartera:
        if propia is None:
            motivo = next((d["motivo"] for d in total.get("desconocidas") or [] if d["symbol"] == symbol), None)
            return {"estado": DESCONOCIDO, "en_cartera": True, "motivo": motivo, "huella": "desconocido"}
        return {
            "estado": VALIDO, "en_cartera": True, "peso": propia["peso"], "contribucion": propia["contribucion"],
            "volatilidad": propia["volatilidad"], "correlacion_con_cartera": propia["correlacion_con_cartera"],
            "beta_mercado": propia["beta_mercado"], "cluster_nivel": propia["cluster_nivel"],
            "riesgo_por_peso": propia["riesgo_por_peso"], "cobertura_peso": total.get("cobertura_peso"),
            "desde": total.get("desde"), "hasta": total.get("hasta"),
            "huella": f"{round(propia['contribucion'], 2)}:{propia['cluster_nivel']}",
        }
    # No la tienes: ¿qué aportaría al peso propuesto (o al tope por posición)?
    historia, _ = _traer(service, "price_history", symbol=symbol, interval="1day", outputsize=252)
    moneda = (mercado.get("precio") or {}).get("moneda")
    if moneda is None:
        return {"estado": DESCONOCIDO, "en_cartera": False, "huella": "desconocido",
                "motivo": "moneda de cotización desconocida: no se supone dólar"}
    serie = [(date.fromisoformat(str(b["ts"])[:10]), float(b["close"]))
             for b in (historia or {}).get("bars") or [] if datos.precio(b.get("close")) is not None
             and pit.disponible_en(str(b.get("ts"))[:10], ahora.date()) is not False]
    serie = contexto_cartera.convertir_serie(serie, moneda, ctx["fx_series"]) if serie else None
    peso = min((((decision.get("levels") or {}).get("peso_bruto_pct")) or MAX_POR_POSICION_PCT), MAX_POR_POSICION_PCT) / 100
    if not serie:
        return {"estado": DESCONOCIDO, "en_cartera": False, "huella": "desconocido",
                "motivo": f"sin histórico en {moneda} convertible a dólares"}
    hipotesis = portfolio_risk.riesgo_de_anadir(ctx["posiciones"], ctx["series"], symbol, serie, peso)
    if not hipotesis.get("disponible"):
        return {"estado": DESCONOCIDO, "en_cartera": False, "motivo": hipotesis.get("motivo"), "huella": "desconocido"}
    return {
        "estado": VALIDO, "en_cartera": False, "peso_supuesto": peso,
        "contribucion": hipotesis["contribucion_del_candidato"],
        "correlacion_con_cartera": hipotesis["correlacion_con_cartera"],
        "cluster_nivel": hipotesis["cluster_nivel"], "riesgo_por_peso": hipotesis["riesgo_por_peso"],
        "volatilidad_cartera_antes": hipotesis["volatilidad_antes"],
        "volatilidad_cartera_despues": hipotesis["volatilidad_despues"],
        "nota": f"Si la añadieras al {peso * 100:.1f} % (lo que propone el motor, con el tope por posición).",
        "huella": f"{round(hipotesis['contribucion_del_candidato'], 2)}:{hipotesis['cluster_nivel']}",
    }


# --- El análisis --------------------------------------------------------------


def analizar(
    symbol: str,
    service,
    session: Session,
    *,
    ahora: datetime | None = None,
    con_pares: bool = True,
) -> dict:
    """El análisis completo de una empresa, con todo lo que entra en la decisión."""
    from app.routers.signals import _stored_rule_backtest

    ahora = ahora or datetime.now(timezone.utc)
    symbol = symbol.strip().upper()
    instrument = session.execute(select(Instrument).where(Instrument.symbol == symbol)).scalar_one_or_none()

    mercado, bloque_precio = seccion_mercado(service, symbol, ahora)
    financials, fallo_f = _traer(service, "financials", symbol=symbol)
    fund = seccion_fundamentales(financials, fallo_f, ahora)
    valoracion = seccion_valoracion(fund, mercado["precio"]["valor"])
    noticias = seccion_noticias(service, symbol, ahora)
    tesis = seccion_tesis(session, instrument, fund, noticias["items"], ahora)
    senal = seccion_senal(service, symbol, con_pares, ahora)
    posicion = _posicion(session, instrument, ahora)
    resultados_en = _resultados_proximos(service, symbol, ahora)

    clase = "cripto" if symbol.endswith("-USD") else "accion"
    decision = decide(
        {"score": senal.get("score"), "probability": senal.get("probability")},
        bloque_precio,
        posicion,
        favorable_min=FAVORABLE_MIN,
        desfavorable_max=UNFAVORABLE_MAX,
        reglas=_stored_rule_backtest(session, hasta=ahora),
        clase=clase,
        resultados_en=resultados_en,
    )

    analisis = {
        "esquema": ESQUEMA,
        "symbol": symbol,
        "nombre": instrument.name if instrument else None,
        "sector": (instrument.sector if instrument else None) or senal.get("sector"),
        "analizado_en": ahora.isoformat(),
        "mercado": mercado,
        "fundamentales": {k: v for k, v in fund.items() if not k.startswith("_")},
        "valoracion": valoracion,
        "tesis": tesis,
        "noticias": noticias,
        "senal": senal,
        "posicion": posicion,
        "resultados_proximos": resultados_en,
        "decision": decision,
        "generado_por": "app",  # determinista: ninguna línea de esto sale de un LLM
    }
    analisis["riesgo"] = seccion_riesgo(session, service, symbol, mercado, decision, ahora)

    # Resultados frente a lo esperado: solo lo registrado hasta `ahora`.
    from app import expectativas as seguimiento

    try:
        analisis["expectativas"] = seguimiento.resumen_para_analisis(session, symbol, ahora)
    except Exception:  # noqa: BLE001 — sección aislada: su fallo no tumba el análisis
        log("calculo").exception("análisis: no se pudo leer el seguimiento de expectativas de %s", symbol)
        analisis["expectativas"] = {"estado": ERROR, "huella": None}
    analisis["faltan"] = datos_desconocidos(analisis)
    # La confianza se mide sobre la evidencia que hay, después de saber qué falta.
    analisis["confianza"] = confianza.evaluar(analisis, ahora)
    analisis["marcas"] = marcas_de_tiempo(analisis)
    analisis["_fund"] = fund  # para secciones posteriores; no se congela
    return analisis


def datos_desconocidos(a: dict) -> list[dict]:
    """Todo lo que el análisis NO sabe, con su motivo. Se congela tal cual."""
    faltan = []
    if a["mercado"]["precio"]["valor"] is None:
        faltan.append({"dato": "precio", "seccion": "mercado", "motivo": a["mercado"]["precio"]["motivo"]})
    elif a["mercado"]["precio"]["estado"] == VIEJO:
        faltan.append({"dato": "precio actual", "seccion": "mercado",
                       "motivo": "solo hay un precio viejo (las fuentes fallaron)"})
    if a["mercado"]["sma200"] is None:
        faltan.append({"dato": "media de 200 sesiones", "seccion": "mercado",
                       "motivo": a["mercado"]["historico"]["motivo"] or "histórico insuficiente"})
    fund = a["fundamentales"]
    if fund.get("estado") != VALIDO:
        faltan.append({"dato": "estados financieros", "seccion": "fundamentales", "motivo": fund.get("motivo")})
    else:
        for clave, m in fund["metricas"].items():
            if m.get("valor") is None:
                metodo = m.get("metodo")
                faltan.append({"dato": clave, "seccion": "fundamentales",
                               "motivo": f"falta una entrada ({metodo})" if metodo else "no reportado en el filing"})
    val = a["valoracion"]
    if (val.get("dcf_inverso") or {}).get("estado") == DESCONOCIDO:
        faltan.append({"dato": "DCF inverso", "seccion": "valoracion", "motivo": val["dcf_inverso"].get("motivo")})
    if a["senal"].get("score") is None:
        faltan.append({"dato": "puntuación", "seccion": "senal", "motivo": a["senal"].get("motivo")})
    if a["tesis"].get("estado") == "sin_comprobar":
        faltan.append({"dato": "puntos de la tesis", "seccion": "tesis",
                       "motivo": "algún punto de invalidación no se pudo medir"})
    return faltan


def marcas_de_tiempo(a: dict) -> list[dict]:
    """Cada dato fechado del análisis: qué es, cuándo se publicó, cuándo se obtuvo.

    Es la lista que `punto_en_el_tiempo` recorre para probar que nada era
    posterior a la decisión. Se genera desde el propio documento, así que no
    puede haber un dato dentro sin su marca aquí.
    """
    marcas = []
    p = a["mercado"]["precio"]
    if p.get("valor") is not None:
        marcas.append({"dato": "precio", "publicado": p.get("publicado"), "obtenido_en": p.get("obtenido_en")})
    h = a["mercado"]["historico"]
    if h.get("hasta"):
        marcas.append({"dato": "histórico de precios", "publicado": h["hasta"], "obtenido_en": h.get("obtenido_en")})
    fund = a["fundamentales"]
    for clave, m in (fund.get("metricas") or {}).items():
        for nombre, e in ({clave: m} if "publicado" in m else (m.get("entradas") or {})).items():
            if isinstance(e, dict) and e.get("valor") is not None and e.get("fuente") == "edgar":
                marcas.append({"dato": f"{clave}:{nombre}", "publicado": e.get("publicado"),
                               "obtenido_en": e.get("obtenido_en")})
    tri = fund.get("trimestre") or {}
    if (tri.get("revenue") or {}).get("valor") is not None:
        marcas.append({"dato": f"trimestre {tri.get('periodo')}", "publicado": tri.get("publicado"),
                       "obtenido_en": fund.get("obtenido_en")})
    for n in a["noticias"].get("items") or []:
        marcas.append({"dato": f"noticia: {(n.get('headline') or '')[:60]}", "publicado": n.get("published_at"),
                       "obtenido_en": a["noticias"].get("obtenido_en")})
    s = a["senal"]
    if s.get("score") is not None:
        marcas.append({"dato": "puntuación", "publicado": s.get("publicado"), "obtenido_en": s.get("publicado")})
    return marcas
