"""Expectativas frente a realidad: la parte pura, sin base de datos ni red.

Tres preguntas, por orden:

1. **¿Se cumplió lo que se esperaba?** Métrica a métrica y fuente a fuente. El
   consenso, el guidance de la dirección, el modelo interno, las reglas de la
   tesis y lo que anote el usuario NO se mezclan nunca: cada uno tiene su propia
   lectura y su propia calibración.
2. **¿Fue mejor o peor, en conjunto?** No basta con «batió o no batió». Batir
   en ingresos con el margen por debajo y el guidance a la baja no es un buen
   trimestre: es uno MIXTO, y se dice.
3. **¿Qué le pasó a la tesis?** Cada punto vigilado queda confirmado, debilitado,
   invalidado o sin resolver.

Y una cuarta, a lo largo del tiempo: **¿acierta quien espera?** Error medio,
sesgo y qué métricas y empresas se prevén peor.

La regla anti-anticipación es la común (`punto_en_el_tiempo`) y se aplica sobre
`registrado_en`, que es la única prueba que tiene el sistema de cuándo conoció
una expectativa. Lo que la fuente dice de sí misma (`informacion_hasta`) se
guarda, pero no prueba nada.
"""

from __future__ import annotations

import re
import statistics
from datetime import date, datetime, timedelta, timezone

from app import datos
from app import punto_en_el_tiempo as pit
from app.etiquetas import etiqueta
from app.formato import fmt_num

# --- Métricas y tolerancias ----------------------------------------------------
#
# Dentro de la tolerancia, el resultado está «en línea». Relativa para importes
# (1 % de ingresos), absoluta para márgenes (medio punto). Son convenciones y
# viajan en cada lectura.
METRICAS = {
    "revenue": {"etiqueta": "Ingresos", "unidad": "USD", "tolerancia": ("relativo", 0.01)},
    "eps_diluted": {"etiqueta": "BPA diluido", "unidad": "USD/acción", "tolerancia": ("relativo", 0.02)},
    "gross_margin": {"etiqueta": "Margen bruto", "unidad": "fracción", "tolerancia": ("absoluto", 0.005)},
    "operating_margin": {"etiqueta": "Margen operativo", "unidad": "fracción", "tolerancia": ("absoluto", 0.005)},
    "net_income": {"etiqueta": "Beneficio neto", "unidad": "USD", "tolerancia": ("relativo", 0.03)},
    "fcf": {"etiqueta": "Flujo de caja libre", "unidad": "USD", "tolerancia": ("relativo", 0.05)},
}
TOLERANCIA_POR_DEFECTO = ("relativo", 0.02)

# Prioridad de fuentes para la lectura de CONJUNTO, métrica a métrica: la
# primera que tenga expectativa válida para esa métrica decide. Las demás se
# enseñan igual, cada una en su columna; solo no votan dos veces.
PRIORIDAD_FUENTES = ("consenso", "guidance", "usuario", "modelo_interno")

SUPERA, EN_LINEA, POR_DEBAJO = "supera", "en_linea", "por_debajo"
CUMPLE, NO_CUMPLE, DESCONOCIDO = "cumple", "no_cumple", "desconocido"

MEJORA, DETERIORO, NEUTRAL, MIXTO = "mejora_fundamental", "deterioro", "neutral", "mixto"


def _tolerancia(metrica: str) -> tuple[str, float]:
    return (METRICAS.get(metrica) or {}).get("tolerancia", TOLERANCIA_POR_DEFECTO)


OPS = {"gte": lambda v, u: v >= u, "gt": lambda v, u: v > u,
       "lte": lambda v, u: v <= u, "lt": lambda v, u: v < u}


# --- Una métrica ----------------------------------------------------------------


