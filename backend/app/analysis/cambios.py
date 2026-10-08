"""¿Qué cambió desde el último análisis? Solo lo que importa, y por qué.

Comparar dos análisis campo a campo da cientos de diferencias y ninguna
lectura: el margen pasó de 20,01 % a 20,03 %, el precio se movió un 0,4 %... El
ruido entierra lo único que importaba —que el margen cayó dos puntos y medio—.
Este módulo hace tres cosas, y las tres son deterministas:

1. **Materialidad.** Cada métrica tiene un umbral, aquí y en ningún otro sitio
   (`MATERIALIDAD`). Por debajo, el cambio se cuenta pero no se enseña.
2. **Disponibilidad.** Que un dato aparezca (antes desconocido, ahora no) o
   desaparezca (antes conocido, ahora desconocido) se enseña SIEMPRE, sea cual
   sea su tamaño: perder un dato es un deterioro, no un «sin cambios».
3. **La decisión.** Si la acción cambió, se dice qué reglas cambiaron de
   resultado, con su valor antes y ahora. La explicación sale de comparar las
   dos trazas del motor, no de un modelo de lenguaje. Un LLM puede resumir
   después ESTE diff, y entonces va marcado como IA.
"""

from __future__ import annotations

import hashlib
import json

from app import datos
from app.formato import fmt_num

# --- Umbrales de materialidad --------------------------------------------------
#
# «absoluto»: diferencia en la unidad de la métrica (0.01 = 1 punto porcentual
# para una fracción). «relativo»: cambio proporcional (0.03 = 3 %). Son
# convenciones de lectura, discutibles y ajustables aquí; viajan versionadas en
# cada comparación para que un diff de hace un año se pueda releer con los
# umbrales que tenía.
MATERIALIDAD: dict[str, dict] = {
    # Mercado
    "precio": {"categoria": "mercado", "etiqueta": "Precio", "tipo": "relativo", "umbral": 0.03, "unidad": "moneda"},
    # Valoración
    "pe": {"categoria": "valoracion", "etiqueta": "P/E", "tipo": "relativo", "umbral": 0.05, "unidad": "veces"},
    "fcf_yield": {"categoria": "valoracion", "etiqueta": "Rentabilidad por FCF", "tipo": "absoluto", "umbral": 0.005, "unidad": "fracción"},
    "dcf_inverso": {"categoria": "valoracion", "etiqueta": "Crecimiento implícito (DCF inverso, 9 %)", "tipo": "absoluto", "umbral": 0.01, "unidad": "fracción"},
    # Fundamentales
    "revenue_growth": {"categoria": "fundamentales", "etiqueta": "Crecimiento de ingresos", "tipo": "absoluto", "umbral": 0.01, "unidad": "fracción"},
    "gross_margin": {"categoria": "fundamentales", "etiqueta": "Margen bruto", "tipo": "absoluto", "umbral": 0.01, "unidad": "fracción"},
    "operating_margin": {"categoria": "fundamentales", "etiqueta": "Margen operativo", "tipo": "absoluto", "umbral": 0.01, "unidad": "fracción"},
    "net_margin": {"categoria": "fundamentales", "etiqueta": "Margen neto", "tipo": "absoluto", "umbral": 0.01, "unidad": "fracción"},
    "fcf": {"categoria": "fundamentales", "etiqueta": "Flujo de caja libre", "tipo": "relativo", "umbral": 0.05, "unidad": "USD"},
    "fcf_growth": {"categoria": "fundamentales", "etiqueta": "Crecimiento del FCF", "tipo": "absoluto", "umbral": 0.05, "unidad": "fracción"},
    "eps_diluted": {"categoria": "fundamentales", "etiqueta": "BPA diluido", "tipo": "relativo", "umbral": 0.03, "unidad": "USD/acción"},
    "deuda_neta": {"categoria": "fundamentales", "etiqueta": "Deuda neta", "tipo": "relativo", "umbral": 0.10, "unidad": "USD"},
    "trimestre_revenue_yoy": {"categoria": "fundamentales", "etiqueta": "Ingresos del trimestre (interanual)", "tipo": "absoluto", "umbral": 0.01, "unidad": "fracción"},
    "trimestre_operating_margin": {"categoria": "fundamentales", "etiqueta": "Margen operativo del trimestre", "tipo": "absoluto", "umbral": 0.01, "unidad": "fracción"},
    # Señal
    "score": {"categoria": "decision", "etiqueta": "Puntuación frente a comparables", "tipo": "absoluto", "umbral": 0.15, "unidad": "puntos"},
    # Riesgo (fase D)
    "riesgo_contribucion": {"categoria": "riesgo", "etiqueta": "Contribución al riesgo de la cartera", "tipo": "absoluto", "umbral": 0.02, "unidad": "fracción"},
    "peso_cartera": {"categoria": "riesgo", "etiqueta": "Peso en la cartera", "tipo": "absoluto", "umbral": 0.01, "unidad": "fracción"},
    "correlacion_cartera": {"categoria": "riesgo", "etiqueta": "Correlación con la cartera", "tipo": "absoluto", "umbral": 0.10, "unidad": "correlación"},
    # Resultados (fase C): sorpresa media frente a lo esperado
    "sorpresa_ingresos": {"categoria": "resultados", "etiqueta": "Sorpresa en ingresos", "tipo": "absoluto", "umbral": 0.01, "unidad": "fracción"},
}

