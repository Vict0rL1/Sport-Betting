"""¿Es esta oportunidad MEJOR que lo que ya tengo? Y si no lo es claramente: nada.

Una señal de compra no significa «hay que comprar». Si la cartera está llena,
comprar algo exige vender otra cosa, y eso cuesta comisiones, horquilla,
impuestos y riesgo de equivocarse dos veces. Este motor no dice «vende X y
compra Y». Presenta comparaciones con reglas visibles y concluye una de cinco
cosas:

- `NO_ACCION`        la señal no es de compra: no hay nada que financiar.
- `COMPRAR_CON_EFECTIVO`  hay efectivo para el tamaño permitido.
- `REVISAR_PARA_FINANCIAR` una posición actual es claramente peor que la idea
                     nueva, por más del umbral mínimo de mejora y de los costes.
- `NO_TRADE`         nada actual es claramente peor: el cambio no compensa.
- `INDETERMINADO`    falta un dato que decide (el efectivo, el precio, la señal).

**Anti-churn, por diseño.** Una idea apenas mejor que una posición actual no
justifica pagar dos veces costes e impuestos: hace falta una mejora mínima de
`MEJORA_MINIMA` puntos, más un punto por cada `COSTE_POR_PUNTO_PCT` de coste del
cambio. Lo comprado hace menos de `TENENCIA_MINIMA_DIAS` no se propone como
fuente de financiación. `NO_TRADE` es una respuesta válida y frecuente.

**Las puntuaciones son reglas, no un modelo.** Cada punto tiene su motivo
escrito en `desglose`. No hay pesos escondidos ni LLM.
"""

from __future__ import annotations

import math

from app import datos
from app.formato import fmt_pct

NO_ACCION = "NO_ACCION"
COMPRAR_CON_EFECTIVO = "COMPRAR_CON_EFECTIVO"
REVISAR = "REVISAR_PARA_FINANCIAR"
NO_TRADE = "NO_TRADE"
INDETERMINADO = "INDETERMINADO"

# --- Parámetros (visibles y discutibles) --------------------------------------
MEJORA_MINIMA = 3              # puntos de atractivo de ventaja, como mínimo
COSTE_POR_PUNTO_PCT = 1.0      # cada 1 % de coste del cambio exige un punto más
TENENCIA_MINIMA_DIAS = 30      # lo recién comprado no se rota
PUNTOS_PRUDENCIA_IMPUESTOS = 1  # impuestos desconocidos con plusvalía: un punto más exigido
BANDA_REBALANCEO_PCT = 2.0     # por encima del tope por posición + esto, se marca para recortar el exceso
CORRELACION_ALTA = 0.70

ATRACTIVO_SENAL = {"comprar": 2, "vigilar": 1, "mantener": 0, "ninguna": 0, "reducir": -2, "vender": -3, "evitar": -3}
ATRACTIVO_TESIS = {"intacta": 1, "sin_puntos": 0, "sin_comprobar": 0, "sin_tesis": 0, "puntos_cruzados": -2}
ATRACTIVO_VALORACION = {"barata": 1, "razonable": 0, "cara": -1}
ATRACTIVO_CONFIANZA = {"alta": 1, "media": 0, "baja": -1}

PRIORIDAD_SENAL = {"vender": 3, "reducir": 2}
PRIORIDAD_TESIS = {"puntos_cruzados": 3, "sin_comprobar": 1, "sin_tesis": 1}
PRIORIDAD_VALORACION = {"cara": 2, "barata": -1}


def parametros() -> dict:
    return {
        "mejora_minima": MEJORA_MINIMA, "coste_por_punto_pct": COSTE_POR_PUNTO_PCT,
        "tenencia_minima_dias": TENENCIA_MINIMA_DIAS, "puntos_prudencia_impuestos": PUNTOS_PRUDENCIA_IMPUESTOS,
        "banda_rebalanceo_pct": BANDA_REBALANCEO_PCT, "correlacion_alta": CORRELACION_ALTA,
        "atractivo": {"senal": ATRACTIVO_SENAL, "tesis": ATRACTIVO_TESIS,
                      "valoracion": ATRACTIVO_VALORACION, "confianza": ATRACTIVO_CONFIANZA},
        "prioridad_de_revision": {"senal": PRIORIDAD_SENAL, "tesis": PRIORIDAD_TESIS,
                                  "valoracion": PRIORIDAD_VALORACION},
    }


