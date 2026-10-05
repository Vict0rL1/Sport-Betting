"""La empresa como objeto de análisis repetido: qué dice hoy, qué dijo antes.

`GET /{symbol}/analisis` ejecuta el análisis completo (sin LLM), lo congela si
ha cambiado algo material y lo compara con el anterior. `GET /{symbol}/historial`
lista lo que el sistema dijo de esta empresa, de cualquier origen. El replay de
cada instantánea vive en `/api/snapshots/{id}/replay`.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import analisis_empresa
from app import snapshots as sn
from app.cache.cache import MarketDataService
from app.db.engine import get_session
from app.db.models import DecisionSnapshot
from app.deps import get_service

router = APIRouter(prefix="/api/empresa", tags=["empresa"])

_SYMBOL_RE = re.compile(r"^[A-Za-z0-9.\-]{1,12}$")


def _validar(symbol: str) -> str:
    if not _SYMBOL_RE.match(symbol):
        raise HTTPException(status_code=422, detail=f"Símbolo inválido: {symbol}")
    return symbol.upper()


def analizar_y_congelar(
    symbol: str, service, session: Session, *, ahora: datetime | None = None,
    congelar: bool = True, con_pares: bool = True,
) -> dict:
    """El caso de uso entero, independiente de la API: analizar, congelar y
    comparar con el último análisis comparable."""
    ahora = ahora or datetime.now(timezone.utc)
    analisis = analisis_empresa.analizar(symbol, service, session, ahora=ahora, con_pares=con_pares)
    instantanea, nueva = (None, False)
    if congelar:
        instantanea, nueva = sn.congelar_analisis(session, analisis, ahora)
    anterior = (
        sn.anterior_comparable(session, instantanea) if instantanea is not None
        else sn.anterior_comparable(session, analisis["symbol"], antes_de=ahora)
    )
    return {
        "analisis": {k: v for k, v in analisis.items() if not k.startswith("_")},
        "instantanea": (
            {"id": instantanea.id, "nueva": nueva, "origen": instantanea.origen,
             "creado_en": instantanea.creado_en.isoformat()}
            if instantanea is not None else None
        ),
        "anterior": (
            {"id": anterior.id, "creado_en": anterior.creado_en.isoformat(), "accion": anterior.accion}
            if anterior is not None else None
        ),
    }


@router.get("/{symbol}/analisis")
def analisis(
    symbol: str,
    congelar: bool = Query(True, description="Guardar la instantánea si cambió algo material"),
    pares: bool = Query(True, description="Puntuar contra pares si no está en ninguna lista diaria"),
    service: MarketDataService = Depends(get_service),
    session: Session = Depends(get_session),
):
    return analizar_y_congelar(_validar(symbol), service, session, congelar=congelar, con_pares=pares)


@router.get("/{symbol}/historial")
def historial(symbol: str, limite: int = Query(50, ge=1, le=500), session: Session = Depends(get_session)):
    """Todo lo que el sistema dijo de esta empresa, de la lista diaria y de los
    análisis, de lo más reciente a lo más antiguo."""
    symbol = _validar(symbol)
    filas = session.execute(
        select(DecisionSnapshot)
        .where(DecisionSnapshot.symbol == symbol)
        .order_by(DecisionSnapshot.creado_en.desc(), DecisionSnapshot.id.desc())
        .limit(limite)
    ).scalars().all()
    return {
        "symbol": symbol,
        "decisiones": [
            {
                "id": s.id, "fecha": s.fecha,
                "creado_en": s.creado_en.isoformat() if s.creado_en else None,
                "origen": s.origen, "accion": s.accion, "precio": s.precio,
                "moneda": s.moneda, "score": s.score, "reglas_version": s.reglas_version,
                "replay": (s.contexto or {}).get("esquema") == sn.ESQUEMA_ANALISIS,
            }
            for s in filas
        ],
        "reglas_version_actual": sn.version_de_reglas(),
    }
