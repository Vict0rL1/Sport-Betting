"""Confianza = calidad de la EVIDENCIA, no convicción de nadie.

Un «comprar» con todos los datos frescos, dos fuentes que coinciden y una
valoración que aguanta cambios de supuestos no es lo mismo que un «comprar»
sobre un precio viejo, sin el último FCF y a dos días de resultados. La señal
es la misma; lo que se sabe para respaldarla, no.

Cada factor se evalúa con una regla escrita aquí y produce `ok`, `debil`,
`critico` o `desconocido`. La regla de agregación también está escrita y no
tiene pesos escondidos:

    algún factor crítico          → BAJA
    tres o más débiles/desconoc.  → BAJA
    uno o dos débiles/desconoc.   → MEDIA
    ninguno                       → ALTA

Un factor `desconocido` cuenta como débil: no saber si la evidencia es buena no
puede contar como que lo es.

Lo que esto NO mide: si la decisión acertará. Mide si hay base para tomarla.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime

from app import datos
from app.etiquetas import etiqueta
from app.formato import fmt_fecha, fmt_num, fmt_pct, plural

OK, DEBIL, CRITICO, DESCONOCIDO = "ok", "debil", "critico", "desconocido"
ALTA, MEDIA, BAJA = "alta", "media", "baja"

# Umbrales, con nombre y discutibles.
MAX_DESCONOCIDOS_OK = 0
MAX_DESCONOCIDOS_DEBIL = 3          # más que esto ya es crítico
DIAS_TRIMESTRE_VIEJO = 135          # un 10-Q nuevo llega cada ~90 días (+45 de plazo)
DIAS_EJERCICIO_VIEJO = 455          # un 10-K cada año (+90 de plazo)
DESACUERDO_PRECIO = 0.10            # cotización vs último cierre de otra fuente
MIN_EJERCICIOS = 3
MIN_SESIONES = 200
AMPLITUD_DCF_INVERSO = 0.10         # 10 pp de crecimiento implícito entre WACC 7 % y 12 %
CERCA_UMBRAL_PUNTOS = 0.05          # a menos de esto de un umbral de puntuación
CERCA_UMBRAL_PRECIO_PCT = 1.0       # a menos de esto (%) de un umbral de precio

REGLA_AGREGACION = (
    "crítico → BAJA; ≥3 débiles o desconocidos → BAJA; 1–2 → MEDIA; ninguno → ALTA. "
    "Un factor desconocido cuenta como débil."
)


def _f(id_: str, texto: str, estado: str, detalle: str) -> dict:
    return {"id": id_, "factor": texto, "estado": estado, "detalle": detalle}


def _dias(desde, hasta: datetime) -> int | None:
    try:
        d = date.fromisoformat(str(desde)[:10])
    except ValueError:
        return None
    return (hasta.date() - d).days


def _hace(dias: int | None) -> str:
    """«hace 1 día», «hoy». Sin fecha legible se dice: antes salía «hace None días»."""
    if dias is None:
        return "en una fecha que no se pudo leer"
    return "hoy" if dias == 0 else f"hace {dias} {plural(dias, 'día', 'días')}"


def evaluar(analisis: dict, ahora: datetime) -> dict:
    a = analisis
    factores = []

    # 1) Completitud
    n = len(a.get("faltan") or [])
    factores.append(_f(
        "completitud", "Datos desconocidos en el análisis",
        OK if n <= MAX_DESCONOCIDOS_OK else DEBIL if n <= MAX_DESCONOCIDOS_DEBIL else CRITICO,
        f"{n} {plural(n, 'dato desconocido', 'datos desconocidos')}" + (": " + ", ".join(etiqueta(f["dato"]) for f in a["faltan"][:4]) if n else ""),
    ))

    # 2) Frescura del precio
    precio = (a.get("mercado") or {}).get("precio") or {}
    estado = precio.get("estado")
    factores.append(_f(
        "frescura_precio", "Precio actual",
        OK if estado == "valido" else CRITICO,
        "cotización actual" if estado == "valido" else
        "precio viejo (las fuentes fallaron)" if estado == "viejo" else "sin precio",
    ))

    # 3) Frescura de los fundamentales
    fund = a.get("fundamentales") or {}
    tri = fund.get("trimestre") or {}
    if tri.get("publicado"):
        dias = _dias(tri["publicado"], ahora)
        est = DESCONOCIDO if dias is None else OK if dias <= DIAS_TRIMESTRE_VIEJO else DEBIL
        periodo = f" ({tri['periodo']})" if tri.get("periodo") else ""
        det = f"último trimestre{periodo} publicado {_hace(dias)}"
    elif fund.get("publicado"):
        dias = _dias(fund["publicado"], ahora)
        est = DESCONOCIDO if dias is None else OK if dias <= DIAS_EJERCICIO_VIEJO else DEBIL
        cual = f"el ejercicio {fund['ejercicio']}" if fund.get("ejercicio") is not None else "un ejercicio sin año"
        det = f"solo {cual}, publicado {_hace(dias)}; sin trimestres"
    else:
        est, det = DESCONOCIDO, "sin fecha de publicación de los fundamentales"
    factores.append(_f("frescura_fundamentales", "Antigüedad de los fundamentales", est, det))

    # 4) Contraste entre proveedores: cotización frente al último cierre de otra fuente
    hist = (a.get("mercado") or {}).get("historico") or {}
    cierre = None
    if hist.get("fuente") and precio.get("fuente") and hist.get("fuente") != precio.get("fuente"):
        cierre = datos.precio(hist.get("ultimo_cierre"))
    pv = datos.numero(precio.get("valor"))
    if cierre and pv:
        dif = abs(pv / cierre - 1)
        factores.append(_f(
            "contraste_proveedores", "Acuerdo entre proveedores",
            OK if dif <= DESACUERDO_PRECIO else DEBIL,
            f"{precio['fuente']} y {hist['fuente']} difieren un {fmt_pct(dif)}",
        ))
    else:
        factores.append(_f(
            "contraste_proveedores", "Acuerdo entre proveedores", DEBIL,
            "un solo proveedor por dato: no hay contra qué contrastar",
        ))

    # 5) Histórico disponible
    ejercicios = (a.get("fundamentales") or {}).get("ejercicios_disponibles") or 0
    sesiones = hist.get("sesiones") or 0
    est = OK if ejercicios >= MIN_EJERCICIOS and sesiones >= MIN_SESIONES else (
        CRITICO if ejercicios < 2 else DEBIL
    )
    factores.append(_f("historico", "Histórico disponible", est,
                       f"{ejercicios} {plural(ejercicios, 'ejercicio', 'ejercicios')} y {sesiones} {plural(sesiones, 'sesión', 'sesiones')} de precio"))

    # 6) Sensibilidad de la valoración
    inv = (a.get("valoracion") or {}).get("dcf_inverso") or {}
    rango = inv.get("rango") or {}
    if inv.get("estado") == "valido" and rango.get("bajo") is not None and rango.get("alto") is not None:
        amplitud = rango["alto"] - rango["bajo"]
        factores.append(_f(
            "sensibilidad_valoracion", "Sensibilidad de la valoración al WACC",
            OK if amplitud <= AMPLITUD_DCF_INVERSO else DEBIL,
            f"el crecimiento implícito va de {fmt_pct(rango['bajo'])} a {fmt_pct(rango['alto'])} "
            "entre un WACC del 7 % y del 12 %",
        ))
    else:
        factores.append(_f("sensibilidad_valoracion", "Sensibilidad de la valoración al WACC",
                           DESCONOCIDO, inv.get("motivo") or "sin DCF inverso"))

    # 7) Estabilidad: ¿está la decisión al borde de un umbral?
    decision = a.get("decision") or {}
    cerca = []
    for alt in decision.get("cambiaria") or []:
        for c in alt.get("condiciones") or []:
            dist = datos.numero(c.get("distancia"))
            if dist is None:
                continue
            limite = CERCA_UMBRAL_PUNTOS if c.get("unidad") == "puntos" else CERCA_UMBRAL_PRECIO_PCT
            if abs(dist) < limite:
                cerca.append(f"{c['condicion']} (a {fmt_num(abs(dist), 3, ceros=False)} {c.get('unidad')}) → {alt['hacia']}")
    factores.append(_f(
        "estabilidad", "Distancia de la decisión a sus umbrales",
        DEBIL if cerca else OK,
        "un movimiento pequeño la cambia: " + "; ".join(cerca[:3]) if cerca else "ningún umbral al alcance de un movimiento pequeño",
    ))

    # 8) Reglas que no se pudieron evaluar
    desconocidas = [r.get("regla") for r in decision.get("reglas") or [] if r.get("resultado") == "desconocido"]
    factores.append(_f(
        "reglas_desconocidas", "Reglas del motor sin evaluar",
        DEBIL if desconocidas else OK,
        "sin evaluar: " + ", ".join(desconocidas) if desconocidas else "todas las reglas se pudieron evaluar",
    ))

    # 9) Resultados inminentes
    res = a.get("resultados_proximos")
    dias_res = _dias(ahora.date().isoformat(), datetime.fromisoformat(res + "T00:00:00+00:00")) if res else None
    factores.append(_f(
        "resultados_proximos", "Resultados inminentes",
        DEBIL if res else OK,
        f"presenta resultados en {dias_res} {plural(dias_res, 'día', 'días')} ({fmt_fecha(res)})" if res else "sin resultados en los próximos 7 días",
    ))

    # 10) Validación de las reglas
    conf = decision.get("confidence")
    factores.append(_f(
        "validacion_reglas", "Reglas validadas con histórico",
        OK if conf == "calibrada" else CRITICO if conf == "refutada" else DEBIL,
        {"calibrada": "backtest de reglas con muestra suficiente",
         "refutada": "el backtest dice que estas reglas PERDÍAN dinero",
         "sin_calibrar": "reglas razonables pero no validadas"}.get(conf, f"sin dato ({conf})"),
    ))

    criticos = [f for f in factores if f["estado"] == CRITICO]
    debiles = [f for f in factores if f["estado"] in (DEBIL, DESCONOCIDO)]
    nivel = BAJA if criticos or len(debiles) >= 3 else MEDIA if debiles else ALTA
    razones = [f["detalle"] for f in criticos + debiles]
    resultado = {
        "nivel": nivel,
        "factores": factores,
        "criticos": len(criticos),
        "debiles": len(debiles),
        "razones": razones,
        "regla": REGLA_AGREGACION,
        "generado_por": "app",
        "nota": "Mide la calidad de la evidencia que respalda la decisión, no la probabilidad de acertar.",
    }
    resultado["huella"] = hashlib.sha256(
        json.dumps([nivel, [(f["id"], f["estado"]) for f in factores]]).encode()
    ).hexdigest()[:12]
    return resultado