def comparar_metrica(exp: dict, real: float | None) -> dict:
    """Lo esperado frente a lo real. Sin real, `desconocido`: nunca un cero."""
    metrica = exp.get("metrica")
    base = {
        "metrica": metrica,
        "etiqueta": (METRICAS.get(metrica) or {}).get("etiqueta", metrica),
        "fuente_tipo": exp.get("fuente_tipo"),
        "fuente": exp.get("fuente"),
        "esperado": {k: exp.get(k) for k in ("valor", "bajo", "alto", "operador")},
        "real": real,
        "unidad": exp.get("unidad"),
    }
    real = datos.numero(real)
    if real is None:
        return {**base, "lectura": DESCONOCIDO, "motivo": "sin resultado real para esta métrica"}

    op = exp.get("operador")
    if op in OPS:
        umbral = datos.numero(exp.get("valor"))
        if umbral is None:
            return {**base, "lectura": DESCONOCIDO, "motivo": "umbral ilegible"}
        return {**base, "lectura": CUMPLE if OPS[op](real, umbral) else NO_CUMPLE,
                "distancia": round(real - umbral, 6)}

    tipo, tol = _tolerancia(metrica)
    bajo, alto, punto = (datos.numero(exp.get(k)) for k in ("bajo", "alto", "valor"))
    if punto is None and bajo is not None and alto is not None:
        if bajo <= real <= alto:
            return {**base, "lectura": EN_LINEA, "sorpresa": 0.0, "tipo_sorpresa": "dentro del rango",
                    "tolerancia": {"tipo": "rango"}}
        referencia = alto if real > alto else bajo
    else:
        referencia = punto if punto is not None else (bajo if bajo is not None else alto)
    if referencia is None:
        return {**base, "lectura": DESCONOCIDO, "motivo": "expectativa sin cifra"}

    if tipo == "relativo" and referencia > 0:
        sorpresa = real / referencia - 1
        tipo_s = "relativa"
    else:
        # Con una referencia negativa o cero, un porcentaje no significa nada
        # (batir un BPA de −0,10 con −0,05 sería «−50 %»). Se da la diferencia.
        sorpresa = real - referencia
        tipo_s = "absoluta" if tipo == "absoluto" else "absoluta (referencia no positiva)"
    umbral = tol if tipo_s != "absoluta (referencia no positiva)" else abs(referencia) * tol
    lectura = EN_LINEA if abs(sorpresa) <= umbral else SUPERA if sorpresa > 0 else POR_DEBAJO
    return {**base, "lectura": lectura, "sorpresa": round(sorpresa, 6), "tipo_sorpresa": tipo_s,
            "tolerancia": {"tipo": tipo, "valor": tol}}


# --- El evento entero --------------------------------------------------------------


def corte_del_evento(evento: dict, reales: list[dict]) -> str | None:
    """Desde cuándo se CONOCE el resultado: la fecha prevista o la primera
    publicación de un dato real, lo que llegue antes."""
    fechas = [evento.get("fecha_prevista")] + [r.get("publicado") for r in reales]
    fechas = [str(f)[:10] for f in fechas if f]
    return min(fechas) if fechas else None


def validez_temporal(exp: dict, corte: str | None) -> dict:
    """¿Se registró esta expectativa ANTES de que se conociera el resultado?

    Se mira `registrado_en`, no lo que la fuente diga de sí misma. El mismo día
    del evento no basta: los resultados se publican antes de abrir o después de
    cerrar y una fecha no dice cuál.
    """
    if corte is None:
        return {"valida": True, "motivo": "evento sin fecha conocida todavía"}
    conocido = pit.disponible_en(corte, exp.get("registrado_en"))
    if conocido is False:
        return {"valida": True}
    if conocido is None:
        return {"valida": False, "motivo": f"registrada el mismo día del evento ({corte}) o sin fecha: no se puede probar que fuera antes"}
    return {"valida": False, "motivo": f"registrada después de conocerse el resultado ({corte})"}


