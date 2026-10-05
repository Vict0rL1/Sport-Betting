"""La empresa como objeto de análisis repetido: qué dice hoy, qué dijo antes.

`GET /{symbol}/analisis` ejecuta el análisis completo (sin LLM), lo congela si
ha cambiado algo material y lo compara con el anterior. `GET /{symbol}/historial`
lista lo que el sistema dijo de esta empresa, de cualquier origen. El replay de
cada instantánea vive en `/api/snapshots/{id}/replay`.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import analisis_empresa
from app import snapshots as sn
from app.analysis import cambios as diff
from app.cache.cache import MarketDataService
from app.db.engine import get_session
from app.db.models import DecisionSnapshot
from app.db.models import LlmOutput
from app.deps import get_llm, get_service
from app.llm.base import LLMProvider, LLMUnavailableError

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
    cambios = (
        {**diff.comparar((anterior.contexto or {}).get("analisis") or {}, analisis),
         "contra": {"id": anterior.id, "creado_en": anterior.creado_en.isoformat()}}
        if anterior is not None
        else {"primer_analisis": True,
              "nota": "Primer análisis comparable de esta empresa: no hay contra qué comparar."}
    )
    return {
        "cambios": cambios,
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


@router.get("/materialidad")
def materialidad():
    """Los umbrales de materialidad vigentes, con su versión."""
    return {"version": diff.version_materialidad(), "numericos": diff.MATERIALIDAD,
            "categoricos": diff.CATEGORICOS}


@router.get("/{symbol}/cambios/{snap_id}")
def cambios_entre(symbol: str, snap_id: int, contra: int | None = None, session: Session = Depends(get_session)):
    """El diff entre una instantánea y la anterior comparable (u otra concreta)."""
    symbol = _validar(symbol)
    snap = session.get(DecisionSnapshot, snap_id)
    if snap is None or snap.symbol != symbol:
        raise HTTPException(status_code=404, detail="Instantánea no encontrada")
    otra = session.get(DecisionSnapshot, contra) if contra else sn.anterior_comparable(session, snap)
    if otra is None:
        return {"primer_analisis": True}
    return {
        **diff.comparar((otra.contexto or {}).get("analisis") or {}, (snap.contexto or {}).get("analisis") or {}),
        "contra": {"id": otra.id, "creado_en": otra.creado_en.isoformat()},
    }


@router.post("/{symbol}/cambios/resumen-ia")
def resumen_ia(
    symbol: str,
    cambios: dict = Body(...),
    llm: LLMProvider | None = Depends(get_llm),
    session: Session = Depends(get_session),
):
    """Un resumen en prosa DEL DIFF ya calculado. Opcional y marcado como IA.

    El modelo no ve los datos de la empresa, solo el diff determinista: no
    puede añadir cifras que no estén en él, y lo que diga no sustituye a la
    explicación de las reglas, que es la primaria.
    """
    symbol = _validar(symbol)
    if llm is None:
        raise HTTPException(status_code=503, detail="Capa de IA no configurada: añade ANTHROPIC_API_KEY en .env")
    import json

    prompt = (
        f"Empresa: {symbol}. Este es el diff DETERMINISTA entre dos análisis (JSON). "
        "Resúmelo en 3-5 frases en español. Usa SOLO cifras que estén en el JSON. "
        "No recomiendes comprar ni vender, no predigas precios.\n\n"
        + json.dumps(cambios, ensure_ascii=False)[:12000]
    )
    try:
        r = llm.interpret(RESUMEN_SYSTEM, prompt)
    except LLMUnavailableError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    session.add(LlmOutput(kind="resumen_cambios", content_md=r["content"], model=r["model"]))
    session.commit()
    return {
        "generado_por": "ia",
        "content_md": r["content"],
        "model": r["model"],
        "aviso": "Resumen generado por IA a partir del diff calculado. La explicación primaria es la de las reglas.",
    }


RESUMEN_SYSTEM = (
    "Resumes diffs ya calculados de un análisis financiero. No inventas cifras, no "
    "recomiendas, no predices. Si el diff no dice algo, no lo dices."
)


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
