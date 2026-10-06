"""De puntuación a decisión: qué hacer, a qué precio y cuándo salir.

Este módulo es el que convierte "esta empresa puntúa bien" en "compra aquí,
sal por aquí". Tres principios que lo gobiernan:

1. **Reglas mecánicas y escritas.** Cada decisión sale de condiciones que se
   pueden leer, discutir y probar. No hay criterio discrecional escondido:
   si una regla es mala, se ve y se cambia.

2. **La salida se define antes de entrar.** Toda propuesta de compra viene con
   stop y objetivo calculados desde su propia volatilidad. Un stop igual para
   una utility y para una biotech no protege de nada.

3. **El tamaño lo fija el riesgo, no la corazonada.** Se arriesga un % fijo del
   capital por operación; cuanto más lejos queda el stop, más pequeña es la
   posición. Así una idea equivocada cuesta lo mismo que cualquier otra.

Lo que esto NO es: una predicción. Las reglas son razonables y están probadas
en el backtest cuando hay muestra suficiente, pero que hayan funcionado antes
no garantiza nada. `confidence` dice explícitamente si están validadas.
"""

from __future__ import annotations

import math

from app import datos

# --- Parámetros del sistema. Están aquí, juntos y con nombre, para que se
# puedan discutir y ajustar sin bucear por el código. ---

RIESGO_POR_OPERACION = 0.01  # 1 % del capital en riesgo si salta el stop
STOP_MIN_PCT = 8.0           # por debajo, el ruido normal te saca sin motivo
STOP_MAX_PCT = 25.0          # por encima, la pérdida deja de ser asumible
STOP_VOLATILIDADES = 2.0     # el stop va a 2 desviaciones mensuales

# Los topes del stop dependen de la clase de activo, y no es un detalle. Con el
# rango de las acciones aplicado a cripto, Bitcoin (27 %), Ethereum (37 %) y
# cualquier altcoin (60 %) se pegan TODAS al tope de 25 %: el stop deja de
# dimensionarse por volatilidad y pasa a ser una constante demasiado ceñida que
# el ruido normal perfora una y otra vez. Un stop que salta por ruido no
# protege, solo materializa pérdidas.
#
# La contrapartida se paga donde toca: con un stop del 60 %, arriesgar el mismo
# 1 % obliga a una posición de 1,7 % de la cartera. El riesgo por idea sigue
# siendo el mismo; lo que cambia es cuánto dinero hace falta para asumirlo.
TOPES_STOP: dict[str, tuple[float, float]] = {
    "accion": (STOP_MIN_PCT, STOP_MAX_PCT),
    "cripto": (15.0, 60.0),
    "etf": (6.0, 20.0),  # un índice diversificado se mueve menos que sus partes
}
RATIO_OBJETIVO = 2.0         # se busca ganar el doble de lo que se arriesga
BANDA_ENTRADA_PCT = 2.0      # zona de compra alrededor del último cierre

# Banda muerta alrededor de la media de 200 sesiones. Sin ella, un precio que
# oscila un 1 % en torno a su media cruza la línea varias veces por semana y la
# señal salta de "comprar" a "vigilar" y de "mantener" a "reducir" un día sí y
# otro también. Cada ida y vuelta cuesta ~3,3 % en comisiones y cambio de
# divisa, así que el vaivén no es un detalle estético: se paga.
#
# Es asimétrica a propósito: hace falta superar la media por 2 % para entrar,
# pero solo perderla por 1 % para salir. Cuesta más entrar que salir, que es
# como debe ser cuando la penalización por equivocarse es asimétrica.
BANDA_TENDENCIA_ENTRAR_PCT = 2.0
BANDA_TENDENCIA_SALIR_PCT = 1.0
SESIONES_MES = 21

ACCIONES = {
    "comprar": "Comprar",
    "vigilar": "Vigilar",
    "mantener": "Mantener",
    "reducir": "Reducir",
    "vender": "Vender",
    "evitar": "Evitar",
    "ninguna": "Sin acción",
    "sin_datos": "Sin datos",
}