def evaluar_evento(evento: dict, expectativas: list[dict], reales: list[dict], tesis: list[dict] | None = None) -> dict:
    """Lectura completa de un evento, separada por fuente."""
    corte = corte_del_evento(evento, reales)
    por_metrica_real = {}
    for r in sorted(reales, key=lambda r: str(r.get("publicado"))):
        por_metrica_real.setdefault(r["metrica"], r)  # la publicación PRIMERA manda
    guidance = (por_metrica_real.get("guidance") or {}).get("detalle") or {}

    por_fuente: dict[str, list[dict]] = {}
    excluidas = []
    for e in expectativas:
        v = validez_temporal(e, corte)
        if not v["valida"]:
            excluidas.append({"metrica": e.get("metrica"), "fuente_tipo": e.get("fuente_tipo"),
                              "fuente": e.get("fuente"), "motivo": v["motivo"]})
            continue
        if e.get("fuente_tipo") == "reglas":
            continue  # las reglas de la tesis se leen en `impacto_en_tesis`
        real = (por_metrica_real.get(e.get("metrica")) or {}).get("valor")
        por_fuente.setdefault(e["fuente_tipo"], []).append(comparar_metrica(e, real))

    lectura = clasificar(por_fuente, guidance.get("direccion"))
    validas_reglas = [e for e in expectativas if e.get("fuente_tipo") == "reglas"
                      and validez_temporal(e, corte)["valida"]]
    return {
        "evento": evento,
        "corte": corte,
        "por_fuente": por_fuente,
        "excluidas_por_fecha": excluidas,
        "reales": list(por_metrica_real.values()),
        "guidance": guidance.get("direccion"),
        "guidance_detalle": guidance or None,
        **lectura,
        "impacto_en_tesis": impacto_en_tesis(validas_reglas, por_metrica_real, tesis or []),
        "generado_por": "app",
    }


def clasificar(por_fuente: dict[str, list[dict]], direccion_guidance: str | None) -> dict:
    """Mejora, deterioro, neutral, mixto o desconocido — con la regla escrita.

    Por cada métrica vota UNA fuente (la primera de `PRIORIDAD_FUENTES` con
    lectura conocida). Supera suma a favor; por debajo, en contra. El guidance
    a la baja cuenta en contra y al alza a favor. Si hay votos en las dos
    direcciones, el resultado es MIXTO: no se compensan.
    """
    votos: dict[str, dict] = {}
    for fuente in PRIORIDAD_FUENTES:
        for c in por_fuente.get(fuente) or []:
            if c["lectura"] != DESCONOCIDO and c["metrica"] not in votos:
                votos[c["metrica"]] = c
    a_favor = [f"{c['etiqueta']} supera ({etiqueta(c['fuente_tipo'])})" for c in votos.values() if c["lectura"] == SUPERA]
    en_contra = [f"{c['etiqueta']} por debajo ({etiqueta(c['fuente_tipo'])})" for c in votos.values() if c["lectura"] == POR_DEBAJO]
    if direccion_guidance == "sube":
        a_favor.append("guidance al alza")
    elif direccion_guidance == "baja":
        en_contra.append("guidance a la baja")
    elif direccion_guidance == "mixta":
        a_favor.append("guidance al alza en alguna métrica")
        en_contra.append("guidance a la baja en otra")

    esperadas = {c["metrica"] for lista in por_fuente.values() for c in lista}
    sin_real = sorted(esperadas - set(votos))
    if not votos and direccion_guidance is None:
        clasificacion = DESCONOCIDO
    elif a_favor and en_contra:
        clasificacion = MIXTO
    elif a_favor:
        clasificacion = MEJORA
    elif en_contra:
        clasificacion = DETERIORO
    else:
        clasificacion = NEUTRAL
    return {
        "clasificacion": clasificacion,
        "a_favor": a_favor,
        "en_contra": en_contra,
        "parcial": bool(sin_real),
        "sin_resultado": sin_real,
        "regla_clasificacion": (
            "una fuente vota por métrica (consenso > guidance > usuario > modelo interno); "
            "votos en las dos direcciones = MIXTO, sin compensar"
        ),
    }