def lectura_de_valoracion(implicito: float | None, historico: float | None) -> str | None:
    """Barata, razonable o cara, contra lo que la empresa ha hecho.

    El precio de hoy descuenta un crecimiento del FCF (DCF inverso al 9 %). Si
    pide menos de lo que la empresa ha crecido —con dos puntos de margen— es
    barata; si pide cinco puntos más, cara. Sin uno de los dos, desconocida.
    """
    i, h = datos.numero(implicito), datos.numero(historico)
    if i is None or h is None:
        return None
    if i < h - 0.02:
        return "barata"
    if i > h + 0.05:
        return "cara"
    return "razonable"


def atractivo(x: dict) -> dict:
    """Puntos de atractivo de una idea o posición, con el motivo de cada uno."""
    desglose, total, desconocidos = [], 0, []

    def sumar(campo, tabla, valor, etiqueta):
        nonlocal total
        if valor is None or valor not in tabla:
            desconocidos.append(campo)
            desglose.append({"criterio": campo, "valor": valor, "puntos": 0, "nota": "desconocido: no suma ni resta"})
            return
        total += tabla[valor]
        desglose.append({"criterio": campo, "valor": valor, "puntos": tabla[valor], "nota": etiqueta})

    sumar("senal", ATRACTIVO_SENAL, x.get("accion"), "acción del motor de reglas")
    sumar("tesis", ATRACTIVO_TESIS, x.get("tesis"), "estado de la tesis")
    sumar("valoracion", ATRACTIVO_VALORACION, x.get("valoracion"), "DCF inverso frente al crecimiento histórico")
    sumar("confianza", ATRACTIVO_CONFIANZA, x.get("confianza"), "calidad de la evidencia")
    rpp = datos.numero(x.get("riesgo_por_peso"))
    if rpp is not None and rpp > 1.5:
        total -= 1
        desglose.append({"criterio": "riesgo", "valor": rpp, "puntos": -1,
                         "nota": "aporta más de 1,5 veces su peso en riesgo"})
    return {"puntos": total, "desglose": desglose, "desconocidos": desconocidos}


def prioridad_de_revision(p: dict, candidata: dict) -> dict:
    """Por qué ESTA posición sería la primera en revisarse para financiar la idea."""
    desglose, total = [], 0

    def anotar(criterio, valor, puntos, nota):
        nonlocal total
        total += puntos
        desglose.append({"criterio": criterio, "valor": valor, "puntos": puntos, "nota": nota})

    if p.get("accion") in PRIORIDAD_SENAL:
        anotar("senal", p["accion"], PRIORIDAD_SENAL[p["accion"]], "el propio motor ya dice soltarla")
    if p.get("tesis") in PRIORIDAD_TESIS:
        anotar("tesis", p["tesis"], PRIORIDAD_TESIS[p["tesis"]],
               "puntos de invalidación cruzados" if p["tesis"] == "puntos_cruzados" else "tesis sin vigilancia efectiva")
    if p.get("valoracion") in PRIORIDAD_VALORACION:
        anotar("valoracion", p["valoracion"], PRIORIDAD_VALORACION[p["valoracion"]], "DCF inverso frente a su historia")
    rpp = datos.numero(p.get("riesgo_por_peso"))
    if rpp is not None and rpp > 1.2:
        anotar("riesgo", rpp, 2 if rpp > 1.5 else 1, "aporta más riesgo que dinero")
    corr = datos.numero(p.get("correlacion_con_candidata"))
    if corr is not None and corr >= CORRELACION_ALTA:
        anotar("correlacion", corr, 1,
               f"se mueve con {candidata.get('symbol')}: cambiarla no duplica la exposición")
    if p.get("confianza") == "baja":
        anotar("confianza", "baja", 1, "la evidencia que la respalda es baja")
    if p.get("sobreponderada"):
        anotar("rebalanceo", p.get("peso"), 1, "por encima del tope por posición más la banda: recortar el exceso")
    return {"puntos": total, "desglose": desglose}