def _stop_pct(vol_diaria_pct: float | None, clase: str = "accion") -> float:
    """Distancia del stop, dimensionada por la volatilidad y la clase de activo."""
    minimo, maximo = TOPES_STOP.get(clase, TOPES_STOP["accion"])
    # Saneado: una volatilidad NaN se colaba hasta aquí y salía por `min(max(...))`
    # intacta —las comparaciones con NaN son todas False, así que `min` y `max`
    # devuelven el NaN— produciendo un stop NaN con toda la pinta de un número.
    vol_diaria_pct = datos.porcentaje(vol_diaria_pct)
    if not vol_diaria_pct:
        # Sin volatilidad medible, el punto medio del rango de su clase: es
        # explícito y no finge una precisión que no hay.
        return round((minimo + maximo) / 2, 1)
    mensual = vol_diaria_pct * math.sqrt(SESIONES_MES)
    return round(min(max(STOP_VOLATILIDADES * mensual, minimo), maximo), 1)


def _niveles(precio: float, vol_diaria_pct: float | None, clase: str = "accion") -> dict:
    stop_pct = _stop_pct(vol_diaria_pct, clase)
    objetivo_pct = round(stop_pct * RATIO_OBJETIVO, 1)
    return {
        "entrada_desde": round(precio * (1 - BANDA_ENTRADA_PCT / 100), 2),
        "entrada_hasta": round(precio * (1 + BANDA_ENTRADA_PCT / 100), 2),
        "stop": round(precio * (1 - stop_pct / 100), 2),
        "stop_pct": stop_pct,
        "objetivo": round(precio * (1 + objetivo_pct / 100), 2),
        "objetivo_pct": objetivo_pct,
        "ratio": RATIO_OBJETIVO,
        # Peso BRUTO: lo que este stop permitiría arriesgando el 1 % del
        # capital, mirando esta empresa y nada más. NO es el peso final.
        #
        # El tamaño real depende de toda la cartera —qué más tienes, cuánto se
        # parecen entre sí tus posiciones, qué volatilidad soporta el conjunto—
        # y eso no se puede saber desde aquí. Lo decide `analysis/sizing.py`.
        # Cuando este número se usaba directamente, aceptar ocho ideas al 12,5 %
        # daba el 100 % de la cartera en ocho apuestas sin que nada lo impidiera.
        "peso_bruto_pct": round(RIESGO_POR_OPERACION * 100 / (stop_pct / 100), 1),
    }