def impacto_en_tesis(reglas: list[dict], reales: dict[str, dict], tesis: list[dict]) -> list[dict]:
    """Cada punto vigilado: confirmado, debilitado, invalidado o sin resolver.

    `reglas` son expectativas con operador (lo que la tesis exige, p. ej.
    margen operativo ≥ 18 %). Debilitado = se cumple, pero el trimestre real está
    al menos un punto MÁS CERCA del umbral que el último conocido al registrarla.
    """
    salida = []
    for e in reglas:
        real = (reales.get(e.get("metrica")) or {}).get("valor")
        c = comparar_metrica(e, real)
        detalle = e.get("detalle") or {}
        estado = {"cumple": "confirmado", "no_cumple": "invalidado"}.get(c["lectura"], "sin_resolver")
        previo, umbral = datos.numero(detalle.get("valor_previo")), datos.numero(e.get("valor"))
        if estado == "confirmado" and previo is not None and umbral is not None and real is not None:
            if abs(previo - umbral) - abs(real - umbral) >= 0.01:
                estado = "debilitado"
        salida.append({"punto": detalle.get("descripcion") or e.get("fuente"), "metrica": e.get("metrica"),
                       "estado": estado, "real": real, "umbral": umbral, "operador": e.get("operador"),
                       "previo": previo})
    medidos = {e.get("detalle", {}).get("trigger_id") for e in reglas}
    for t in tesis:
        if t.get("id") not in medidos:
            salida.append({"punto": t.get("descripcion"), "metrica": None, "estado": "sin_resolver",
                           "motivo": "no se puede medir con los resultados del trimestre (p. ej. noticias o crecimiento plurianual)"})
    return salida


# --- Modelo interno ---------------------------------------------------------------


def _fin(q: dict) -> date | None:
    try:
        return date.fromisoformat(str(q.get("end_date"))[:10])
    except ValueError:
        return None


def estimacion_interna(trimestres: list[dict], fin_objetivo: str) -> list[dict]:
    """Lo que la app espera de un trimestre, con su método. Determinista e ingenuo.

    - Ingresos y BPA: el mismo trimestre del año anterior × (1 + la mediana del
      crecimiento interanual de los últimos cuatro trimestres).
    - Márgenes: la media de los últimos cuatro trimestres.

    No pretende ser una previsión buena: pretende ser una vara FIJA contra la que
    medir. Su calibración dice cuánto vale.
    """
    try:
        objetivo = date.fromisoformat(fin_objetivo)
    except (TypeError, ValueError):
        return []
    previos = sorted((q for q in trimestres if _fin(q) and _fin(q) < objetivo), key=_fin)
    if not previos:
        return []

    def hace_un_ano(fin: date) -> dict | None:
        return next((q for q in reversed(previos) if 350 <= (fin - _fin(q)).days <= 380), None)

    def yoy(campo: str) -> list[float]:
        out = []
        for q in previos[-4:]:
            p = hace_un_ano(_fin(q))
            v, vp = datos.numero(q.get(campo)), datos.numero((p or {}).get(campo))
            if v is not None and vp and vp > 0:
                out.append(v / vp - 1)
        return out

    estimaciones = []
    base = hace_un_ano(objetivo)
    for campo in ("revenue", "eps_diluted"):
        crec = yoy(campo)
        vb = datos.numero((base or {}).get(campo))
        if base is None or vb is None or vb <= 0 or not crec:
            continue
        g = statistics.median(crec)
        estimaciones.append({
            "metrica": campo, "valor": round(vb * (1 + g), 6), "unidad": METRICAS[campo]["unidad"],
            "detalle": {"metodo": "mismo trimestre del año anterior × (1 + mediana del crecimiento interanual de los últimos 4 trimestres)",
                        "base": {"periodo": base.get("periodo"), "valor": vb},
                        "crecimiento_mediano": round(g, 6), "observaciones": len(crec)},
        })
    for campo, num in (("gross_margin", "gross_profit"), ("operating_margin", "operating_income")):
        margenes = [datos.numero(q.get(num)) / datos.numero(q.get("revenue"))
                    for q in previos[-4:]
                    if datos.numero(q.get(num)) is not None and datos.numero(q.get("revenue"))]
        if len(margenes) >= 2:
            estimaciones.append({
                "metrica": campo, "valor": round(sum(margenes) / len(margenes), 6), "unidad": "fracción",
                "detalle": {"metodo": f"media de los últimos {len(margenes)} trimestres",
                            "valores": [round(m, 6) for m in margenes]},
            })
    return estimaciones