# Cambios de categoría que se enseñan siempre que cambien (no tienen tamaño).
CATEGORICOS: dict[str, dict] = {
    "ejercicio": {"categoria": "fundamentales", "etiqueta": "Último ejercicio publicado"},
    "trimestre": {"categoria": "fundamentales", "etiqueta": "Último trimestre publicado"},
    "precio_estado": {"categoria": "mercado", "etiqueta": "Estado del precio"},
    "guidance": {"categoria": "resultados", "etiqueta": "Guidance"},
    "resultado_evento": {"categoria": "resultados", "etiqueta": "Lectura del último evento"},
    "cluster_correlacion": {"categoria": "riesgo", "etiqueta": "Clúster de correlación"},
    "calidad": {"categoria": "calidad", "etiqueta": "Calidad de beneficios"},
    "confianza": {"categoria": "decision", "etiqueta": "Confianza por evidencia"},
    "tesis_estado": {"categoria": "tesis", "etiqueta": "Estado de la tesis"},
}

CATEGORIAS = ("mercado", "valoracion", "fundamentales", "resultados", "riesgo", "calidad", "tesis", "decision")


def version_materialidad(umbrales: dict | None = None) -> str:
    texto = json.dumps(umbrales or MATERIALIDAD, sort_keys=True)
    return hashlib.sha256(texto.encode()).hexdigest()[:12]


# --- Extraer lo comparable ------------------------------------------------------


def _v(d) -> float | None:
    return datos.numero((d or {}).get("valor")) if isinstance(d, dict) else datos.numero(d)