def decide(
    signal: dict,
    price: dict | None,
    position: dict | None = None,
    favorable_min: float = 0.35,
    desfavorable_max: float = -0.35,
    reglas: dict | None = None,
    clase: str = "accion",
    resultados_en: str | None = None,
) -> dict:
    """Decide qué hacer con una empresa, con sus niveles y sus motivos.

    `position`: {"cost_basis": float, "quantity": float} si ya se tiene, o None.
    """
    # Saneado ANTES de cualquier comparación. La guarda anterior era
    # `not price.get("last")`, que no para ni un NaN (es *truthy*) ni un precio
    # negativo. Lo que entraba corrupto salía por el otro lado convertido en
    # «comprar», con un stop NaN y —esto era lo grave— un `peso_bruto_pct`
    # numérico que el dimensionador aceptaba como bueno: una cotización rota
    # producía una orden de compra dimensionada. Toda comparación con NaN
    # devuelve False, así que los `elif` encadenados caen en la rama final sin
    # que nada lo señale.
    # `reglas` (el parámetro) es el resumen del backtest de reglas, que decide
    # la validación; aquí dentro `reglas` pasa a ser la TRAZA de esta decisión.
    reglas_ext = reglas
    ultimo = datos.precio((price or {}).get("last"))
    score = datos.numero(signal.get("score"))
    faltan = datos.faltantes({"precio": ultimo, "puntuación": score})
    if faltan:
        return {
            "action": "sin_datos",
            "label": ACCIONES["sin_datos"],
            "reasons": [datos.indeterminado(faltan, "sobre esta empresa")["motivo"]],
            "faltan": faltan,
            "levels": None,
            "triggers": [],
            "confidence": "ninguna",
            "owned": position is not None,
            "reglas": [
                {**_regla("datos_minimos", "Precio y puntuación válidos", NO_CUMPLE,
                          efecto="sin_datos", faltan=faltan), "papel": "decide"}
            ],
            "cambiaria": [
                {
                    "hacia": "cualquier acción",
                    "requiere": "todas",
                    "condiciones": [
                        {"regla": "datos_minimos", "condicion": f"que haya {f} válido",
                         "actual": None, "umbral": None}
                        for f in faltan
                    ],
                }
            ],
        }

    sma200 = datos.numero(price.get("sma200"))
    # Un precio VIEJO (todas las fuentes fallaron y se sirve la última copia)
    # no es inválido: la tendencia y la puntuación no cambian en veinte
    # minutos. Pero no basta para COMPRAR —la zona de entrada se mediría contra
    # un precio que quizá ya no existe— y cualquier decisión tomada con él lo
    # dice en sus razones.
    precio_viejo = price.get("estado") == "viejo"
    minutos_viejo = round((datos.numero(price.get("antiguedad_segundos")) or 0) / 60)
    # `above_sma200` es un booleano crudo que cambia con cualquier roce de la
    # línea. Aquí se aplica la banda muerta: hay tres estados, no dos.
    # Tres estados: True (claramente encima), False (claramente debajo) y None
    # (dentro de la banda). None se propaga a propósito — volver al booleano
    # crudo aquí anularía la banda entera. Aguas abajo, None no basta para
    # entrar (se va a "vigilar") ni basta para salir (se queda en "mantener"),
    # que es exactamente la asimetría que corta el vaivén.
    corrupta = price.get("sma200") is not None and sma200 is None
    sobre_media = _tendencia(ultimo, sma200, price.get("above_sma200"), corrupta=corrupta)
    # Distinguir «dentro de la banda» (se sabe: ni encima ni debajo) de «no se
    # sabe» (sin media utilizable). Para la decisión dan lo mismo; para la
    # traza no: una regla desconocida no es una regla que no se cumple.
    tendencia_desconocida = sobre_media is None and (
        sma200 is None and (price.get("above_sma200") is None or corrupta)
    )
    niveles = _niveles(ultimo, price.get("daily_vol_pct"), clase)
    razones: list[str] = []
    disparadores: list[str] = []
    tendencia = {"sma200": sma200, "precio": ultimo, "desconocida": tendencia_desconocida}

    # --- Ya se tiene la empresa: la pregunta es si sostenerla o soltarla ---
    if position:
        # Un coste corrupto daba un stop de posición NaN, y con él un
        # disparador «vender si cierra por debajo de nan». Sin coste utilizable
        # se sigue pudiendo decidir —la puntuación y la tendencia no dependen de
        # él— pero los niveles anclados a tu compra quedan en None, que es la
        # respuesta honesta: no se sabe a qué precio entraste.
        coste = datos.precio(position.get("cost_basis"))
        pnl_pct = round((ultimo / coste - 1) * 100, 2) if coste else None
        # El stop que manda es el FIJADO AL ABRIR. Recalcularlo cada día con la
        # volatilidad actual lo alejaba justo en las caídas —la caída dispara
        # la volatilidad, la volatilidad ensancha el stop— y un precio que ya
        # lo había perforado seguía «por encima». Solo si la posición es
        # anterior a este cambio (no guarda stop) se recalcula, y se dice.
        #
        # Un stop fijado POR ENCIMA del coste también manda: es el que se sube
        # desde la cartera para asegurar beneficio («Fijar stop» deja subirlo,
        # nunca bajarlo), o el del lote más caro cuando hay varios. Antes se
        # ignoraba («no protege») y se recalculaba uno bajo el coste: el precio
        # perforaba el stop que el usuario veía en la cartera y aquí salía
        # «mantener». Abrir con un stop sobre el coste sí se rechaza, en la
        # entrada: el día de la compra no protege de nada.
        stop_fijado = datos.precio(position.get("stop"))
        if stop_fijado is not None:
            stop_posicion = round(stop_fijado, 2)
        else:
            stop_posicion = (
                round(coste * (1 - niveles["stop_pct"] / 100), 2) if coste else None
            )

        # Las reglas, en su orden de prioridad. La acción SALE de esta lista:
        # la primera que se cumple decide. Antes la traza no existía y el «por
        # qué» había que deducirlo leyendo frases.
        reglas = _reglas_con_posicion(
            score, ultimo, stop_posicion, sobre_media, tendencia, desfavorable_max
        )
        decisiva = next((r for r in reglas if r["resultado"] == CUMPLE), None)
        accion = decisiva["efecto"] if decisiva else "mantener"
        for r in reglas:
            r["papel"] = "decide" if r is decisiva else "evaluada"

        if decisiva and decisiva["id"] == "puntuacion_desfavorable":
            razones.append(
                f"La puntuación cayó a {score:+.2f}: la razón por la que se "
                "compró ya no se sostiene frente a sus comparables."
            )
        elif decisiva and decisiva["id"] == "stop_perforado":
            if coste and stop_posicion >= coste:
                respecto_coste = "por encima de tu coste: protegía beneficio"
            elif coste:
                respecto_coste = f"un {round((1 - stop_posicion / coste) * 100, 1)} % bajo tu coste"
            else:
                respecto_coste = "sin coste utilizable con el que compararlo"
            razones.append(
                f"El precio ({ultimo}) perforó el stop de la posición "
                f"({stop_posicion}), {respecto_coste}."
            )
        elif decisiva and decisiva["id"] == "tendencia_perdida":
            razones.append(
                f"Cotiza por debajo de su media de 200 sesiones ({sma200}): la "
                "tendencia se giró en contra aunque los fundamentales aguanten."
            )
        else:
            razones.append(
                f"Puntuación {score:+.2f} y precio sobre su media de 200 "
                "sesiones: no hay motivo para tocar la posición."
            )

        if pnl_pct is not None:
            razones.append(f"Llevas un {pnl_pct:+.2f} % sobre tu precio de compra.")
        if precio_viejo:
            # Sobre lo que ya tienes se decide igual: callar un stop perforado
            # por no tener un precio fresco sería el error caro.
            razones.append(
                f"Precio viejo (de hace {minutos_viejo} min: las fuentes fallaron). "
                "Compruébalo en tu broker antes de actuar."
            )
            reglas.append({**_regla("precio_viejo", "Precio rescatado de caché", CUMPLE,
                                    minutos=minutos_viejo), "papel": "informa"})
        lotes = position.get("lotes") or 1
        if lotes > 1:
            sin_stop = position.get("lotes_sin_stop") or 0
            razones.append(
                f"La posición son {lotes} lotes: coste medio ponderado y, de stop, "
                "el más protector de los fijados"
                + (f"; {sin_stop} sin stop guardado" if sin_stop and stop_fijado is not None else "")
                + ". Revisa en tu broker qué lote cruza el stop."
            )
        if stop_fijado is None and stop_posicion is not None:
            razones.append(
                "El stop de esta posición se recalcula con la volatilidad de hoy "
                "porque se abrió antes de que el stop se fijara al comprar. En una "
                "caída eso lo aleja. Fíjalo desde la cartera («Fijar stop»)."
            )

        # Sobre algo que ya tienes, una "zona de compra" y un objetivo medidos
        # desde el precio de hoy no significan nada: los niveles que importan
        # se anclan a TU coste. Y el porcentaje del stop se expresa desde el
        # precio actual, que es la distancia que de verdad te queda.
        niveles_posicion = None
        if stop_posicion is not None:
            # Sin coste utilizable (coste 0 es legal: acciones recibidas en un
            # spin-off) no hay objetivo anclado a él. Antes esto multiplicaba
            # None, la decisión reventaba y la lista la daba por «sin datos»:
            # un stop perforado dejaba de avisarse.
            objetivo = round(coste * (1 + niveles["objetivo_pct"] / 100), 2) if coste else None
            niveles_posicion = {
                "entrada_desde": None,
                "entrada_hasta": None,
                "stop": stop_posicion,
                "stop_pct": round((stop_posicion / ultimo - 1) * 100, 1),
                "objetivo": objetivo,
                "objetivo_pct": round((objetivo / ultimo - 1) * 100, 1) if objetivo else None,
                "ratio": niveles["ratio"],
                "peso_bruto_pct": None,
                "stop_fijado_al_abrir": stop_fijado is not None,
            }
        disparadores = [
            f"Vender si cierra por debajo de {stop_posicion}" if stop_posicion else
            "Vender si el precio perfora tu stop",
            f"Vender si la puntuación baja de {desfavorable_max:+.2f}",
            "Revisar si pierde la media de 200 sesiones",
        ]
        return {
            "action": accion,
            "label": ACCIONES[accion],
            "reasons": razones,
            "levels": niveles_posicion,
            "triggers": disparadores,
            "confidence": _confianza(signal, reglas_ext),
            "escenarios": _escenarios(reglas_ext),
            "owned": True,
            "pnl_pct": pnl_pct,
            "reglas": reglas,
            "cambiaria": _cambiaria_con_posicion(
                accion, score, ultimo, stop_posicion, tendencia, desfavorable_max
            ),
        }

    # --- No se tiene: la pregunta es si entrar, esperar o descartar ---
    reglas = _reglas_sin_posicion(score, sobre_media, tendencia, favorable_min, desfavorable_max)
    por_id = {r["id"]: r for r in reglas}
    if por_id["puntuacion_desfavorable"]["resultado"] == CUMPLE:
        accion = "evitar"
        por_id["puntuacion_desfavorable"]["papel"] = "decide"
        razones.append(
            f"Puntuación {score:+.2f}: queda por detrás de sus comparables de "
            "sector en valor, calidad y momentum."
        )
    elif por_id["puntuacion_favorable"]["resultado"] == CUMPLE and por_id["tendencia_a_favor"]["resultado"] == CUMPLE:
        accion = "comprar"
        por_id["puntuacion_favorable"]["papel"] = "decide"
        por_id["tendencia_a_favor"]["papel"] = "decide"
        razones.append(
            f"Puntuación {score:+.2f} — mejor que sus comparables de sector."
        )
        razones.append(
            f"Cotiza sobre su media de 200 sesiones ({sma200}): la tendencia "
            "acompaña, no estás comprando algo que sigue cayendo."
        )
        disparadores = [
            f"Comprar entre {niveles['entrada_desde']} y {niveles['entrada_hasta']}",
            f"Salir si cierra bajo {niveles['stop']} (−{niveles['stop_pct']} %)",
            f"Tomar beneficios en {niveles['objetivo']} (+{niveles['objetivo_pct']} %)",
        ]
    elif por_id["puntuacion_favorable"]["resultado"] == CUMPLE:
        accion = "vigilar"
        # «Decide» solo la regla cuyo efecto ES la acción. Aquí la puntuación
        # empuja a comprar y la tendencia lo impide: vigilar es ese empate.
        por_id["puntuacion_favorable"]["papel"] = "a_favor"
        por_id["tendencia_a_favor"]["papel"] = "bloquea"
        razones.append(
            f"Puntuación {score:+.2f}, pero cotiza bajo su media de 200 "
            f"sesiones ({sma200}): buena empresa en tendencia bajista."
        )
        razones.append(
            "Comprar aquí es apostar a que el suelo ya pasó. La regla espera a "
            "que el precio recupere la media antes de entrar."
        )
        disparadores = [
            f"Comprar cuando cierre por encima de {sma200}" if sma200 else
            "Comprar cuando recupere su media de 200 sesiones",
        ]
    else:
        # Ni destaca ni preocupa. Meterla en "vigilar" diluiría la lista de
        # espera hasta volverla inútil: vigilar es para empresas buenas
        # esperando que la tendencia gire, no para el montón.
        accion = "ninguna"
        por_id["puntuacion_favorable"]["papel"] = "bloquea"
        razones.append(
            f"Puntuación {score:+.2f}: ni destaca ni preocupa frente a sus "
            "comparables. No hay motivo para actuar."
        )
        disparadores = [f"Revisar si supera {favorable_min:+.2f}"]

    # Entrar dos días antes de una presentación de resultados convierte una
    # apuesta de factores en cara o cruz: el precio se moverá por una noticia
    # que el modelo no conoce y que no está en ningún múltiplo. La idea no se
    # descarta, se aplaza — que es justo lo que hace "vigilar".
    r_resultados = _regla(
        "resultados_proximos", "Presenta resultados en los próximos 7 días",
        CUMPLE if resultados_en else NO_CUMPLE, efecto="vigilar", fecha=resultados_en,
    )
    if resultados_en and accion == "comprar":
        accion = "vigilar"
        r_resultados["papel"] = "modifica"
        razones.insert(
            0,
            f"Presenta resultados el {resultados_en}. La idea es buena, pero "
            "entrar justo antes es apostar a una noticia que el modelo no puede "
            "ver; el movimiento del día lo decide la sorpresa, no los factores.",
        )
        disparadores = [
            f"Comprar cuando hayan publicado ({resultados_en}) y la puntuación aguante",
            *disparadores[1:],
        ]
    elif resultados_en:
        r_resultados["papel"] = "informa"
        razones.append(f"Presenta resultados el {resultados_en}: espera volatilidad.")
    reglas.append(r_resultados)

    r_viejo = _regla(
        "precio_viejo", "Precio rescatado de caché (todas las fuentes fallaron)",
        CUMPLE if precio_viejo else NO_CUMPLE, efecto="vigilar", minutos=minutos_viejo if precio_viejo else None,
    )
    if precio_viejo and accion == "comprar":
        accion = "vigilar"
        r_viejo["papel"] = "modifica"
        razones.insert(
            0,
            f"El precio es viejo (de hace {minutos_viejo} min: todas las fuentes "
            "fallaron). La idea puede ser buena, pero no se fija una zona de "
            "compra contra un precio que quizá ya no existe.",
        )
        disparadores = ["Reevaluar cuando vuelva a haber precio actual", *disparadores[1:]]
    reglas.append(r_viejo)
    for r in reglas:
        r.setdefault("papel", "evaluada")

    if price.get("drawdown_pct") is not None and price["drawdown_pct"] < -25:
        razones.append(
            f"Está un {abs(price['drawdown_pct']):.0f} % por debajo de su "
            "máximo del año: comprueba qué pasó antes de entrar."
        )

    return {
        "action": accion,
        "label": ACCIONES[accion],
        "reasons": razones,
        "levels": niveles if accion in {"comprar", "vigilar"} else None,
        "triggers": disparadores,
        "confidence": _confianza(signal, reglas_ext),
        "escenarios": _escenarios(reglas_ext),
        "owned": False,
        "reglas": reglas,
        "cambiaria": _cambiaria_sin_posicion(
            accion, score, tendencia, favorable_min, desfavorable_max,
            resultados_en, precio_viejo,
        ),
    }