# --- Guidance extraído (IA) a métricas canónicas -----------------------------------

_SINONIMOS = {
    "revenue": ("ingreso", "revenue", "ventas", "net sales", "sales"),
    "eps_diluted": ("eps", "bpa", "beneficio por acción", "earnings per share"),
    "gross_margin": ("margen bruto", "gross margin"),
    "operating_margin": ("margen operativo", "operating margin"),
}
_ORDINALES = {"primer": 1, "primero": 1, "segundo": 2, "tercer": 3, "tercero": 3, "cuarto": 4,
              "first": 1, "second": 2, "third": 3, "fourth": 4}


def metrica_canonica(texto: str | None) -> str | None:
    t = (texto or "").lower()
    if "margen" in t or "margin" in t:
        for clave in ("gross_margin", "operating_margin"):
            if any(s in t for s in _SINONIMOS[clave]):
                return clave
        return None
    for clave in ("eps_diluted", "revenue"):
        for s in _SINONIMOS[clave]:
            # Por inicio de palabra («ingreso» casa con «ingresos»); las siglas
            # cortas, enteras («eps» no debe casar con «epsilon»).
            fin = r"(\W|$)" if len(s) <= 3 else ""
            if re.search(rf"(^|\W){re.escape(s)}{fin}", t):
                return clave
    return None


def periodo_canonico(texto: str | None) -> str | None:
    """«Q3 2026», «2026 Q3», «T3 2026», «tercer trimestre de 2026» → «2026-Q3»."""
    t = (texto or "").lower()
    ano = re.search(r"(20\d\d)", t)
    if not ano:
        return None
    q = re.search(r"\b(?:q|t)\s*([1-4])\b", t) or re.search(r"\b([1-4])\s*(?:q|t)\b", t)
    if q:
        return f"{ano.group(1)}-Q{q.group(1)}"
    for palabra, n in _ORDINALES.items():
        if re.search(rf"\b{palabra}\b", t) and ("trimestre" in t or "quarter" in t):
            return f"{ano.group(1)}-Q{n}"
    return None


def valor_en_unidad(valor, unidad: str | None, metrica: str) -> float | None:
    v = datos.numero(valor)
    if v is None:
        return None
    u = (unidad or "").lower()
    if metrica in ("gross_margin", "operating_margin"):
        return v / 100 if "%" in u or v > 1 else v
    if "miles de millones" in u or "billion" in u or re.search(r"\bbn\b|\bmmm\b", u):
        return v * 1e9
    if "millones" in u or "million" in u or re.search(r"\bmm\b|\bm\b", u):
        return v * 1e6
    return v


# --- Escala del dato ------------------------------------------------------------------
#
# Un consenso o un guidance en otra escala (miles frente a unidades, céntimos
# frente a dólares, «billion» leído como «million») no es una expectativa: es un
# error de unidades que la lectura convertiría en una «sorpresa» del ±99 % y que
# envenenaría la calibración de la fuente. Antes de registrarlo se compara con el
# último trimestre conocido de la misma métrica. Las bandas son anchas a
# propósito: detectan escalas, no juzgan previsiones.
ESCALA_PLAUSIBLE = {"revenue": (0.2, 5.0), "eps_diluted": (0.02, 50.0)}