def extraer(analisis: dict) -> dict[str, object]:
    """Las métricas comparables de un análisis, planas. None = desconocido."""
    a = analisis or {}
    m = (a.get("fundamentales") or {}).get("metricas") or {}
    tri = (a.get("fundamentales") or {}).get("trimestre") or {}
    val = a.get("valoracion") or {}
    riesgo = a.get("riesgo") or {}
    salida: dict[str, object] = {
        "precio": _v((a.get("mercado") or {}).get("precio")),
        "pe": _v(val.get("pe")),
        "fcf_yield": _v(val.get("fcf_yield")),
        "dcf_inverso": datos.numero((val.get("dcf_inverso") or {}).get("crecimiento_implicito")),
        "score": datos.numero((a.get("senal") or {}).get("score")),
        "trimestre_revenue_yoy": _v(tri.get("revenue_yoy")),
        "trimestre_operating_margin": _v(tri.get("operating_margin")),
        "riesgo_contribucion": datos.numero(riesgo.get("contribucion")),
        "peso_cartera": datos.numero(riesgo.get("peso")),
        "correlacion_cartera": datos.numero(riesgo.get("correlacion_con_cartera")),
        "sorpresa_ingresos": datos.numero(((a.get("expectativas") or {}).get("ultimo") or {}).get("sorpresa_ingresos")),
        # Categóricos
        "ejercicio": (a.get("fundamentales") or {}).get("ejercicio"),
        "trimestre": tri.get("periodo"),
        "precio_estado": ((a.get("mercado") or {}).get("precio") or {}).get("estado"),
        "guidance": ((a.get("expectativas") or {}).get("ultimo") or {}).get("guidance"),
        "resultado_evento": ((a.get("expectativas") or {}).get("ultimo") or {}).get("clasificacion"),
        "cluster_correlacion": riesgo.get("cluster_nivel"),
        "calidad": (a.get("calidad") or {}).get("global"),
        "confianza": (a.get("confianza") or {}).get("nivel"),
        "tesis_estado": (a.get("tesis") or {}).get("estado"),
    }
    for clave in ("revenue_growth", "gross_margin", "operating_margin", "net_margin",
                  "fcf", "fcf_growth", "eps_diluted", "deuda_neta"):
        salida[clave] = _v(m.get(clave))
    return salida


# --- Comparar -------------------------------------------------------------------


def _cambio_numerico(clave: str, antes, ahora, conf: dict) -> dict | None:
    base = {"clave": clave, "etiqueta": conf["etiqueta"], "unidad": conf["unidad"],
            "antes": antes, "ahora": ahora}
    if antes is None and ahora is None:
        return None
    if antes is None:
        return {**base, "tipo": "dato_nuevo", "nota": "Antes desconocido; ahora disponible."}
    if ahora is None:
        return {**base, "tipo": "dato_perdido",
                "nota": "Antes conocido; ahora DESCONOCIDO. Perder un dato es un deterioro, no un «sin cambios»."}
    absoluto = ahora - antes
    relativo = (ahora / antes - 1) if antes else None
    medida = abs(absoluto) if conf["tipo"] == "absoluto" else (abs(relativo) if relativo is not None else abs(absoluto))
    if medida < conf["umbral"]:
        return {"clave": clave, "tipo": "irrelevante"}
    return {
        **base,
        "tipo": "material",
        "absoluto": round(absoluto, 6),
        "relativo": round(relativo, 6) if relativo is not None else None,
        "direccion": "sube" if absoluto > 0 else "baja",
        "umbral": {"tipo": conf["tipo"], "valor": conf["umbral"]},
    }


def comparar(anterior: dict, actual: dict, umbrales: dict | None = None) -> dict:
    """El diff material entre dos análisis, por categorías, con su explicación."""
    umbrales = umbrales or MATERIALIDAD
    a, b = extraer(anterior), extraer(actual)
    categorias: dict[str, list[dict]] = {c: [] for c in CATEGORIAS}
    irrelevantes = 0

    for clave, conf in umbrales.items():
        c = _cambio_numerico(clave, a.get(clave), b.get(clave), conf)
        if c is None:
            continue
        if c["tipo"] == "irrelevante":
            irrelevantes += 1
            continue
        categorias[conf["categoria"]].append(c)

    for clave, conf in CATEGORICOS.items():
        antes, ahora = a.get(clave), b.get(clave)
        if antes == ahora:
            continue
        if antes is None or ahora is None:
            tipo = "dato_nuevo" if antes is None else "dato_perdido"
        else:
            tipo = "categorico"
        categorias[conf["categoria"]].append(
            {"clave": clave, "etiqueta": conf["etiqueta"], "antes": antes, "ahora": ahora, "tipo": tipo}
        )

    tesis = comparar_tesis((anterior or {}).get("tesis") or {}, (actual or {}).get("tesis") or {},
                           _impacto_nuevo(anterior, actual))
    decision = comparar_decisiones((anterior or {}).get("decision") or {}, (actual or {}).get("decision") or {},
                                   (anterior or {}).get("posicion"), (actual or {}).get("posicion"))
    total = sum(len(v) for v in categorias.values())
    return {
        "categorias": {k: v for k, v in categorias.items() if v},
        "tesis": tesis,
        "decision": decision,
        "materiales": total,
        "irrelevantes": irrelevantes,
        "umbrales": {"version": version_materialidad(umbrales), "valores": umbrales},
        "generado_por": "app",
        "nota": (
            f"{total} cambio(s) material(es) y {irrelevantes} por debajo de su umbral "
            "(se cuentan, no se enseñan). La aparición o pérdida de un dato se "
            "enseña siempre."
        ),
    }