# --- Traza de reglas y «qué la cambiaría» ------------------------------------
#
# La atribución sale de AQUÍ, del mismo motor que decide, no de un sistema
# aparte. Este motor no suma puntos: es una lista de reglas con prioridad —la
# primera que se cumple decide— y así se enseña. Inventar «+2 por valoración,
# +1 por riesgo» sería un segundo motor con aspecto de explicación del primero.

CUMPLE = "cumple"
NO_CUMPLE = "no_cumple"
DESCONOCIDO = "desconocido"


def _regla(id_: str, texto: str, resultado: str, efecto: str | None = None, **datos_) -> dict:
    return {"id": id_, "regla": texto, "resultado": resultado, "efecto": efecto, "datos": datos_}


def _umbral_entrar(sma200: float | None) -> float | None:
    return round(sma200 * (1 + BANDA_TENDENCIA_ENTRAR_PCT / 100), 2) if sma200 else None


def _umbral_salir(sma200: float | None) -> float | None:
    return round(sma200 * (1 - BANDA_TENDENCIA_SALIR_PCT / 100), 2) if sma200 else None


def _reglas_con_posicion(score, ultimo, stop, sobre_media, tendencia, desfavorable_max) -> list[dict]:
    return [
        _regla(
            "puntuacion_desfavorable", f"Puntuación ≤ {desfavorable_max:+.2f}",
            CUMPLE if score <= desfavorable_max else NO_CUMPLE, efecto="vender",
            valor=score, umbral=desfavorable_max,
        ),
        _regla(
            "stop_perforado", "Precio en o bajo el stop de la posición",
            DESCONOCIDO if stop is None else CUMPLE if ultimo <= stop else NO_CUMPLE,
            efecto="vender", valor=ultimo, umbral=stop,
        ),
        _regla(
            "tendencia_perdida",
            f"Precio ≤ media de 200 sesiones − {BANDA_TENDENCIA_SALIR_PCT:g} %",
            DESCONOCIDO if tendencia["desconocida"] else CUMPLE if sobre_media is False else NO_CUMPLE,
            efecto="reducir", valor=ultimo, umbral=_umbral_salir(tendencia["sma200"]),
        ),
    ]


