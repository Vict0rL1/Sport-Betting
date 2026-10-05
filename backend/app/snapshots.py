"""Instantáneas de decisión: congelar, reconstruir, medir después.

Esto es lo que hace posible el forward testing. Un backtest dice cómo le habría
ido a unas reglas sobre datos pasados; no dice cómo le va al sistema que
realmente estás usando, con sus datos incompletos, sus proveedores caídos y
sus límites que a veces no se pueden comprobar. Para eso hace falta anotar lo
que el sistema dijo EN EL MOMENTO y compararlo después con lo que pasó.

Tres reglas que no se negocian:

1. **Lo que se congela es lo que el motor vio**, entero: la señal con sus
   factores, el precio con su fuente, fecha y estado, las razones, lo que
   faltaba, el tamaño y qué límites de riesgo se pudieron aplicar. No un
   resumen: un resumen decide de antemano qué será relevante después.

2. **Una instantánea no se toca jamás.** Si se pudiera reescribir con lo que
   pasó después, el registro dejaría de medir lo que el sistema sabía. La base
   lo impide con triggers y el ORM con eventos; aquí, además, cada instantánea
   lleva una huella SHA-256 de su contenido para detectar cualquier cambio.

3. **El resultado va aparte y solo se añade.** `DecisionOutcome` recibe filas
   nuevas; nunca se recalibra una decisión antigua con resultados futuros.

La primera instantánea del día por símbolo y origen gana. Si la lista se
recalcula por la tarde con más empresas puntuadas, lo que ya se congeló por la
mañana no cambia — la mañana es lo que se vio por la mañana.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import datos
from app import punto_en_el_tiempo as pit
from app.analysis import decision as motor
from app.analysis import risk_budget, sizing
from app.db.models import DecisionOutcome, DecisionSnapshot
from app.registro import log

# Horizonte de evaluación, en días naturales. Las reglas no fijan un plazo; el
# forward testing necesita uno para cerrar la cuenta de cada decisión, y medio
# año es el orden de magnitud en que un stop de 8-25 % o un objetivo del doble
# suelen resolverse. Es una convención de medida, y se congela con cada
# instantánea para que cambiarla luego no reescriba lo ya medido.
HORIZONTE_DIAS = 182

ACCIONES_CONGELADAS = {"comprar", "vender", "reducir", "evitar"}


# --- Versión de las reglas ------------------------------------------------


def parametros_de_reglas() -> dict:
    """Todos los números que deciden una acción o un tamaño, con nombre."""
    return {
        "decision": {
            "riesgo_por_operacion": motor.RIESGO_POR_OPERACION,
            "topes_stop": {k: list(v) for k, v in motor.TOPES_STOP.items()},
            "stop_volatilidades": motor.STOP_VOLATILIDADES,
            "ratio_objetivo": motor.RATIO_OBJETIVO,
            "banda_entrada_pct": motor.BANDA_ENTRADA_PCT,
            "banda_tendencia_entrar_pct": motor.BANDA_TENDENCIA_ENTRAR_PCT,
            "banda_tendencia_salir_pct": motor.BANDA_TENDENCIA_SALIR_PCT,
        },
        "sizing": {
            "max_por_posicion_pct": sizing.MAX_POR_POSICION_PCT,
            "max_por_sector_pct": sizing.MAX_POR_SECTOR_PCT,
            "max_por_cluster_pct": sizing.MAX_POR_CLUSTER_PCT,
            "umbral_correlacion": sizing.UMBRAL_CORRELACION,
            "objetivo_vol_anual_pct": sizing.OBJETIVO_VOL_ANUAL_PCT,
            "vol_supuesta_pct": sizing.VOL_SUPUESTA_PCT,
            "correlacion_supuesta": sizing.CORRELACION_SUPUESTA,
        },
        "riesgo": {
            "heat_maximo_pct": risk_budget.HEAT_MAXIMO_PCT,
            "heat_grupo_maximo_pct": risk_budget.HEAT_GRUPO_MAXIMO_PCT,
        },
        "horizonte_dias": HORIZONTE_DIAS,
    }


def version_de_reglas() -> str:
    """12 caracteres que cambian si cambia CUALQUIER parámetro de las reglas.

    Sirve para no comparar peras con manzanas: dos instantáneas con versiones
    distintas se tomaron con reglas distintas, y sus resultados no se agregan
    como si fueran el mismo sistema.
    """
    return _huella(parametros_de_reglas())[:12]


# --- Congelar --------------------------------------------------------------


def _limpio(valor):
    """JSON válido: NaN e infinitos a None. Un NaN en el registro no es un dato."""
    if isinstance(valor, float) and not math.isfinite(valor):
        return None
    if isinstance(valor, dict):
        return {str(k): _limpio(v) for k, v in valor.items()}
    if isinstance(valor, (list, tuple)):
        return [_limpio(v) for v in valor]
    if isinstance(valor, (date, datetime)):
        return valor.isoformat()
    return valor


def _huella(contenido: dict) -> str:
    canonico = json.dumps(contenido, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonico.encode()).hexdigest()


def congelar(
    session: Session,
    senal: dict,
    *,
    origen: str,
    ahora: datetime,
    sizing_ctx: dict | None = None,
    peso_final_pct: float | None = None,
    mercado: dict | None = None,
) -> DecisionSnapshot | None:
    """Congela UNA decisión. Devuelve None si ya había una hoy (la primera gana).

    No hace commit: quien llama decide cuándo, para congelar una lista entera
    de una vez o no congelar nada.
    """
    decision = senal.get("decision") or {}
    accion = decision.get("action")
    symbol = senal.get("symbol")
    if not symbol or accion not in ACCIONES_CONGELADAS:
        return None

    fecha = ahora.astimezone(timezone.utc).date().isoformat()
    ya = session.execute(
        select(DecisionSnapshot.id).where(
            DecisionSnapshot.symbol == symbol,
            DecisionSnapshot.fecha == fecha,
            DecisionSnapshot.origen == origen,
        )
    ).first()
    if ya:
        return None

    precio = senal.get("price") or {}
    niveles = decision.get("levels") or {}
    contexto = _limpio(
        {
            "senal": senal,
            "sizing": sizing_ctx,
            "mercado": mercado,
            "reglas": parametros_de_reglas(),
        }
    )
    snap = DecisionSnapshot(
        creado_en=ahora,
        fecha=fecha,
        origen=origen,
        symbol=symbol,
        accion=accion,
        score=datos.numero(senal.get("score")),
        precio=datos.precio(precio.get("last")),
        # Los universos de la lista diaria cotizan todos en dólares: lo fija
        # `test_todos_los_universos_de_la_lista_diaria_cotizan_en_dolares`. Si la
        # señal trae su propia moneda, manda la señal.
        moneda=precio.get("currency") or "USD",
        stop=datos.precio(niveles.get("stop")),
        objetivo=datos.precio(niveles.get("objetivo")),
        peso_bruto_pct=datos.numero(niveles.get("peso_bruto_pct")),
        peso_final_pct=datos.numero(peso_final_pct),
        horizonte_dias=HORIZONTE_DIAS,
        reglas_version=version_de_reglas(),
        contexto=contexto,
        huella=_huella(contexto),
    )
    session.add(snap)
    return snap


def congelar_lista_diaria(session: Session, payload: dict, origen: str, ahora: datetime) -> dict:
    """Congela lo accionable de una lista diaria. Nunca lanza.

    Qué se congela: las ideas de la lista corta (con su tamaño final y los
    límites que se pudieron aplicar), lo que la lista corta dice evitar, y cada
    posición tuya para la que el motor dice vender o reducir. Son las
    afirmaciones del sistema que se pueden contrastar después.

    Si la escritura falla, la lista se sirve igual y el fallo queda dicho en la
    respuesta y en el registro: perder un día del forward testing es un
    problema, pero dejar al usuario sin su lista por eso sería peor.
    """
    corta = payload.get("shortlist") or {}
    sz = corta.get("sizing") or {}
    sizing_ctx = {
        k: sz.get(k)
        for k in (
            "controles", "todos_los_limites_aplicados", "recortes", "escala_aplicada",
            "vol_estimada_pct", "objetivo_vol_pct", "clusters", "cartera_actual",
            "aviso_cartera", "invertido_total_pct",
        )
    }
    mercado = {
        "market": payload.get("market"),
        "completo": payload.get("complete"),
        "puntuadas": payload.get("scored"),
        "pedidas": payload.get("requested"),
        "calibrado": payload.get("calibrated"),
        "no_disponibles": len(payload.get("unavailable") or []),
    }

    candidatas = [(s, s.get("peso_final_pct"), sizing_ctx) for s in corta.get("ideas") or []]
    candidatas += [(s, None, None) for s in corta.get("evitar") or []]
    candidatas += [
        (s, None, None)
        for s in payload.get("signals") or []
        if (s.get("decision") or {}).get("owned")
        and (s.get("decision") or {}).get("action") in ("vender", "reducir")
    ]

    guardadas, ya = 0, 0
    try:
        for senal, peso, ctx in candidatas:
            snap = congelar(
                session, senal, origen=origen, ahora=ahora,
                sizing_ctx=ctx, peso_final_pct=peso, mercado=mercado,
            )
            if snap is None:
                ya += 1
            else:
                guardadas += 1
        session.commit()
    except (IntegrityError, ValueError, TypeError) as exc:
        session.rollback()
        log("db").error("no se pudieron congelar las decisiones de %s: %s", origen, exc)
        return {"guardadas": 0, "ya_existian": ya, "error": str(exc)[:300]}
    return {"guardadas": guardadas, "ya_existian": ya, "error": None}


# --- Análisis de empresa ---------------------------------------------------
#
# Mismo registro (`DecisionSnapshot`), otro origen. La lista diaria congela la
# PRIMERA decisión del día porque es un experimento de forward testing: dejar
# que la tarde reescriba la mañana sería elegir el resultado. El análisis de una
# empresa es otra cosa —es lo que tú abriste y leíste— y se congela cada vez que
# lo que el sistema sabe CAMBIA de forma material: otra decisión, un filing
# nuevo, una tesis editada. Si solo se ha movido el precio, no hay instantánea
# nueva: sería ruido con forma de registro.

ORIGEN_ANALISIS = "analisis"


def huella_material(analisis: dict) -> str:
    """Lo que, si cambia, merece una instantánea nueva. El precio no está."""
    d = analisis.get("decision") or {}
    fund = analisis.get("fundamentales") or {}
    tesis = analisis.get("tesis") or {}
    pos = analisis.get("posicion") or {}
    score = datos.numero((analisis.get("senal") or {}).get("score"))
    return _huella({
        "esquema": analisis.get("esquema"),
        "accion": d.get("action"),
        "reglas": {r.get("id"): r.get("resultado") for r in d.get("reglas") or []},
        "fundamentales": {
            k: (round(v["valor"], 6) if isinstance(v.get("valor"), (int, float)) else None)
            for k, v in (fund.get("metricas") or {}).items()
        },
        "trimestre": (fund.get("trimestre") or {}).get("periodo"),
        "tesis": [tesis.get("estado"), tesis.get("cuerpo_sha256"),
                  [(x.get("id"), x.get("salta"), x.get("medible")) for x in tesis.get("disparadores") or []]],
        "senal": round(score, 2) if score is not None else None,
        "posicion": [pos.get("quantity"), pos.get("cost_basis"), pos.get("stop")],
        **{k: analisis.get(k, {}).get("huella") for k in ("calidad", "expectativas", "riesgo")
           if isinstance(analisis.get(k), dict)},
    })


def anomalias_temporales(marcas: list[dict], decision_ts) -> dict:
    """Comprueba cada marca contra el momento de la decisión. No modifica nada."""
    futuras, sin_fecha = [], []
    for m in marcas or []:
        r = pit.disponible_en(m.get("publicado"), decision_ts, m.get("obtenido_en"))
        if r is False:
            futuras.append(m)
        elif r is None:
            sin_fecha.append(m)
    return {"futuras": futuras, "sin_fecha_verificable": sin_fecha}


def congelar_analisis(session: Session, analisis: dict, ahora: datetime) -> tuple[DecisionSnapshot, bool]:
    """(instantánea, ¿es nueva?). Hace commit: el análisis se congela entero o nada.

    Si la última instantánea de análisis de hoy tiene la misma huella material,
    se devuelve esa y no se crea otra: abrir la misma empresa diez veces en una
    tarde no son diez decisiones.
    """
    limpio = _limpio({k: v for k, v in analisis.items() if not str(k).startswith("_")})
    huella_m = huella_material(limpio)
    symbol = limpio["symbol"]
    fecha = ahora.astimezone(timezone.utc).date().isoformat()

    ultimo = session.execute(
        select(DecisionSnapshot)
        .where(DecisionSnapshot.symbol == symbol, DecisionSnapshot.origen.like(f"{ORIGEN_ANALISIS}:%"))
        .order_by(DecisionSnapshot.creado_en.desc(), DecisionSnapshot.id.desc())
    ).scalars().first()
    if ultimo is not None and ultimo.fecha == fecha and (ultimo.contexto or {}).get("huella_material") == huella_m:
        return ultimo, False

    # Lo que llegara fechado después de la decisión se anota al congelar: la
    # instantánea guarda lo que el sistema vio, pero el replay no lo enseñará
    # como conocido.
    limpio["anomalias_temporales"] = anomalias_temporales(limpio.get("marcas"), ahora)
    d = limpio.get("decision") or {}
    niveles = d.get("levels") or {}
    precio = (limpio.get("mercado") or {}).get("precio") or {}
    contexto = {
        "esquema": limpio.get("esquema"),
        "analisis": limpio,
        "reglas": parametros_de_reglas(),
        "huella_material": huella_m,
    }
    snap = DecisionSnapshot(
        creado_en=ahora,
        fecha=fecha,
        origen=f"{ORIGEN_ANALISIS}:{ahora.astimezone(timezone.utc):%H:%M:%S}",
        symbol=symbol,
        accion=d.get("action") or "sin_datos",
        score=datos.numero((limpio.get("senal") or {}).get("score")),
        precio=datos.precio(precio.get("valor")),
        moneda=precio.get("moneda"),
        stop=datos.precio(niveles.get("stop")),
        objetivo=datos.precio(niveles.get("objetivo")),
        peso_bruto_pct=datos.numero(niveles.get("peso_bruto_pct")),
        peso_final_pct=datos.numero(((limpio.get("sizing") or {}).get("peso_final_pct"))),
        horizonte_dias=HORIZONTE_DIAS,
        reglas_version=version_de_reglas(),
        contexto=contexto,
        huella=_huella(contexto),
    )
    session.add(snap)
    try:
        session.commit()
    except IntegrityError:
        # Dos análisis de la misma empresa en el mismo segundo: el primero gana.
        session.rollback()
        existente = session.execute(
            select(DecisionSnapshot).where(
                DecisionSnapshot.symbol == symbol, DecisionSnapshot.fecha == fecha,
                DecisionSnapshot.origen == snap.origen,
            )
        ).scalars().first()
        return existente, False
    return snap, True


def anterior_comparable(session: Session, snap_o_symbol, antes_de: datetime | None = None) -> DecisionSnapshot | None:
    """La instantánea de análisis anterior con el MISMO esquema. Las de la lista
    diaria solo traen la señal: no son comparables con un análisis completo."""
    if isinstance(snap_o_symbol, DecisionSnapshot):
        symbol, antes_de, excluir = snap_o_symbol.symbol, snap_o_symbol.creado_en, snap_o_symbol.id
    else:
        symbol, excluir = snap_o_symbol, None
    q = (
        select(DecisionSnapshot)
        .where(DecisionSnapshot.symbol == symbol, DecisionSnapshot.origen.like(f"{ORIGEN_ANALISIS}:%"))
        .order_by(DecisionSnapshot.creado_en.desc(), DecisionSnapshot.id.desc())
    )
    for s in session.execute(q).scalars():
        if excluir is not None and s.id == excluir:
            continue
        if antes_de is not None and pit.disponible_en(s.creado_en, antes_de) is False:
            continue
        if (s.contexto or {}).get("esquema") == ESQUEMA_ANALISIS:
            return s
    return None


ESQUEMA_ANALISIS = 2


# --- Replay ------------------------------------------------------------------


SECCIONES_ANALISIS = (
    "mercado", "fundamentales", "valoracion", "tesis", "noticias", "senal",
    "posicion", "decision", "sizing", "riesgo", "calidad", "expectativas", "confianza",
)


def reproducir(snap: DecisionSnapshot, resultados: list[DecisionOutcome] | None = None) -> dict:
    """«¿Qué sabía el sistema en ese momento?», SOLO con lo congelado.

    No consulta nada actual: ni precios, ni fundamentales, ni la tesis de hoy.
    Y antes de enseñar nada aplica la regla común: lo que esté fechado después
    del momento de la decisión se RETIRA del replay y se lista aparte. Lo que no
    se congeló se dice que no se congeló — un replay incompleto que lo admite es
    un registro; uno que rellena los huecos con lo de hoy es una reconstrucción
    con sesgo de anticipación.
    """
    base = reconstruir(snap, resultados)
    ctx = snap.contexto or {}
    if ctx.get("esquema") != ESQUEMA_ANALISIS or not isinstance(ctx.get("analisis"), dict):
        return {
            **base,
            "esquema": ctx.get("esquema", 1),
            "completo": False,
            "secciones": {
                "decision": {"accion": snap.accion, "razones": base["razones"],
                             "reglas": (ctx.get("senal") or {}).get("decision", {}).get("reglas")},
                "senal": {"score": snap.score},
                "mercado": {"precio": base["precio"]},
            },
            "no_congelado": [s for s in SECCIONES_ANALISIS if s not in ("decision", "senal", "mercado")],
            "nota": (
                "Esta instantánea es de la lista diaria y solo congeló la señal, el "
                "precio y el tamaño. Fundamentales, valoración, tesis y noticias de "
                "aquel momento NO se guardaron, y no se rellenan con los de hoy."
            ),
        }

    import copy

    a = copy.deepcopy(ctx["analisis"])
    momento = snap.creado_en
    revision = anomalias_temporales(a.get("marcas"), momento)
    futuras = {m.get("dato") for m in revision["futuras"]}
    retirado = _retirar_futuro(a, futuras, momento)

    no_congelado = [s for s in SECCIONES_ANALISIS if s not in a or a.get(s) is None]
    incompletas = [
        s for s in SECCIONES_ANALISIS
        if isinstance(a.get(s), dict) and a[s].get("estado") in ("desconocido", "error")
    ]
    return {
        **base,
        "esquema": ESQUEMA_ANALISIS,
        "momento": momento.isoformat() if momento else None,
        "secciones": {s: a.get(s) for s in SECCIONES_ANALISIS},
        "faltaban": a.get("faltan") or [],
        "versiones": {"reglas": snap.reglas_version, "esquema": ctx.get("esquema"),
                      "generado_por": a.get("generado_por")},
        "proteccion_anticipacion": {
            "regla": "information_available_at <= decision_timestamp",
            "marcas_comprobadas": len(a.get("marcas") or []),
            "retiradas_por_fecha_futura": retirado,
            "sin_fecha_verificable": [m.get("dato") for m in revision["sin_fecha_verificable"]],
            "nota": (
                "Los datos sin fecha verificable estaban DENTRO de la instantánea al "
                "congelarse (la huella lo garantiza), así que el sistema los tenía; lo "
                "que no se puede probar es cuándo se publicaron."
            ),
        },
        "no_congelado": no_congelado,
        "incompletas": incompletas,
        "completo": not no_congelado and not incompletas and not retirado and base["integridad"]["huella_coincide"],
    }


def _retirar_futuro(a: dict, futuras: set[str], momento) -> list[str]:
    """Quita del documento lo fechado después de la decisión. Devuelve qué quitó."""
    retirado: list[str] = []
    noticias = a.get("noticias") or {}
    if noticias.get("items"):
        quedan = []
        for n in noticias["items"]:
            if pit.disponible_en(n.get("published_at"), momento, noticias.get("obtenido_en")) is False:
                retirado.append(f"noticia: {(n.get('headline') or '')[:60]}")
            else:
                quedan.append(n)
        noticias["items"] = quedan
    fund = a.get("fundamentales") or {}
    for clave, m in (fund.get("metricas") or {}).items():
        afectadas = [n for n in futuras if n == clave or n.startswith(f"{clave}:")]
        if afectadas:
            fund["metricas"][clave] = {
                "valor": None, "estado": "excluido_por_fecha",
                "motivo": "una de sus entradas se publicó después de la decisión",
            }
            retirado.append(clave)
    precio = (a.get("mercado") or {}).get("precio") or {}
    if "precio" in futuras and precio:
        a["mercado"]["precio"] = {"valor": None, "estado": "excluido_por_fecha",
                                   "motivo": "cotización fechada después de la decisión"}
        retirado.append("precio")
    if "puntuación" in futuras and a.get("senal"):
        a["senal"] = {"estado": "excluido_por_fecha", "score": None,
                      "motivo": "la puntuación es de una lista posterior a la decisión"}
        retirado.append("puntuación")
    return retirado


# --- Reconstruir -----------------------------------------------------------


def reconstruir(snap: DecisionSnapshot, resultados: list[DecisionOutcome] | None = None) -> dict:
    """«¿Por qué el sistema dijo esto aquel día?», solo con lo congelado."""
    ctx = snap.contexto or {}
    senal = ctx.get("senal") or {}
    decision = senal.get("decision") or {}
    precio = senal.get("price") or {}
    integra = _huella(ctx) == snap.huella
    return {
        "id": snap.id,
        "fecha": snap.fecha,
        "creado_en": snap.creado_en.isoformat() if snap.creado_en else None,
        "origen": snap.origen,
        "symbol": snap.symbol,
        "accion": snap.accion,
        "score": snap.score,
        "precio": {
            "valor": snap.precio,
            "moneda": snap.moneda,
            "fuente": precio.get("source"),
            "fecha": precio.get("as_of"),
            "estado": precio.get("estado"),
        },
        "razones": decision.get("reasons") or [],
        "disparadores": decision.get("triggers") or [],
        "faltaban": decision.get("faltan") or [],
        "confianza": decision.get("confidence"),
        "niveles": {"stop": snap.stop, "objetivo": snap.objetivo},
        "tamano": {
            "peso_bruto_pct": snap.peso_bruto_pct,
            "peso_final_pct": snap.peso_final_pct,
            "limites": (ctx.get("sizing") or {}).get("controles"),
            "todos_los_limites_aplicados": (ctx.get("sizing") or {}).get("todos_los_limites_aplicados"),
        },
        "mercado": ctx.get("mercado"),
        "reglas_version": snap.reglas_version,
        "horizonte_dias": snap.horizonte_dias,
        "integridad": {
            "huella_coincide": integra,
            "nota": None if integra else (
                "El contenido NO coincide con su huella: esta instantánea se ha "
                "modificado después de congelarse. No es fiable como registro."
            ),
        },
        "resultados": [
            {
                "evaluado_en": r.evaluado_en.isoformat() if r.evaluado_en else None,
                "dias": r.dias,
                "precio": r.precio,
                "retorno_pct": r.retorno_pct,
                "estado": r.estado,
            }
            for r in (resultados or [])
        ],
    }


# --- Medir después ---------------------------------------------------------


def evaluar_resultado(snap: DecisionSnapshot, cierres: list[tuple[date, float]], hoy: date) -> dict:
    """Qué pasó desde la instantánea. Puro: no toca la base.

    Para una compra: el primer cierre que toca el stop o el objetivo cierra la
    cuenta; si no, al llegar al horizonte se cierra con el último cierre; antes,
    está «abierta». Se usan cierres, no mínimos intradía, porque es lo que el
    histórico gratuito trae; se dice en `detalle`.

    Para vender, reducir o evitar: se mide qué hizo el precio después. Una
    caída es un acierto de esas decisiones; por eso el retorno se da tal cual y
    `a_favor` dice en qué dirección cuenta.
    """
    inicio = date.fromisoformat(snap.fecha)
    limite = inicio + timedelta(days=snap.horizonte_dias)
    posteriores = sorted(
        (d, datos.precio(c)) for d, c in cierres if d > inicio and datos.precio(c) is not None
    )
    base = datos.precio(snap.precio)
    detalle = {"base": "cierres diarios, no mínimos ni máximos intradía"}
    if base is None or not posteriores:
        return {"estado": "sin_datos", "precio": None, "retorno_pct": None,
                "dias": (hoy - inicio).days, "detalle": detalle}

    compra = snap.accion == "comprar"
    for d, c in posteriores:
        if d > limite:
            break
        if compra and snap.stop and c <= snap.stop:
            return _cierre("stop", d, c, base, inicio, detalle, compra)
        if compra and snap.objetivo and c >= snap.objetivo:
            return _cierre("objetivo", d, c, base, inicio, detalle, compra)

    dentro = [(d, c) for d, c in posteriores if d <= limite]
    ultimo_d, ultimo_c = dentro[-1] if dentro else posteriores[0]
    estado = "horizonte" if hoy >= limite else "abierta"
    return _cierre(estado, ultimo_d, ultimo_c, base, inicio, detalle, compra)


def _cierre(estado, d, c, base, inicio, detalle, compra) -> dict:
    retorno = (c / base - 1) * 100
    return {
        "estado": estado,
        "precio": c,
        "retorno_pct": round(retorno, 2),
        "dias": (d - inicio).days,
        "detalle": {**detalle, "fecha_precio": d.isoformat(),
                    "a_favor": "subida" if compra else "bajada"},
    }


CERRADOS = {"stop", "objetivo", "horizonte"}


def registrar_resultado(session: Session, snap: DecisionSnapshot, resultado: dict, ahora: datetime) -> DecisionOutcome | None:
    """Añade una fila de resultado. Nunca modifica una anterior.

    No añade nada si la instantánea ya está cerrada (stop, objetivo u
    horizonte), ni más de una fila «abierta» por día.
    """
    previos = session.execute(
        select(DecisionOutcome).where(DecisionOutcome.snapshot_id == snap.id)
        .order_by(DecisionOutcome.evaluado_en)
    ).scalars().all()
    if any(p.estado in CERRADOS for p in previos):
        return None
    hoy = ahora.date()
    if resultado["estado"] in ("abierta", "sin_datos") and any(
        p.evaluado_en and p.evaluado_en.date() == hoy for p in previos
    ):
        return None
    fila = DecisionOutcome(
        snapshot_id=snap.id,
        evaluado_en=ahora,
        dias=resultado["dias"],
        precio=resultado["precio"],
        retorno_pct=resultado["retorno_pct"],
        estado=resultado["estado"],
        detalle=resultado["detalle"],
    )
    session.add(fila)
    return fila