def comprobar_escala(x: dict, trimestres: list[dict]) -> dict:
    """¿Está la cifra en la escala de lo último publicado? → `ok`, `dudosa` o
    `sin_referencia` (sin trimestre comparable, o un BPA con signo que no se
    puede comparar: un BPA que pasa de pérdida a beneficio es legítimo)."""
    metrica = x.get("metrica")
    banda = ESCALA_PLAUSIBLE.get(metrica)
    if banda is None:
        return {"estado": "sin_referencia", "motivo": "métrica sin banda de escala"}
    bajo, alto = datos.numero(x.get("bajo")), datos.numero(x.get("alto"))
    cifra = datos.numero(x.get("valor"))
    if cifra is None:
        cifra = (bajo + alto) / 2 if bajo is not None and alto is not None else (bajo if bajo is not None else alto)
    if cifra is None:
        return {"estado": "sin_referencia", "motivo": "sin cifra"}
    if metrica == "revenue" and cifra <= 0:
        return {"estado": "dudosa", "cifra": cifra, "motivo": "unos ingresos esperados no positivos no son una escala posible"}
    ref = next(((q, v) for q in reversed(trimestres) if (v := datos.numero(q.get(metrica))) is not None), None)
    if ref is None:
        return {"estado": "sin_referencia", "cifra": cifra, "motivo": "ningún trimestre publicado con esta métrica"}
    q, v = ref
    if v <= 0 or cifra <= 0:
        return {"estado": "sin_referencia", "cifra": cifra, "referencia": v, "periodo_referencia": q.get("end_date"),
                "motivo": "con pérdidas en un lado la proporción no mide escala"}
    ratio = cifra / v
    estado = "ok" if banda[0] <= ratio <= banda[1] else "dudosa"
    r = {"estado": estado, "cifra": cifra, "referencia": v, "periodo_referencia": q.get("end_date"),
         "ratio": round(ratio, 4), "banda": list(banda)}
    if estado == "dudosa":
        r["motivo"] = (f"{fmt_num(cifra, 4, ceros=False)} frente a {fmt_num(v, 4, ceros=False)} del trimestre "
                       f"cerrado el {q.get('end_date')} ({fmt_num(ratio, 0 if abs(ratio) >= 100 else 2, ceros=False)} veces, fuera de "
                       f"{fmt_num(banda[0], 2, ceros=False)}–{fmt_num(banda[1], 2, ceros=False)}): parece otra escala")
    return r


def guidance_como_expectativas(extracciones: list[dict], periodo: str) -> dict:
    """Las previsiones de la dirección para `periodo`, de extracciones ya hechas.

    Solo entran las que tienen la cita VERIFICADA en el documento. Viajan
    marcadas: las cifras las extrajo una IA; la conversión de unidades y la
    asignación a métrica y periodo las hace este código.
    """
    validas, descartadas = [], []
    for ext in extracciones:
        for g in (ext.get("datos") or {}).get("guidance") or []:
            metrica = metrica_canonica(g.get("metrica"))
            p = periodo_canonico(g.get("periodo"))
            motivo = (
                None if g.get("cita_verificada") else "cita no verificada en el documento"
            ) or (None if metrica else f"métrica no asignable: «{g.get('metrica')}»") or (
                None if p == periodo else f"periodo «{g.get('periodo')}» no es {periodo}")
            if motivo:
                descartadas.append({"metrica": g.get("metrica"), "periodo": g.get("periodo"), "motivo": motivo})
                continue
            bajo = valor_en_unidad(g.get("valor_bajo"), g.get("unidad"), metrica)
            alto = valor_en_unidad(g.get("valor_alto"), g.get("unidad"), metrica)
            if bajo is None and alto is None:
                descartadas.append({"metrica": g.get("metrica"), "periodo": g.get("periodo"), "motivo": "sin cifra"})
                continue
            validas.append({
                "metrica": metrica,
                "bajo": bajo, "alto": alto,
                "valor": bajo if bajo is not None and bajo == alto else None,
                "unidad": METRICAS[metrica]["unidad"],
                "fuente": f"{ext.get('form_type')} {ext.get('accession_no')}",
                "informacion_hasta": ext.get("filed_at"),
                "detalle": {"generado_por": "ia", "nota": "cifra extraída por IA con cita verificada; unidades y periodo asignados por código",
                            "texto_literal": g.get("texto_literal"), "unidad_original": g.get("unidad"),
                            "model": ext.get("model"), "source_url": ext.get("source_url")},
            })
    return {"expectativas": validas, "descartadas": descartadas}