def _reglas_sin_posicion(score, sobre_media, tendencia, favorable_min, desfavorable_max) -> list[dict]:
    return [
        _regla(
            "puntuacion_desfavorable", f"Puntuación ≤ {desfavorable_max:+.2f}",
            CUMPLE if score <= desfavorable_max else NO_CUMPLE, efecto="evitar",
            valor=score, umbral=desfavorable_max,
        ),
        _regla(
            "puntuacion_favorable", f"Puntuación ≥ {favorable_min:+.2f}",
            CUMPLE if score >= favorable_min else NO_CUMPLE, efecto="comprar",
            valor=score, umbral=favorable_min,
        ),
        _regla(
            "tendencia_a_favor",
            f"Precio ≥ media de 200 sesiones + {BANDA_TENDENCIA_ENTRAR_PCT:g} %",
            DESCONOCIDO if tendencia["desconocida"] else CUMPLE if sobre_media else NO_CUMPLE,
            efecto="comprar", valor=tendencia["precio"], umbral=_umbral_entrar(tendencia["sma200"]),
        ),
    ]


def _c_score(op: str, umbral: float, score: float, id_: str) -> dict:
    return {
        "regla": id_,
        "condicion": f"puntuación {op} {umbral:+.2f}",
        "actual": round(score, 3),
        "umbral": umbral,
        "distancia": round(umbral - score, 3),
        "unidad": "puntos",
    }