def _impacto_nuevo(anterior: dict | None, actual: dict | None) -> list[dict]:
    """El impacto en la tesis del último evento, si es un evento NUEVO entre los
    dos análisis. La vigilancia de la tesis mira ratios ANUALES; un trimestre
    que cruza el umbral llega antes por aquí, y sin esto la pantalla decía
    «tesis intacta» al lado de una revisión que la daba por invalidada."""
    def ultimo(a):
        return ((a or {}).get("expectativas") or {}).get("ultimo") or {}
    nuevo, viejo = ultimo(actual), ultimo(anterior)
    if not nuevo or (nuevo.get("evento") or {}).get("id") == (viejo.get("evento") or {}).get("id"):
        return []
    periodo = (nuevo.get("evento") or {}).get("periodo")
    return [{**i, "periodo": periodo} for i in nuevo.get("impacto_en_tesis") or []]


def comparar_tesis(antes: dict, ahora: dict, impacto_evento: list[dict] | None = None) -> dict:
    """Puntos confirmados, deteriorados, invalidados y nuevos riesgos.

    Un punto de invalidación que SALTA es una invalidación —la que tú
    escribiste—; uno que deja de saltar vuelve a confirmarse; uno que se acerca
    a su umbral más de un punto se ha deteriorado aunque no lo cruce; y uno que
    deja de poder medirse se ha vuelto un riesgo nuevo, porque ya no vigila nada.
    """
    previos = {d.get("id"): d for d in antes.get("disparadores") or []}
    salida = {"confirmados": [], "deteriorados": [], "invalidaciones": [], "nuevos_riesgos": [],
              "estado": {"antes": antes.get("estado"), "ahora": ahora.get("estado")},
              "misma_tesis": antes.get("id") == ahora.get("id") and antes.get("cuerpo_sha256") == ahora.get("cuerpo_sha256")}
    for d in ahora.get("disparadores") or []:
        p = previos.get(d.get("id"))
        texto = d.get("descripcion")
        if p is None:
            salida["nuevos_riesgos"].append({"punto": texto, "motivo": "punto de invalidación nuevo"})
            continue
        if d.get("salta") and not p.get("salta"):
            salida["invalidaciones"].append({"punto": texto, "detalle": d.get("detalle")})
        elif p.get("salta") and not d.get("salta") and d.get("medible"):
            salida["confirmados"].append({"punto": texto, "detalle": "vuelve a cumplirse: " + str(d.get("detalle"))})
        elif p.get("medible") and not d.get("medible"):
            salida["nuevos_riesgos"].append({"punto": texto, "motivo": "ya no se puede medir: deja de vigilar"})
        elif not d.get("salta") and d.get("medible") and p.get("medible"):
            va, vb, u = datos.numero(p.get("valor")), datos.numero(d.get("valor")), datos.numero(d.get("umbral"))
            if va is not None and vb is not None and u is not None:
                dist_antes, dist_ahora = abs(va - u), abs(vb - u)
                if dist_antes - dist_ahora >= 0.01:
                    salida["deteriorados"].append(
                        {"punto": texto, "antes": va, "ahora": vb, "umbral": u,
                         "detalle": f"se acerca a su umbral ({fmt_num(va, 3)} → {fmt_num(vb, 3)}, umbral {fmt_num(u, 3)})"})
                elif dist_ahora - dist_antes >= 0.01:
                    salida["confirmados"].append(
                        {"punto": texto, "antes": va, "ahora": vb, "umbral": u,
                         "detalle": f"se aleja de su umbral ({fmt_num(va, 3)} → {fmt_num(vb, 3)})"})
    destino = {"invalidado": "invalidaciones", "debilitado": "deteriorados", "confirmado": "confirmados"}
    for i in impacto_evento or []:
        if i.get("estado") in destino:
            salida[destino[i["estado"]]].append({
                "punto": i.get("punto"), "antes": i.get("previo"), "ahora": i.get("real"), "umbral": i.get("umbral"),
                "detalle": f"según los resultados de {i.get('periodo')} (trimestre, no ejercicio)",
                "origen": "resultados",
            })
    return salida