# --- Calibración ---------------------------------------------------------------------


def calibrar(pares: list[dict], minimo: int = 5) -> dict:
    """¿Acierta quien espera? Por fuente, por métrica y por empresa.

    `pares`: [{symbol, metrica, fuente_tipo, esperado, real}]. `esperado` es el
    punto (o el centro del rango). El error es relativo para importes y absoluto
    para márgenes; el SESGO conserva el signo — positivo = lo real salió por
    encima de lo esperado, es decir, se esperaba de menos.
    """
    filas = []
    for p in pares:
        esp, real = datos.numero(p.get("esperado")), datos.numero(p.get("real"))
        if esp is None or real is None:
            continue
        tipo, tol = _tolerancia(p["metrica"])
        if tipo == "relativo" and esp > 0:
            err = real / esp - 1
        elif tipo == "relativo":
            continue  # error relativo sobre una base no positiva: no significa nada
        else:
            err = real - esp
        filas.append({**p, "error": err, "cerca": abs(err) <= tol})

    def resumen(grupo: list[dict]) -> dict:
        n = len(grupo)
        if not n:
            return {"n": 0}
        return {
            "n": n,
            "error_medio_abs": round(sum(abs(f["error"]) for f in grupo) / n, 6),
            "sesgo": round(sum(f["error"] for f in grupo) / n, 6),
            "cerca_pct": round(sum(f["cerca"] for f in grupo) / n, 4),
            "suficiente": n >= minimo,
        }

    por_fuente: dict[str, dict] = {}
    for fuente in sorted({f["fuente_tipo"] for f in filas}):
        de_fuente = [f for f in filas if f["fuente_tipo"] == fuente]
        metricas = {m: resumen([f for f in de_fuente if f["metrica"] == m])
                    for m in sorted({f["metrica"] for f in de_fuente})}
        empresas = {s: resumen([f for f in de_fuente if f["symbol"] == s])
                    for s in sorted({f["symbol"] for f in de_fuente})}
        por_fuente[fuente] = {
            "total": resumen(de_fuente),
            "por_metrica": metricas,
            "mejor_prevista": min(metricas, key=lambda m: metricas[m]["error_medio_abs"]) if metricas else None,
            "empresas_menos_previsibles": sorted(empresas, key=lambda s: -empresas[s]["error_medio_abs"])[:5],
            "por_empresa": empresas,
        }
    return {
        "por_fuente": por_fuente,
        "pares": len(filas),
        "nota": (
            "Cada fuente se calibra por separado: mezclar el consenso con el modelo "
            "interno daría la calibración de nadie. Con menos de "
            f"{minimo} pares, el número describe la muestra, no a la fuente."
        ),
    }


def ahora_utc() -> datetime:
    return datetime.now(timezone.utc)


def ventana(fecha: str, dias: int) -> tuple[str, str]:
    d = date.fromisoformat(fecha)
    return (d - timedelta(days=dias)).isoformat(), (d + timedelta(days=dias)).isoformat()