def _c_precio(op: str, umbral: float | None, ultimo: float, id_: str, que: str) -> dict:
    if umbral is None:
        return {"regla": id_, "condicion": f"precio {op} {que}", "actual": ultimo,
                "umbral": None, "distancia": None, "unidad": "%",
                "nota": "desconocido: no hay media de 200 sesiones utilizable"}
    return {
        "regla": id_,
        "condicion": f"precio {op} {umbral} ({que})",
        "actual": ultimo,
        "umbral": umbral,
        "distancia": round((umbral / ultimo - 1) * 100, 2),
        "unidad": "%",
    }


def _cambiaria_con_posicion(accion, score, ultimo, stop, tendencia, desfavorable_max) -> list[dict]:
    """Qué tendría que pasar para que la acción sobre tu posición fuera otra."""
    sma = tendencia["sma200"]
    salir = _umbral_salir(sma)
    vender = {
        "hacia": "vender",
        "requiere": "alguna",
        "condiciones": [_c_score("≤", desfavorable_max, score, "puntuacion_desfavorable")]
        + ([_c_precio("≤", stop, ultimo, "stop_perforado", "stop")] if stop is not None else []),
    }
    if accion == "mantener":
        return [
            vender,
            {"hacia": "reducir", "requiere": "alguna",
             "condiciones": [_c_precio("≤", salir, ultimo, "tendencia_perdida", "media 200 − 1 %")]},
        ]
    mantener = {
        "hacia": "mantener",
        "requiere": "todas",
        "condiciones": [_c_score(">", desfavorable_max, score, "puntuacion_desfavorable")]
        + ([_c_precio(">", stop, ultimo, "stop_perforado", "stop")] if stop is not None else [])
        + [_c_precio(">", salir, ultimo, "tendencia_perdida", "media 200 − 1 %")],
    }
    if accion == "reducir":
        return [mantener, vender]
    return [mantener]  # vender


