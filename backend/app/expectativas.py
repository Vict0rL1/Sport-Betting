"""Seguimiento de expectativas: capturar ANTES, registrar lo real DESPUÉS, comparar.

La parte pura (comparar, clasificar, calibrar) está en
`app/analysis/expectativas.py`. Aquí vive lo que toca la base y las fuentes:

- **Capturar** las expectativas de un evento antes de que ocurra, de cada
  fuente por separado: el consenso del calendario de Finnhub, el guidance de la
  dirección ya extraído de un filing (IA, con cita verificada), el modelo
  interno de la app y los umbrales de la tesis. Capturar cuando el resultado ya
  se conoce se NIEGA: sería registrar como expectativa lo que ya se sabe.
- **Registrar** los resultados reales desde EDGAR, con su documento y fecha.
- **Evaluar** y **calibrar**, sin mezclar fuentes.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import datos
from app import punto_en_el_tiempo as pit
from app.analysis import expectativas as ev
from app.db.models import (
    TIPOS_DE_EVENTO,
    TIPOS_DE_FUENTE,
    CatalystEvent,
    EarningsAnalysis,
    EventActual,
    Expectation,
    Instrument,
    Thesis,
    ThesisTrigger,
)
from app.providers.base import DataNotFoundError
from app.providers.router import AllProvidersFailedError
from app.registro import log

# Métricas de la tesis que se pueden contrastar con un trimestre. El resto de
# disparadores (crecimiento plurianual, noticias) queda «sin resolver».
METRICAS_TESIS_TRIMESTRALES = {"gross_margin", "operating_margin", "net_margin"}
INVERSO = {"lt": "gte", "lte": "gt", "gt": "lte", "gte": "lt"}


class EventoConocido(Exception):
    """El resultado del evento ya se conoce: capturar ahora sería hacer trampa."""


def _iso(d) -> str | None:
    if d is None:
        return None
    if isinstance(d, datetime):
        return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).isoformat()
    return str(d)


def _a_instante(valor) -> datetime:
    """Una marca de la fuente a datetime UTC. Un día solo, a su comienzo."""
    m = pit.marca(valor)
    if m is None:
        return datetime.now(timezone.utc)
    momento, instante = m
    return momento if instante else datetime(momento.year, momento.month, momento.day, tzinfo=timezone.utc)


def serializar_evento(e: CatalystEvent) -> dict:
    return {"id": e.id, "symbol": e.symbol, "tipo": e.tipo, "periodo": e.periodo,
            "periodo_fin": e.periodo_fin, "fecha_prevista": e.fecha_prevista,
            "descripcion": e.descripcion, "creado_en": _iso(e.creado_en)}


def serializar_expectativa(x: Expectation) -> dict:
    return {"id": x.id, "metrica": x.metrica, "fuente_tipo": x.fuente_tipo, "fuente": x.fuente,
            "valor": x.valor, "bajo": x.bajo, "alto": x.alto, "operador": x.operador,
            "unidad": x.unidad, "informacion_hasta": _iso(x.informacion_hasta),
            "registrado_en": _iso(x.registrado_en), "detalle": x.detalle}


def serializar_real(r: EventActual) -> dict:
    return {"id": r.id, "metrica": r.metrica, "valor": r.valor, "unidad": r.unidad,
            "fuente": r.fuente, "publicado": r.publicado, "registrado_en": _iso(r.registrado_en),
            "detalle": r.detalle}


# --- Eventos -------------------------------------------------------------------


def crear_evento(session: Session, symbol: str, tipo: str, *, periodo: str | None = None,
                 periodo_fin: str | None = None, fecha_prevista: str | None = None,
                 descripcion: str | None = None, ahora: datetime | None = None) -> CatalystEvent:
    if tipo not in TIPOS_DE_EVENTO:
        raise ValueError(f"tipo de evento desconocido: {tipo}")
    for f in (periodo_fin, fecha_prevista):
        if f is not None:
            date.fromisoformat(f)  # ValueError si no es AAAA-MM-DD
    e = CatalystEvent(symbol=symbol.upper(), tipo=tipo, periodo=periodo, periodo_fin=periodo_fin,
                      fecha_prevista=fecha_prevista, descripcion=descripcion,
                      creado_en=ahora or datetime.now(timezone.utc))
    session.add(e)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise ValueError(f"ya existe un evento {tipo} de {symbol} para {periodo}") from None
    return e


def _expectativas(session: Session, evento_id: int) -> list[Expectation]:
    return session.execute(select(Expectation).where(Expectation.event_id == evento_id)
                           .order_by(Expectation.id)).scalars().all()


def _reales(session: Session, evento_id: int) -> list[EventActual]:
    return session.execute(select(EventActual).where(EventActual.event_id == evento_id)
                           .order_by(EventActual.id)).scalars().all()


def resultado_conocido(session: Session, evento: CatalystEvent, ahora: datetime) -> str | None:
    """None si en `ahora` el resultado aún no se conoce; si no, el motivo."""
    reales = [serializar_real(r) for r in _reales(session, evento.id)]
    corte = ev.corte_del_evento(serializar_evento(evento), reales)
    v = ev.validez_temporal({"registrado_en": ahora}, corte)
    return None if v["valida"] else v["motivo"]


def _guardar(session: Session, evento: CatalystEvent, x: dict, fuente_tipo: str, ahora: datetime) -> bool:
    """Una expectativa nueva. False si ya estaba (misma métrica, fuente y tipo)."""
    if fuente_tipo not in TIPOS_DE_FUENTE:
        raise ValueError(f"fuente desconocida: {fuente_tipo}")
    info = _a_instante(x.get("informacion_hasta") or ahora)
    if pit.disponible_en(info, ahora) is False:
        raise ValueError("la información de la fuente no puede ser posterior a su registro")
    fila = Expectation(
        event_id=evento.id, metrica=x["metrica"], fuente_tipo=fuente_tipo, fuente=x["fuente"][:96],
        valor=datos.numero(x.get("valor")), bajo=datos.numero(x.get("bajo")), alto=datos.numero(x.get("alto")),
        operador=x.get("operador"), unidad=x.get("unidad"), informacion_hasta=info,
        registrado_en=ahora, detalle=x.get("detalle"),
    )
    if fila.valor is None and fila.bajo is None and fila.alto is None:
        return False
    # Se comprueba antes de insertar: un rollback por la restricción única
    # deshacería también las expectativas ya añadidas en esta captura.
    existe = session.execute(select(Expectation.id).where(
        Expectation.event_id == evento.id, Expectation.metrica == fila.metrica,
        Expectation.fuente_tipo == fuente_tipo, Expectation.fuente == fila.fuente,
    )).first()
    if existe:
        return False
    session.add(fila)
    session.flush()
    return True


# --- Capturar antes ---------------------------------------------------------------


def _trimestres(service, symbol: str, ahora: datetime) -> list[dict]:
    try:
        fin = service.get("financials", symbol=symbol)
    except (DataNotFoundError, AllProvidersFailedError):
        return []
    obtenido = fin.get("as_of")
    return [q for q in fin.get("quarters") or []
            if pit.disponible_en(q.get("filed_at"), ahora, obtenido) is not False]


def _fin_objetivo(evento: CatalystEvent, trimestres: list[dict]) -> str | None:
    if evento.periodo_fin:
        return evento.periodo_fin
    conocido = next((q for q in trimestres if q.get("periodo") == evento.periodo), None)
    if conocido:
        return conocido["end_date"]
    if not trimestres:
        return None
    # El trimestre siguiente al último conocido: tres meses después de su cierre.
    ultimo = date.fromisoformat(trimestres[-1]["end_date"])
    mes = ultimo.month + 3
    ano = ultimo.year + (mes - 1) // 12
    mes = (mes - 1) % 12 + 1
    from calendar import monthrange

    return date(ano, mes, min(ultimo.day, monthrange(ano, mes)[1])).isoformat()


def capturar(session: Session, service, evento: CatalystEvent, ahora: datetime | None = None) -> dict:
    """Registra lo que cada fuente espera del evento, si todavía no ha ocurrido."""
    ahora = ahora or datetime.now(timezone.utc)
    motivo = resultado_conocido(session, evento, ahora)
    if motivo:
        raise EventoConocido(
            f"No se capturan expectativas: {motivo}. Registrarlas ahora sería anotar como "
            "expectativa algo que ya se sabe."
        )
    registradas, ya, sin = [], 0, []
    trimestres = _trimestres(service, evento.symbol, ahora)

    def anotar(x: dict, tipo: str):
        nonlocal ya
        if tipo in ("consenso", "guidance"):
            # Las fuentes de fuera pasan por la comprobación de escala: un
            # consenso en miles se leería como una sorpresa del 99 %.
            escala = ev.comprobar_escala(x, trimestres)
            if escala["estado"] == "dudosa":
                sin.append(f"{tipo}: {x['metrica']} con escala dudosa, no se registra: {escala['motivo']}")
                return
            x = {**x, "detalle": {**(x.get("detalle") or {}), "escala": escala}}
        if _guardar(session, evento, x, tipo, ahora):
            registradas.append({"metrica": x["metrica"], "fuente_tipo": tipo, "fuente": x["fuente"]})
        else:
            ya += 1

    # 1) Consenso (Finnhub, calendario de resultados).
    if evento.fecha_prevista and evento.tipo == "earnings":
        desde, hasta = ev.ventana(evento.fecha_prevista, 3)
        try:
            cal = service.get("earnings_calendar", start=desde, end=hasta)
            fila = next((e for e in cal.get("events") or [] if e.get("symbol") == evento.symbol), None)
            if fila and (fila.get("eps_actual") is not None or fila.get("revenue_actual") is not None):
                sin.append("consenso: el calendario ya trae el resultado real; no se registra como expectativa")
            elif fila:
                for metrica, campo in (("eps_diluted", "eps_estimate"), ("revenue", "revenue_estimate")):
                    if datos.numero(fila.get(campo)) is not None:
                        anotar({"metrica": metrica, "valor": fila[campo], "unidad": ev.METRICAS[metrica]["unidad"],
                                "fuente": "finnhub: calendario de resultados", "informacion_hasta": cal.get("as_of"),
                                "detalle": {"campo": campo, "fecha_evento": fila.get("date")}}, "consenso")
            else:
                sin.append("consenso: la empresa no aparece en el calendario para esas fechas")
        except (DataNotFoundError, AllProvidersFailedError) as exc:
            sin.append(f"consenso: {exc}"[:200])

    # 2) Guidance de la dirección (extraído por IA de un filing, cita verificada).
    if evento.periodo:
        extracciones = [
            {"datos": r.datos, "form_type": r.form_type, "accession_no": r.accession_no,
             "filed_at": r.filed_at, "model": r.model, "source_url": r.source_url}
            for r in session.execute(
                select(EarningsAnalysis).where(EarningsAnalysis.symbol == evento.symbol,
                                               EarningsAnalysis.kind == "extraccion")
                .order_by(EarningsAnalysis.filed_at.desc())
            ).scalars()
            if pit.disponible_en(r.filed_at, ahora) is not False
        ]
        g = ev.guidance_como_expectativas(extracciones, evento.periodo)
        for x in g["expectativas"]:
            anotar(x, "guidance")
        if not g["expectativas"]:
            sin.append("guidance: ninguna previsión verificada para este periodo en los reportes ya analizados")

    # 3) Modelo interno (determinista).
    fin = _fin_objetivo(evento, trimestres)
    internas = ev.estimacion_interna(trimestres, fin) if fin else []
    for x in internas:
        anotar({**x, "fuente": "app: modelo interno v1", "informacion_hasta": trimestres[-1].get("filed_at") if trimestres else ahora,
                "detalle": {**x["detalle"], "trimestre_objetivo_fin": fin}}, "modelo_interno")
    if not internas:
        sin.append("modelo interno: no hay trimestres suficientes para estimar")

    # 4) Reglas de la tesis: lo que la tesis exige del trimestre.
    for x in _reglas_de_tesis(session, evento.symbol, trimestres, ahora):
        anotar(x, "reglas")

    session.commit()
    log("calculo").info("%s: %d expectativas capturadas para el evento %s", evento.symbol, len(registradas), evento.id)
    return {"registradas": registradas, "ya_existian": ya, "sin_fuente": sin, "trimestre_objetivo_fin": fin}


def _reglas_de_tesis(session: Session, symbol: str, trimestres: list[dict], ahora: datetime) -> list[dict]:
    inst = session.execute(select(Instrument).where(Instrument.symbol == symbol)).scalar_one_or_none()
    if inst is None:
        return []
    salida = []
    ultimo = trimestres[-1] if trimestres else {}
    for tesis in session.execute(select(Thesis).where(Thesis.instrument_id == inst.id)).scalars():
        if pit.disponible_en(tesis.created_at, ahora) is False:
            continue
        for t in session.execute(select(ThesisTrigger).where(ThesisTrigger.thesis_id == tesis.id,
                                                             ThesisTrigger.activo.is_(True))).scalars():
            cfg = t.config or {}
            if t.kind != "metrica" or cfg.get("metrica") not in METRICAS_TESIS_TRIMESTRALES or cfg.get("op") not in INVERSO:
                continue
            metrica = cfg["metrica"]
            num = {"gross_margin": "gross_profit", "operating_margin": "operating_income", "net_margin": "net_income"}[metrica]
            previo = (datos.numero(ultimo.get(num)) / datos.numero(ultimo.get("revenue"))
                      if datos.numero(ultimo.get(num)) is not None and datos.numero(ultimo.get("revenue")) else None)
            salida.append({
                "metrica": metrica, "operador": INVERSO[cfg["op"]], "valor": cfg.get("umbral"),
                "unidad": "fracción", "fuente": f"tesis #{tesis.id}, punto #{t.id}",
                "informacion_hasta": ahora,
                "detalle": {"descripcion": t.descripcion, "trigger_id": t.id, "tesis_id": tesis.id,
                            "valor_previo": previo, "periodo_previo": ultimo.get("periodo"),
                            "nota": "la tesis se invalida si la métrica cruza el umbral; esto es lo que exige"},
            })
    return salida


def registrar_manual(session: Session, evento: CatalystEvent, x: dict, ahora: datetime | None = None) -> bool:
    """Una expectativa del usuario (KPI sectoriales, variables de la tesis...)."""
    ahora = ahora or datetime.now(timezone.utc)
    motivo = resultado_conocido(session, evento, ahora)
    if motivo:
        raise EventoConocido(f"No se registra: {motivo}.")
    nueva = _guardar(session, evento, {**x, "detalle": {**(x.get("detalle") or {}), "generado_por": "usuario"}},
                     x.get("fuente_tipo") or "usuario", ahora)
    session.commit()
    return nueva


# --- Registrar después ----------------------------------------------------------------


def _trimestre_del_evento(evento: CatalystEvent, trimestres: list[dict]) -> dict | None:
    if evento.periodo:
        q = next((q for q in trimestres if q.get("periodo") == evento.periodo), None)
        if q:
            return q
    if evento.periodo_fin:
        q = next((q for q in trimestres if q.get("end_date") == evento.periodo_fin), None)
        if q:
            return q
    if evento.fecha_prevista:
        fp = date.fromisoformat(evento.fecha_prevista)
        candidatos = [q for q in trimestres
                      if 0 <= (fp - date.fromisoformat(q["end_date"])).days <= 120]
        return candidatos[-1] if candidatos else None
    return None


def registrar_reales(session: Session, service, evento: CatalystEvent, ahora: datetime | None = None) -> dict:
    """Los resultados del trimestre desde EDGAR, cada uno con su documento."""
    ahora = ahora or datetime.now(timezone.utc)
    trimestres = _trimestres(service, evento.symbol, ahora)
    q = _trimestre_del_evento(evento, trimestres)
    if q is None:
        return {"registrados": [], "motivo": "el trimestre del evento aún no está publicado en EDGAR"}
    fuentes = q.get("fuentes") or {}

    def linaje(*campos):
        return {c: fuentes.get(c) for c in campos if fuentes.get(c)}

    rev, gp, oi, ni = (datos.numero(q.get(c)) for c in ("revenue", "gross_profit", "operating_income", "net_income"))
    cfo, capex = datos.numero(q.get("cfo")), datos.numero(q.get("capex"))
    eps = datos.numero(q.get("eps_diluted"))
    valores = {
        "revenue": (rev, linaje("revenue")),
        "eps_diluted": (eps, linaje("eps_diluted")),
        "gross_margin": (gp / rev if gp is not None and rev else None, linaje("gross_profit", "revenue")),
        "operating_margin": (oi / rev if oi is not None and rev else None, linaje("operating_income", "revenue")),
        "net_income": (ni, linaje("net_income")),
        "fcf": (cfo - capex if cfo is not None and capex is not None else None, linaje("cfo", "capex")),
    }
    accn = (fuentes.get("revenue") or {}).get("accn") or "?"
    ya = {(m, f) for m, f in session.execute(
        select(EventActual.metrica, EventActual.fuente).where(EventActual.event_id == evento.id)).all()}
    registrados = []
    for metrica, (valor, lin) in valores.items():
        if valor is None or (metrica, f"edgar {accn}") in ya:
            continue
        fila = EventActual(event_id=evento.id, metrica=metrica, valor=valor,
                           unidad=ev.METRICAS[metrica]["unidad"], fuente=f"edgar {accn}",
                           publicado=str(q.get("filed_at") or "")[:10] or ahora.date().isoformat(),
                           registrado_en=ahora,
                           detalle={"periodo": q.get("periodo"), "periodo_fin": q.get("end_date"), "linaje": lin,
                                    "metodo": "cociente de partidas del trimestre" if "margin" in metrica else None})
        session.add(fila)
        registrados.append(metrica)

    guia = _direccion_del_guidance(session, evento, ahora)
    if guia is not None and ("guidance", guia["fuente"]) not in ya:
        session.add(EventActual(event_id=evento.id, metrica="guidance", valor=None, unidad=None,
                                fuente=guia["fuente"], publicado=guia["publicado"], registrado_en=ahora,
                                detalle=guia["detalle"]))
        registrados.append("guidance")
    session.commit()
    return {"registrados": registrados, "trimestre": q.get("periodo"), "publicado": q.get("filed_at")}


def _direccion_del_guidance(session: Session, evento: CatalystEvent, ahora: datetime) -> dict | None:
    """¿Subió, bajó o se mantuvo el guidance? De la comparación entre trimestres
    ya hecha: cifras extraídas por IA con cita, variación calculada por código."""
    if not evento.fecha_prevista:
        return None
    desde = (date.fromisoformat(evento.fecha_prevista) - timedelta(days=5)).isoformat()
    comp = session.execute(
        select(EarningsAnalysis).where(EarningsAnalysis.symbol == evento.symbol,
                                       EarningsAnalysis.kind == "comparacion",
                                       EarningsAnalysis.filed_at >= desde)
        .order_by(EarningsAnalysis.filed_at)
    ).scalars().first()
    if comp is None or pit.disponible_en(comp.filed_at, ahora) is False:
        return None
    variaciones = [v for v in (comp.datos or {}).get("variaciones_calculadas") or [] if v.get("direccion")]
    if not variaciones:
        return None
    dirs = {v["direccion"] for v in variaciones}
    direccion = "mixta" if {"sube", "baja"} <= dirs else "baja" if "baja" in dirs else "sube" if "sube" in dirs else "se_mantiene"
    return {
        "fuente": f"{comp.form_type} {comp.accession_no}",
        "publicado": comp.filed_at,
        "detalle": {"direccion": direccion, "variaciones": variaciones,
                    "generado_por": "ia (cifras extraídas con cita verificada) + variación calculada por código"},
    }


# --- Evaluar y calibrar -------------------------------------------------------------------


def evaluar(session: Session, evento: CatalystEvent) -> dict:
    inst = session.execute(select(Instrument).where(Instrument.symbol == evento.symbol)).scalar_one_or_none()
    disparadores = []
    if inst is not None:
        for tesis in session.execute(select(Thesis).where(Thesis.instrument_id == inst.id)).scalars():
            disparadores += [{"id": t.id, "descripcion": t.descripcion}
                             for t in session.execute(select(ThesisTrigger).where(ThesisTrigger.thesis_id == tesis.id)).scalars()]
    return ev.evaluar_evento(
        serializar_evento(evento),
        [serializar_expectativa(x) for x in _expectativas(session, evento.id)],
        [serializar_real(r) for r in _reales(session, evento.id)],
        disparadores,
    )


def calibracion(session: Session, symbol: str | None = None) -> dict:
    """Calibración de cada fuente con TODOS los eventos ya resueltos."""
    q = select(CatalystEvent)
    if symbol:
        q = q.where(CatalystEvent.symbol == symbol.upper())
    pares = []
    for e in session.execute(q).scalars():
        reales = [serializar_real(r) for r in _reales(session, e.id)]
        if not reales:
            continue
        corte = ev.corte_del_evento(serializar_evento(e), reales)
        por_metrica = {}
        for r in sorted(reales, key=lambda r: str(r["publicado"])):
            por_metrica.setdefault(r["metrica"], r)
        for x in _expectativas(session, e.id):
            sx = serializar_expectativa(x)
            if x.fuente_tipo == "reglas" or not ev.validez_temporal(sx, corte)["valida"]:
                continue
            real = (por_metrica.get(x.metrica) or {}).get("valor")
            esperado = x.valor if x.valor is not None else (
                (x.bajo + x.alto) / 2 if x.bajo is not None and x.alto is not None else (x.bajo if x.bajo is not None else x.alto))
            pares.append({"symbol": e.symbol, "metrica": x.metrica, "fuente_tipo": x.fuente_tipo,
                          "esperado": esperado, "real": real})
    return ev.calibrar(pares)


def resumen_para_analisis(session: Session, symbol: str, ahora: datetime) -> dict:
    """El último evento resuelto y el próximo pendiente, para el análisis de empresa.
    Solo lo conocido en `ahora`."""
    eventos = session.execute(select(CatalystEvent).where(CatalystEvent.symbol == symbol)
                              .order_by(CatalystEvent.fecha_prevista.desc(), CatalystEvent.id.desc())).scalars().all()
    ultimo, proximo = None, None
    for e in eventos:
        if pit.disponible_en(e.creado_en, ahora) is False:
            continue
        reales = [r for r in _reales(session, e.id) if pit.disponible_en(r.registrado_en, ahora) is not False]
        if reales and ultimo is None:
            lectura = evaluar(session, e)
            consenso = next((c for c in lectura["por_fuente"].get("consenso") or [] if c["metrica"] == "revenue"), None)
            ultimo = {
                "evento": serializar_evento(e),
                "clasificacion": lectura["clasificacion"],
                "impacto_en_tesis": lectura["impacto_en_tesis"],
                "a_favor": lectura["a_favor"], "en_contra": lectura["en_contra"],
                "guidance": lectura["guidance"],
                "sorpresa_ingresos": (consenso or {}).get("sorpresa"),
            }
        elif not reales and proximo is None:
            proximo = {"evento": serializar_evento(e), "expectativas": len(_expectativas(session, e.id))}
    if ultimo is None and proximo is None:
        return {"estado": "sin_eventos", "huella": None}
    return {"estado": "valido", "ultimo": ultimo, "proximo": proximo,
            "huella": ((ultimo or {}).get("evento") or {}).get("id")}