def comparar_decisiones(antes: dict, ahora: dict, pos_antes=None, pos_ahora=None) -> dict:
    """BUY → HOLD, y exactamente qué reglas lo provocaron.

    Se cruzan las dos trazas del motor por identificador de regla. Las que
    cambiaron de resultado son la explicación; su valor y su umbral, la prueba.
    """
    a_accion, b_accion = antes.get("action"), ahora.get("action")
    ra = {r.get("id"): r for r in antes.get("reglas") or []}
    rb = {r.get("id"): r for r in ahora.get("reglas") or []}
    cambiaron, papeles = [], []
    for id_, r in rb.items():
        p = ra.get(id_)
        if p is not None and p.get("resultado") == r.get("resultado"):
            # Mismo resultado, otro papel (p. ej. la puntuación sigue cumpliendo
            # pero ya no basta para comprar). Se informa aparte: no es la causa.
            if p.get("papel") != r.get("papel"):
                papeles.append({"regla": id_, "texto": r.get("regla"),
                                "antes": p.get("papel"), "ahora": r.get("papel")})
            continue
        cambiaron.append({
            "regla": id_,
            "texto": r.get("regla"),
            "antes": None if p is None else {"resultado": p.get("resultado"), "papel": p.get("papel"), **(p.get("datos") or {})},
            "ahora": {"resultado": r.get("resultado"), "papel": r.get("papel"), **(r.get("datos") or {})},
        })
    for id_, p in ra.items():
        if id_ not in rb:
            cambiaron.append({"regla": id_, "texto": p.get("regla"),
                              "antes": {"resultado": p.get("resultado"), "papel": p.get("papel"), **(p.get("datos") or {})},
                              "ahora": None})

    explicacion = []
    if bool(pos_antes) != bool(pos_ahora):
        explicacion.append(
            "Ahora " + ("tienes" if pos_ahora else "ya no tienes") + " posición: la "
            "pregunta pasa a ser " + ("si sostenerla o soltarla" if pos_ahora else "si entrar o no")
            + ", y con ella cambia el conjunto de reglas."
        )
    for c in cambiaron:
        if c["antes"] is None or c["ahora"] is None:
            continue
        def leer(x):
            v, u = x.get("valor"), x.get("umbral")
            num = f" ({_fmt(v)} frente a {_fmt(u)})" if v is not None and u is not None else ""
            return f"{x['resultado'].replace('_', ' ')}{num}"
        explicacion.append(f"«{c['texto']}»: {leer(c['antes'])} → {leer(c['ahora'])}.")
    if not cambiaron and a_accion != b_accion:
        explicacion.append("Ninguna regla cambió de resultado: la diferencia viene de una instantánea sin traza (anterior a la traza de reglas).")
    return {
        "antes": a_accion,
        "ahora": b_accion,
        "cambio": a_accion != b_accion,
        "reglas_que_cambiaron": cambiaron,
        "papeles_que_cambiaron": papeles,
        "explicacion": explicacion,
        "generado_por": "app",
    }


def _fmt(x) -> str:
    if isinstance(x, float):
        return fmt_num(x, signo=True) if abs(x) < 10 else fmt_num(x)
    return str(x)