def _cambiaria_sin_posicion(
    accion, score, tendencia, favorable_min, desfavorable_max, resultados_en, precio_viejo
) -> list[dict]:
    """Qué tendría que pasar para pasar a cada una de las otras acciones."""
    ultimo, entrar = tendencia["precio"], _umbral_entrar(tendencia["sma200"])
    comprar = [_c_score("≥", favorable_min, score, "puntuacion_favorable"),
               _c_precio("≥", entrar, ultimo, "tendencia_a_favor", "media 200 + 2 %")]
    extra = []
    if resultados_en:
        extra.append({"regla": "resultados_proximos", "condicion": f"que pasen los resultados del {resultados_en}",
                      "actual": resultados_en, "umbral": None, "distancia": None, "unidad": None})
    if precio_viejo:
        extra.append({"regla": "precio_viejo", "condicion": "volver a tener precio actual",
                      "actual": "viejo", "umbral": None, "distancia": None, "unidad": None})
    evitar = {"hacia": "evitar", "requiere": "todas",
              "condiciones": [_c_score("≤", desfavorable_max, score, "puntuacion_desfavorable")]}
    salida = []
    if accion != "comprar":
        pendientes = [
            c for c in comprar
            if not (c["regla"] == "puntuacion_favorable" and score >= favorable_min)
            and not (c["regla"] == "tendencia_a_favor" and c.get("distancia") is not None and c["distancia"] <= 0)
        ]
        salida.append({"hacia": "comprar", "requiere": "todas", "condiciones": pendientes + extra})
    if accion == "comprar":
        salida.append({"hacia": "vigilar", "requiere": "alguna", "condiciones": [
            _c_precio("<", entrar, ultimo, "tendencia_a_favor", "media 200 + 2 %"),
            {"regla": "resultados_proximos", "condicion": "anuncio de resultados en los próximos 7 días",
             "actual": None, "umbral": None, "distancia": None, "unidad": None},
        ]})
    if accion in ("comprar", "vigilar"):
        salida.append({"hacia": "ninguna", "requiere": "todas",
                       "condiciones": [_c_score("<", favorable_min, score, "puntuacion_favorable")]})
    if accion != "evitar":
        salida.append(evitar)
    else:
        salida.append({"hacia": "ninguna", "requiere": "todas",
                       "condiciones": [_c_score(">", desfavorable_max, score, "puntuacion_desfavorable")]})
    return salida