def coste_del_cambio(p: dict, coste_por_lado_pct: float, tipo_impositivo: float | None) -> dict:
    """Lo que cuesta vender esta y comprar la otra, en % del importe movido."""
    transaccion = 2 * coste_por_lado_pct
    precio, coste = datos.precio(p.get("precio")), datos.numero(p.get("coste_medio"))
    plusvalia = (precio / coste - 1) if precio and coste else None
    if plusvalia is None:
        impuestos, estado = None, "desconocidos"
    elif plusvalia <= 0:
        impuestos, estado = 0.0, "sin plusvalía"
    elif tipo_impositivo is None:
        impuestos, estado = None, "desconocidos"
    else:
        # Sobre el importe vendido: la parte que es plusvalía × el tipo.
        impuestos, estado = plusvalia / (1 + plusvalia) * tipo_impositivo * 100, "estimados"
    total = transaccion + (impuestos or 0.0)
    return {
        "transaccion_pct": round(transaccion, 3),
        "impuestos_pct": None if impuestos is None else round(impuestos, 3),
        "impuestos": estado,
        "plusvalia_no_realizada": None if plusvalia is None else round(plusvalia, 4),
        "total_conocido_pct": round(total, 3),
        "nota": "sin impuestos (desconocidos): el coste real es MAYOR" if estado == "desconocidos" and (plusvalia or 0) > 0 else None,
    }


def evaluar(
    candidata: dict,
    posiciones: list[dict],
    *,
    tamano_maximo: float | None,
    efectivo: float | None,
    coste_por_lado_pct: float,
    tipo_impositivo: float | None = None,
    max_posicion: float | None = None,
    recortes: list[str] | None = None,
) -> dict:
    """La comparación entera. Todo en FRACCIONES del capital total.

    `recortes`: lo que el dimensionador dijo al recortar esta idea; si la deja
    en 0 %, el veredicto cita QUÉ límite lo hizo en vez de enumerarlos todos.
    """
    base = {"candidata": {**candidata, "atractivo": atractivo(candidata)},
            "parametros": parametros(), "generado_por": "app"}

    if candidata.get("accion") != "comprar":
        return {**base, "veredicto": {
            "accion": NO_ACCION,
            "motivo": f"La señal de {candidata.get('symbol')} es «{candidata.get('accion')}», no de compra: no hay nada que financiar.",
        }}
    if tamano_maximo is None:
        return {**base, "veredicto": {"accion": INDETERMINADO,
                                      "motivo": "No se pudo dimensionar la idea: sin tamaño permitido no hay comparación."}}
    if tamano_maximo <= 0 and efectivo is None:
        # Con el efectivo desconocido, la cartera se dimensiona como si estuviera
        # invertida al 100 %: «no cabe» sería una conclusión del supuesto, no
        # del dato.
        return {**base, "tamano": {"maximo_permitido": 0.0, "efectivo_disponible": None}, "veredicto": {
            "accion": INDETERMINADO,
            "motivo": ("Sin efectivo anotado, la cartera se mide como invertida al 100 % y así la idea no cabe. "
                       "Anota tu efectivo para saber si de verdad no cabe."),
        }}
    if tamano_maximo <= 0:
        porque = " ".join(r for r in recortes or [] if "0 %" in r or candidata.get("symbol", "") in r)
        return {**base, "tamano": {"maximo_permitido": 0.0, "efectivo_disponible": round(efectivo, 4)}, "veredicto": {
            "accion": NO_TRADE,
            "motivo": "No cabe: los límites de la cartera le dejan 0 %. " + (
                porque or "Ninguno de los límites (posición, sector, correlación, volatilidad) deja hueco."),
        }}

    tamano = {"maximo_permitido": round(tamano_maximo, 4)}
    if efectivo is None:
        tamano["efectivo_disponible"] = None
        necesidad = None
    else:
        tamano["efectivo_disponible"] = round(efectivo, 4)
        necesidad = max(0.0, tamano_maximo - efectivo)
        tamano["financiacion_necesaria"] = round(necesidad, 4)
    if necesidad == 0:
        return {**base, "tamano": tamano, "veredicto": {
            "accion": COMPRAR_CON_EFECTIVO,
            "motivo": f"Hay efectivo ({fmt_pct(efectivo)}) para el tamaño permitido ({fmt_pct(tamano_maximo)}): no hace falta vender nada.",
        }}

    a_cand = base["candidata"]["atractivo"]["puntos"]
    revisables = []
    for p in posiciones:
        p = dict(p)
        if max_posicion is not None and datos.numero(p.get("peso")) is not None:
            p["sobreponderada"] = p["peso"] * 100 > max_posicion * 100 + BANDA_REBALANCEO_PCT
        fila = {
            "symbol": p["symbol"], "peso": p.get("peso"), "accion": p.get("accion"), "tesis": p.get("tesis"),
            "valoracion": p.get("valoracion"), "confianza": p.get("confianza"),
            "contribucion_riesgo": p.get("contribucion"), "riesgo_por_peso": p.get("riesgo_por_peso"),
            "correlacion_con_candidata": p.get("correlacion_con_candidata"),
            "dias_en_cartera": p.get("dias_en_cartera"), "lectura_de": p.get("lectura_de"),
        }
        fila["prioridad"] = prioridad_de_revision(p, candidata)
        fila["atractivo"] = atractivo(p)
        fila["coste_del_cambio"] = coste_del_cambio(p, coste_por_lado_pct, tipo_impositivo)
        requerida = MEJORA_MINIMA + math.ceil(fila["coste_del_cambio"]["total_conocido_pct"] / COSTE_POR_PUNTO_PCT)
        if fila["coste_del_cambio"]["impuestos"] == "desconocidos" and (fila["coste_del_cambio"]["plusvalia_no_realizada"] or 0) > 0:
            requerida += PUNTOS_PRUDENCIA_IMPUESTOS
        fila["mejora"] = a_cand - fila["atractivo"]["puntos"]
        fila["mejora_requerida"] = requerida
        dias = p.get("dias_en_cartera")
        if dias is not None and dias < TENENCIA_MINIMA_DIAS:
            fila["elegible"], fila["motivo"] = False, f"tenencia mínima: comprada hace {dias} días (< {TENENCIA_MINIMA_DIAS})"
        elif fila["atractivo"]["desconocidos"] and len(fila["atractivo"]["desconocidos"]) >= 3:
            fila["elegible"], fila["motivo"] = False, (
                "casi todo desconocido: no se puede comparar con honestidad"
                + ("; no tiene ninguna lectura congelada: analízala primero" if not p.get("lectura_de") else ""))
        else:
            fila["elegible"] = True
            fila["supera_umbral"] = fila["mejora"] >= requerida
        revisables.append(fila)
    revisables.sort(key=lambda f: (-f["prioridad"]["puntos"], -(f["mejora"] or 0)))

    veredicto = _veredicto(candidata, revisables, necesidad)
    if efectivo and necesidad:
        # Con lo que hay se puede comprar una parte sin vender nada; el resto es
        # lo que exige la comparación.
        veredicto["parcial_con_efectivo"] = round(efectivo, 4)
        veredicto["motivo"] += (f" Con el efectivo disponible ({fmt_pct(efectivo)}) puedes comprar esa "
                                "parte sin tocar nada.")
    return {**base, "tamano": tamano, "candidatos_a_revisar": revisables, "veredicto": veredicto}


