"""Expectativas frente a resultados: eventos, captura previa, resultados y calibración.

Sin LLM en ninguna lectura. El guidance de la dirección es la única fuente que
pasa por una IA —la extracción del filing, con cita verificada— y viaja
marcado como tal en su `detalle`.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import expectativas as svc
from app.cache.cache import MarketDataService
from app.db.engine import get_session
from app.db.models import TIPOS_DE_EVENTO, TIPOS_DE_FUENTE, CatalystEvent
from app.deps import get_service
from app.providers.base import DataNotFoundError
from app.providers.router import AllProvidersFailedError

router = APIRouter(prefix="/api/expectativas", tags=["expectativas"])

_SYMBOL_RE = re.compile(r"^[A-Za-z0-9.\-]{1,12}$")
_FECHA = r"^\d{4}-\d{2}-\d{2}$"


class EventoCrear(BaseModel):
    symbol: str = Field(min_length=1, max_length=12)
    tipo: str = Field("earnings", pattern="^(" + "|".join(TIPOS_DE_EVENTO) + ")$")
    periodo: str | None = Field(None, max_length=16, description="«2026-Q3»")
    periodo_fin: str | None = Field(None, pattern=_FECHA)
    fecha_prevista: str | None = Field(None, pattern=_FECHA)
    descripcion: str | None = None


class ExpectativaManual(BaseModel):
    metrica: str = Field(min_length=1, max_length=48)
    fuente: str = Field(min_length=1, max_length=96, description="De dónde sale: «nota del analista X», «mi estimación»…")
    fuente_tipo: str = Field("usuario", pattern="^(" + "|".join(TIPOS_DE_FUENTE) + ")$")
    valor: float | None = Field(None, allow_inf_nan=False)
    bajo: float | None = Field(None, allow_inf_nan=False)
    alto: float | None = Field(None, allow_inf_nan=False)
    operador: str | None = Field(None, pattern="^(gte|gt|lte|lt)$")
    unidad: str | None = Field(None, max_length=24)
    informacion_hasta: str | None = Field(None, description="Cuándo era cierta la información (ISO)")


def _evento(session: Session, evento_id: int) -> CatalystEvent:
    e = session.get(CatalystEvent, evento_id)
    if e is None:
        raise HTTPException(status_code=404, detail="Evento no encontrado")
    return e


@router.post("/eventos")
def crear_evento(body: EventoCrear, session: Session = Depends(get_session)):
    if not _SYMBOL_RE.match(body.symbol):
        raise HTTPException(status_code=422, detail=f"Símbolo inválido: {body.symbol}")
    try:
        e = svc.crear_evento(session, body.symbol, body.tipo, periodo=body.periodo,
                             periodo_fin=body.periodo_fin, fecha_prevista=body.fecha_prevista,
                             descripcion=body.descripcion)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return svc.serializar_evento(e)


@router.get("/eventos")
def listar(symbol: str | None = None, session: Session = Depends(get_session)):
    q = select(CatalystEvent).order_by(CatalystEvent.fecha_prevista.desc(), CatalystEvent.id.desc())
    if symbol:
        q = q.where(CatalystEvent.symbol == symbol.strip().upper())
    salida = []
    for e in session.execute(q).scalars():
        salida.append({**svc.serializar_evento(e),
                       "expectativas": len(svc._expectativas(session, e.id)),
                       "reales": len(svc._reales(session, e.id))})
    return {"eventos": salida}


@router.get("/eventos/{evento_id}")
def detalle(evento_id: int, session: Session = Depends(get_session)):
    e = _evento(session, evento_id)
    expectativas = [svc.serializar_expectativa(x) for x in svc._expectativas(session, e.id)]
    por_fuente: dict[str, list] = {}
    for x in expectativas:
        por_fuente.setdefault(x["fuente_tipo"], []).append(x)
    return {
        **svc.evaluar(session, e),
        "expectativas_por_fuente": por_fuente,
        "reales_registrados": [svc.serializar_real(r) for r in svc._reales(session, e.id)],
    }


@router.post("/eventos/{evento_id}/capturar")
def capturar(evento_id: int, session: Session = Depends(get_session),
             service: MarketDataService = Depends(get_service)):
    try:
        return svc.capturar(session, service, _evento(session, evento_id))
    except svc.EventoConocido as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.post("/eventos/{evento_id}/expectativas")
def manual(evento_id: int, body: ExpectativaManual, session: Session = Depends(get_session)):
    e = _evento(session, evento_id)
    if body.valor is None and body.bajo is None and body.alto is None:
        raise HTTPException(status_code=422, detail="Una expectativa necesita al menos una cifra (valor, bajo o alto).")
    try:
        nueva = svc.registrar_manual(session, e, body.model_dump())
    except svc.EventoConocido as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if not nueva:
        raise HTTPException(status_code=409, detail="Esa expectativa ya está registrada (misma métrica, fuente y tipo).")
    return {"registrada": True}


@router.post("/eventos/{evento_id}/resultados")
def resultados(evento_id: int, session: Session = Depends(get_session),
               service: MarketDataService = Depends(get_service)):
    return svc.registrar_reales(session, service, _evento(session, evento_id))


@router.get("/calibracion")
def calibracion(symbol: str | None = None, session: Session = Depends(get_session)):
    return svc.calibracion(session, symbol)


@router.post("/{symbol}/proximos-resultados")
def proximos_resultados(symbol: str, dias: int = Query(90, ge=1, le=180),
                        session: Session = Depends(get_session),
                        service: MarketDataService = Depends(get_service)):
    """Crea el evento de los próximos resultados desde el calendario y captura."""
    if not _SYMBOL_RE.match(symbol):
        raise HTTPException(status_code=422, detail=f"Símbolo inválido: {symbol}")
    symbol = symbol.upper()
    hoy = datetime.now(timezone.utc).date()
    try:
        cal = service.get("earnings_calendar", start=hoy.isoformat(), end=(hoy + timedelta(days=dias)).isoformat())
    except (DataNotFoundError, AllProvidersFailedError) as exc:
        raise HTTPException(status_code=502, detail=f"Sin calendario de resultados: {exc}") from None
    fila = next((e for e in cal.get("events") or [] if e.get("symbol") == symbol), None)
    if fila is None:
        raise HTTPException(status_code=404, detail=f"{symbol} no presenta resultados en los próximos {dias} días según el calendario.")
    periodo = f"{fila['year']}-Q{fila['quarter']}" if fila.get("year") and fila.get("quarter") else None
    existente = session.execute(select(CatalystEvent).where(
        CatalystEvent.symbol == symbol, CatalystEvent.tipo == "earnings", CatalystEvent.periodo == periodo)).scalars().first()
    e = existente or svc.crear_evento(session, symbol, "earnings", periodo=periodo, fecha_prevista=fila.get("date"),
                                      descripcion="Resultados trimestrales (calendario de Finnhub)")
    try:
        captura = svc.capturar(session, service, e)
    except svc.EventoConocido as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return {"evento": svc.serializar_evento(e), "captura": captura}