def _escenarios(reglas: dict | None) -> dict | None:
    """Qué pasó de verdad con operaciones como esta, en tres escenarios.

    Un stop y un objetivo describen dónde SALDRÍAS, no qué sueles ganar. Son
    dos cosas distintas: casi la mitad de las operaciones no llegan a ninguno
    de los dos y vencen por plazo en algún punto intermedio. Estos percentiles
    salen del histórico simulado, así que describen lo que pasó — no un
    supuesto sobre lo que pasará.
    """
    if not reglas or not reglas.get("fiable"):
        return None
    dist = reglas.get("distribucion") or {}
    escenarios = dist.get("escenarios")
    if not escenarios or dist.get("n", 0) < 30:
        return None
    return {
        **escenarios,
        "n": dist["n"],
        "nota": (
            f"De {dist['n']} operaciones simuladas con estas reglas: la mitad "
            f"quedó por encima de {escenarios['base']:+.1f} %, una de cada diez "
            f"por debajo de {escenarios['bajista']:+.1f} % y una de cada diez "
            f"por encima de {escenarios['alcista']:+.1f} %."
        ),
    }


def _confianza(signal: dict, reglas: dict | None = None) -> str:
    """En qué apoyarse: reglas probadas, reglas refutadas o solo razonables.

    `reglas` es el resumen guardado por el backtest de reglas. Tiene tres
    desenlaces posibles y los tres importan:

    - **refutada**: se probaron y perdieron dinero. Es el caso que ninguna app
      enseña, y el único que de verdad te ahorra dinero. Pesa más que cualquier
      otra señal, así que se devuelve aunque el modelo de factores esté calibrado.
    - **calibrada**: hay respaldo histórico con muestra suficiente.
    - **sin_calibrar**: son razonables y nada más.
    """
    if reglas and reglas.get("fiable"):
        esperanza = reglas.get("esperanza_pct")
        ventaja = reglas.get("ventaja_pct")
        if esperanza is not None and (
            esperanza <= 0 or (ventaja is not None and ventaja <= 0)
        ):
            return "refutada"
        return "calibrada"
    if signal.get("probability") is not None:
        return "calibrada"
    return "sin_calibrar"


def _tendencia(
    ultimo: float, sma200: float | None, crudo: bool | None, corrupta: bool = False
) -> bool | None:
    """¿Acompaña la tendencia? Con banda muerta alrededor de la media.

    Devuelve True (claramente encima), False (claramente debajo) o None (dentro
    de la banda: ni una cosa ni la otra). El estado intermedio es la pieza clave
    — sin él, «no está claro» se convierte por defecto en «está debajo», y esa
    conversión silenciosa es la que produce el vaivén.
    """
    if sma200 is None:
        # Sin media no hay banda, así que se acepta el booleano que trae el
        # proveedor... salvo que la media viniera y fuera ilegible. Ese caso
        # NO es «no hay media»: es «la media está corrupta», y el booleano se
        # calculó a partir de esa misma media, así que tampoco vale. Aceptarlo
        # sería creerle a la conclusión después de rechazar la premisa.
        return crudo if not corrupta else None
    if ultimo >= sma200 * (1 + BANDA_TENDENCIA_ENTRAR_PCT / 100):
        return True
    if ultimo <= sma200 * (1 - BANDA_TENDENCIA_SALIR_PCT / 100):
        return False
    return None