def _veredicto(candidata: dict, revisables: list[dict], necesidad: float | None) -> dict:
    elegibles = [f for f in revisables if f.get("elegible")]
    superan = [f for f in elegibles if f.get("supera_umbral")]
    if necesidad is None:
        return {
            "accion": INDETERMINADO,
            "motivo": ("Efectivo desconocido: no se puede saber si comprar esta idea exige vender algo. "
                       "Anota tu efectivo. Si no tuvieras nada, la lista de abajo dice qué se revisaría primero."),
            "si_no_hubiera_efectivo": superan[0]["symbol"] if superan else None,
        }
    if superan:
        mejor = max(superan, key=lambda f: (f["prioridad"]["puntos"], f["mejora"]))
        return {
            "accion": REVISAR,
            "revisar": mejor["symbol"],
            "motivo": (
                f"{mejor['symbol']} queda {mejor['mejora']} puntos por debajo de {candidata.get('symbol')} "
                f"(mínimo exigido {mejor['mejora_requerida']}, con costes incluidos). Es candidata a REVISIÓN, "
                "no una orden de venta: relee su tesis antes."
            ),
        }
    if not elegibles:
        motivos = sorted({f.get("motivo", "") for f in revisables})
        return {"accion": NO_TRADE, "motivo": "Ninguna posición es elegible para financiarla: " + " / ".join(motivos) + "."}
    mejor = max(elegibles, key=lambda f: f["mejora"])
    return {
        "accion": NO_TRADE,
        "motivo": (
            f"La mejor alternativa ({mejor['symbol']}) solo mejora {mejor['mejora']} puntos y hacen falta "
            f"{mejor['mejora_requerida']} con costes: la idea no supera lo que ya tienes por lo suficiente "
            "como para pagar el cambio."
        ),
    }
