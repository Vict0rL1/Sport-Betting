"""Análisis de CARTERA, no de acciones sueltas.

Ocho análisis buenos de ocho empresas no son un análisis de la cartera. La
diferencia no es de agregación: es que las preguntas cambian. «¿Es buena esta
empresa?» y «¿qué le pasa a mi dinero si el mercado se gira?» se contestan con
datos distintos, y la segunda no se deduce de ocho respuestas a la primera.

Cuatro cosas que solo se ven mirando el conjunto:

1. **Correlación entre posiciones.** Ocho tickers pueden ser una sola apuesta.
2. **Exposición agregada** por sector, geografía y características de factor.
3. **Concentración real**, que no es la del ticker más grande: es cuánta de la
   variación de la cartera la explica un solo movimiento común. Con un ETF
   dentro, además, tu exposición a una empresa es la directa MÁS la que llevas
   sin saberlo dentro del fondo.
4. **Qué le pasó a ESTA composición** en 2008, 2020 y 2022.

El límite honesto del punto 4, dicho una vez y en alto: aplicar los pesos de hoy
al pasado responde «cómo se habría comportado esta mezcla», no «cómo se habría
comportado tu cartera». La empresa de hoy tampoco es la de entonces — Apple en
2008 vendía iPods— y ninguna aritmética arregla eso. Sirve para ver de qué
tamaño es el riesgo, no para predecir la próxima caída.
"""

from __future__ import annotations

from datetime import date

import numpy as np
from app.formato import fmt_fecha, fmt_num, fmt_pct, plural

# Ventanas de crisis, pico a valle del S&P 500. Fechas fijas y públicas: no se
# eligen para que el resultado quede bonito, y por eso van escritas aquí y no
# calculadas sobre la propia cartera.
CRISIS = [
    {
        "clave": "2008",
        "nombre": "Crisis financiera de 2008",
        "desde": date(2007, 10, 9),
        "hasta": date(2009, 3, 9),
        "caida_sp500_pct": -56.8,
        "contexto": "Pico a valle del S&P 500. Diecisiete meses de caída sostenida.",
    },
    {
        "clave": "2020",
        "nombre": "Desplome de la COVID",
        "desde": date(2020, 2, 19),
        "hasta": date(2020, 3, 23),
        "caida_sp500_pct": -33.9,
        "contexto": "Treinta y tres días. La caída más rápida de la historia moderna.",
    },
    {
        "clave": "2022",
        "nombre": "Mercado bajista de 2022",
        "desde": date(2022, 1, 3),
        "hasta": date(2022, 10, 12),
        "caida_sp500_pct": -25.4,
        "contexto": "Subidas de tipos. Cayeron a la vez bonos y bolsa, que es lo raro.",
    },
]

# Por debajo de esta cobertura, el número agregado deja de describir la cartera.
COBERTURA_MINIMA = 0.50
MIN_OBSERVACIONES = 40  # para una correlación diaria que signifique algo

# Sesiones que se usan para correlacionar. Dos años: suficiente para que la
# correlación signifique algo y poco para que siga describiendo la cartera de
# ahora. La correlación media de 2007-2024 no es la correlación de tu cartera:
# es un promedio de regímenes que ya no existen.
VENTANA_CORRELACION = 504


# --- Correlación entre posiciones ---------------------------------------------


def ventana_reciente(
    series: dict[str, list[tuple[date, float]]], sesiones: int = VENTANA_CORRELACION
) -> dict[str, list[tuple[date, float]]]:
    """Se queda con las últimas N sesiones de cada serie.

    El estrés quiere TODO el histórico —2008 está en 2008— pero la correlación
    quiere el reciente. Son preguntas distintas sobre los mismos precios y
    mezclarlas da una correlación media de regímenes que ya no existen.
    """
    return {s: sorted(p)[-sesiones:] for s, p in series.items() if p}


def volatilidad_anualizada(
    puntos: list[tuple[date, float]], sesiones: int = 252
) -> float | None:
    """Volatilidad anualizada en %, del último año de cierres.

    Se calcula aquí y no se pide a ninguna API porque el histórico ya está
    descargado para el estrés: gastar una llamada por posición para un número
    que sale de datos que ya tenemos sería pagar dos veces por lo mismo.
    """
    cierres = [v for _, v in sorted(puntos)[-(sesiones + 1) :]]
    retornos = [
        cierres[i] / cierres[i - 1] - 1 for i in range(1, len(cierres)) if cierres[i - 1]
    ]
    if len(retornos) < 60:
        return None
    media = sum(retornos) / len(retornos)
    varianza = sum((r - media) ** 2 for r in retornos) / (len(retornos) - 1)
    return (varianza**0.5) * (252**0.5) * 100


def _alinear(
    series: dict[str, list[tuple[date, float]]],
) -> tuple[list[str], np.ndarray, list[date]]:
    """Retornos diarios en las fechas COMUNES a todas las posiciones.

    Alinear es obligatorio: correlacionar dos series con fechas distintas mide el
    calendario, no las empresas. El precio se convierte a retorno porque dos
    precios que suben correlacionan siempre — lo que interesa es si se mueven
    juntos día a día.
    """
    if len(series) < 2:
        return [], np.empty((0, 0)), []
    comunes: set[date] | None = None
    for puntos in series.values():
        fechas = {d for d, _ in puntos}
        comunes = fechas if comunes is None else (comunes & fechas)
    if not comunes or len(comunes) < MIN_OBSERVACIONES + 1:
        return [], np.empty((0, 0)), []

    orden = sorted(comunes)
    simbolos = sorted(series)
    filas = []
    for s in simbolos:
        precios = dict(series[s])
        valores = [precios[d] for d in orden]
        filas.append(
            [
                valores[i] / valores[i - 1] - 1 if valores[i - 1] else 0.0
                for i in range(1, len(valores))
            ]
        )
    return simbolos, np.array(filas), orden


def matriz_correlacion(series: dict[str, list[tuple[date, float]]]) -> dict:
    """Correlación de todos contra todos, sobre fechas comunes."""
    if len(series) < 2:
        return {
            "disponible": False,
            "nota": "Con una sola posición no hay nada que correlacionar.",
        }
    simbolos, retornos, fechas = _alinear(series)
    if len(simbolos) < 2:
        return {
            "disponible": False,
            "nota": (
                f"Las posiciones no comparten al menos {MIN_OBSERVACIONES + 1} "
                "sesiones de histórico. Correlacionar series con fechas distintas "
                "mide el calendario, no las empresas, así que no se calcula."
            ),
        }
    # Una serie plana (sin varianza) rompe la correlación: se descarta antes.
    vivas = [i for i in range(len(simbolos)) if retornos[i].std() > 0]
    if len(vivas) < 2:
        return {"disponible": False, "nota": "Las series no tienen variación que correlacionar."}
    descartadas = [simbolos[i] for i in range(len(simbolos)) if i not in vivas]
    simbolos = [simbolos[i] for i in vivas]
    corr = np.corrcoef(retornos[vivas])

    parejas = [
        {"a": simbolos[i], "b": simbolos[j], "corr": round(float(corr[i, j]), 3)}
        for i in range(len(simbolos))
        for j in range(i + 1, len(simbolos))
    ]
    parejas.sort(key=lambda p: -p["corr"])
    n_obs = retornos.shape[1]

    # La ventana la fija la posición con menos histórico: si una se compró el año
    # pasado, TODAS se correlacionan sobre ese año. Hay que decir cuál manda,
    # porque el usuario cree estar viendo la correlación de siempre.
    #
    # Solo se señala a una posición si de verdad es más corta que las demás.
    # Cuando todas empatan, la ventana la fija el recorte que se pide desde
    # fuera, y nombrar a una cualquiera acusaría a una posición inocente de
    # estar recortando algo que no recorta.
    longitudes = {s: len(p) for s, p in series.items()}
    mas_corta = min(longitudes, key=lambda s: longitudes[s])
    limita = mas_corta if longitudes[mas_corta] < max(longitudes.values()) else None
    return {
        "disponible": True,
        "simbolos": simbolos,
        "matriz": [[round(float(v), 3) for v in fila] for fila in corr],
        "parejas": parejas,
        "observaciones": n_obs,
        "desde": fechas[0].isoformat(),
        "hasta": fechas[-1].isoformat(),
        "limita_la_ventana": limita,
        "descartadas": descartadas,
        "media": round(float(np.mean([p["corr"] for p in parejas])), 3) if parejas else None,
        "nota": (
            f"Retornos diarios del {fmt_fecha(fechas[0])} al {fmt_fecha(fechas[-1])} "
            f"({n_obs} sesiones comunes a todas). Se mide sobre retornos y no sobre "
            "precios: dos precios que suben correlacionan siempre, y eso no dice nada. "
            + (
                f"La ventana la limita «{limita}», la posición con menos histórico: "
                "todas se correlacionan sobre el tramo que ella cubre."
                if limita
                else "Todas las posiciones cubren la ventana entera."
            )
            + (
                f" Se descartan {', '.join(descartadas)}: su precio no varía en esta "
                "ventana."
                if descartadas
                else ""
            )
        ),
    }


# --- Concentración real -------------------------------------------------------


def numero_efectivo_de_apuestas(corr: list[list[float]]) -> dict:
    """Cuántas apuestas INDEPENDIENTES hay de verdad detrás de N tickers.

    La concentración que se suele mirar —el peso del ticker más grande— no ve el
    problema de fondo: diez posiciones distintas que se mueven juntas son una
    sola apuesta repartida en diez recibos.

    Se descompone la matriz de correlación en sus componentes principales. La
    primera componente es el movimiento común —el «mercado» de esa cartera— y su
    peso en la varianza total dice cuánto del riesgo viene de una sola cosa. El
    número efectivo de apuestas es el inverso del índice de concentración de esos
    autovalores: con diez posiciones idénticas da 1, con diez independientes da
    10, y con una cartera real suele dar bastante menos de lo que uno espera.
    """
    matriz = np.array(corr, dtype=float)
    n = matriz.shape[0]
    if n < 2:
        return {"disponible": False, "nota": "Hacen falta al menos dos posiciones."}

    autovalores = np.linalg.eigvalsh(matriz)
    # Los autovalores de una matriz de correlación son >= 0; los negativos que
    # salen son ruido numérico y se recortan antes de normalizar.
    autovalores = np.clip(autovalores, 0, None)[::-1]
    total = autovalores.sum()
    if total <= 0:
        return {"disponible": False, "nota": "La matriz no tiene varianza que repartir."}

    pesos = autovalores / total
    efectivo = 1.0 / float((pesos**2).sum())
    primera = float(pesos[0])

    return {
        "disponible": True,
        "posiciones": n,
        "apuestas_efectivas": round(efectivo, 2),
        "primera_componente_pct": round(primera * 100, 1),
        "autovalores_pct": [round(float(p) * 100, 1) for p in pesos[: min(n, 5)]],
        "nota": (
            f"Tienes {n} posiciones pero se comportan como "
            f"{fmt_num(efectivo, 1)} apuestas independientes: el "
            f"{fmt_pct(primera, 0)} de la variación de la cartera la explica un "
            "solo movimiento común. "
            + (
                "Diversificar más dentro de ese movimiento no reduce el riesgo, "
                "solo reparte el mismo riesgo en más recibos."
                if efectivo < n * 0.5
                else "El reparto entre apuestas distintas es razonable."
            )
        ),
    }


def look_through_etf(posiciones: list[dict], holdings: dict[str, list[dict]]) -> dict:
    """Tu exposición REAL a cada empresa: la directa más la que llevas dentro.

    Si tienes AAPL y también un ETF del S&P 500, tu exposición a Apple no es la
    de tu posición en AAPL: es esa más el 7 % de Apple que lleva dentro el fondo.
    Es la forma más común de estar más concentrado de lo que uno cree, y no se ve
    en ninguna tabla de posiciones.

    Límite que hay que decir: la fuente gratuita solo da los ~10 mayores holdings
    de cada ETF, así que esto ve la punta del iceberg. Lo que encuentre es real;
    lo que no salga puede existir igualmente.
    """
    directa = {p["symbol"]: p["peso_pct"] for p in posiciones}
    indirecta: dict[str, dict] = {}
    cobertura: dict[str, float] = {}
    etfs_vistos, etfs_sin_datos = [], []

    for p in posiciones:
        lista = holdings.get(p["symbol"])
        if not lista:
            if p.get("es_etf"):
                etfs_sin_datos.append(p["symbol"])
            continue
        etfs_vistos.append(p["symbol"])
        cubierto = 0.0
        for h in lista:
            peso = h.get("weight")
            sub = (h.get("symbol") or "").upper()
            if not peso or not sub:
                continue
            cubierto += peso
            entrada = indirecta.setdefault(sub, {"pct": 0.0, "via": []})
            entrada["pct"] += p["peso_pct"] * peso
            entrada["via"].append(
                {"etf": p["symbol"], "peso_en_etf_pct": round(peso * 100, 2)}
            )
        # Cuánto del fondo ven estos ~10 holdings. Un 30 % de cobertura y un 95 %
        # dicen cosas muy distintas sobre lo que este cálculo se está perdiendo.
        cobertura[p["symbol"]] = round(cubierto * 100, 1)

    combinada = []
    for sym in sorted(set(directa) | set(indirecta)):
        d = directa.get(sym, 0.0)
        i = indirecta.get(sym, {}).get("pct", 0.0)
        if d + i <= 0:
            continue
        combinada.append(
            {
                "symbol": sym,
                "directa_pct": round(d, 2),
                "indirecta_pct": round(i, 2),
                "total_pct": round(d + i, 2),
                "via": indirecta.get(sym, {}).get("via", []),
            }
        )
    combinada.sort(key=lambda x: -x["total_pct"])

    ocultas = [c for c in combinada if c["indirecta_pct"] > 0 and c["directa_pct"] > 0]
    return {
        "disponible": bool(etfs_vistos),
        "exposicion": combinada,
        "etfs_analizados": etfs_vistos,
        "etfs_sin_composicion": etfs_sin_datos,
        "cobertura_por_etf_pct": cobertura,
        "duplicadas": [c["symbol"] for c in ocultas],
        "nota": (
            (
                f"{len(ocultas)} {plural(len(ocultas), 'empresa la', 'empresas las')} tienes por dos vías a la vez "
                f"({', '.join(c['symbol'] for c in ocultas[:5])}): posición directa "
                "más lo que llevas dentro de un ETF. Es la forma más común de estar "
                "más concentrado de lo que uno cree."
                if ocultas
                else "Ninguna posición directa se solapa con lo que llevas dentro de "
                "los ETFs analizados."
            )
            + " La fuente gratuita solo da los ~10 mayores holdings de cada fondo, "
            "así que esto ve la punta: lo que encuentra es real, lo que no sale "
            "puede existir igual."
            if etfs_vistos
            else "No hay ETFs en la cartera, o no se pudo leer su composición."
        ),
    }


# --- Exposición agregada ------------------------------------------------------


def exposicion(posiciones: list[dict], clave: str, etiqueta_vacia: str) -> dict:
    """Peso agregado por una dimensión (sector, país…), con lo desconocido aparte.

    Lo que no tiene dato va a su propio cubo y se cuenta. Repartirlo entre los
    demás o esconderlo daría una foto más limpia y menos cierta: si un tercio de
    la cartera no tiene país conocido, esa es la información.
    """
    cubos: dict[str, float] = {}
    for p in posiciones:
        cubos[p.get(clave) or etiqueta_vacia] = cubos.get(
            p.get(clave) or etiqueta_vacia, 0.0
        ) + p["peso_pct"]

    filas = sorted(
        ({"etiqueta": k, "peso_pct": round(v, 2)} for k, v in cubos.items()),
        key=lambda x: -x["peso_pct"],
    )
    desconocido = next((f["peso_pct"] for f in filas if f["etiqueta"] == etiqueta_vacia), 0.0)
    mayor = filas[0] if filas else None
    return {
        "filas": filas,
        "desconocido_pct": desconocido,
        "concentracion_mayor_pct": mayor["peso_pct"] if mayor else None,
        "nota": (
            (
                f"«{mayor['etiqueta']}» concentra el {fmt_pct(mayor['peso_pct'], 0, en_puntos=True)} de la "
                "cartera."
                if mayor and mayor["etiqueta"] != etiqueta_vacia
                else ""
            )
            + (
                f" Un {fmt_pct(desconocido, 0, en_puntos=True)} no tiene este dato y se cuenta aparte: "
                "repartirlo entre los demás daría una foto más limpia y menos cierta."
                if desconocido > 0
                else ""
            )
        ).strip(),
    }


def caracteristicas_ponderadas(posiciones: list[dict], referencia: dict | None = None) -> dict:
    """Las características medias de la cartera, ponderadas por peso.

    Esto NO es una exposición a factores en el sentido académico —para eso hace
    falta una regresión contra series de factores que las fuentes gratuitas no
    dan— y llamarlo así sería vestir de rigor una media ponderada. Es lo que es:
    cómo se ve tu cartera en las dimensiones que mueven los factores.

    Con una referencia (la empresa típica del universo escaneado) sí se puede
    decir hacia dónde te inclinas, que es la pregunta útil. Sin ella se dice que
    falta.
    """
    campos = {
        "pe_ttm": ("P/E medio", "value", False),
        "roe": ("ROE medio", "quality", True),
        "revenue_growth_5y": ("Crecimiento de ingresos", "growth", True),
        "vol_anual_pct": ("Volatilidad anualizada", "low_volatility", False),
        "market_cap": ("Capitalización media", "size", True),
    }
    salida = []
    for campo, (etiqueta, familia, alto_es_mas) in campos.items():
        con_dato = [p for p in posiciones if p.get(campo) is not None]
        peso = sum(p["peso_pct"] for p in con_dato)
        if peso <= 0:
            salida.append(
                {
                    "campo": campo,
                    "etiqueta": etiqueta,
                    "familia": familia,
                    "valor": None,
                    "cobertura_pct": 0.0,
                    "motivo": "Ninguna posición tiene este dato.",
                }
            )
            continue
        valor = sum(p[campo] * p["peso_pct"] for p in con_dato) / peso
        fila = {
            "campo": campo,
            "etiqueta": etiqueta,
            "familia": familia,
            "valor": round(valor, 4),
            "cobertura_pct": round(peso, 1),
        }
        ref = (referencia or {}).get(campo)
        if ref:
            fila["referencia"] = round(ref, 4)
            fila["desvio_pct"] = round((valor / ref - 1) * 100, 1) if ref else None
            inclina = valor > ref if alto_es_mas else valor < ref
            fila["inclinacion"] = "hacia" if inclina else "en contra"
        salida.append(fila)

    return {
        "caracteristicas": salida,
        "con_referencia": bool(referencia),
        "nota": (
            "A la izquierda, dónde está TU DINERO: media ponderada por peso. A la "
            "derecha, la empresa TÍPICA del universo escaneado: mediana, porque un "
            "P/E de 900 de una empresa que casi no gana dinero arrastra cualquier "
            "media. Son dos estadísticos distintos a propósito, y la comparación "
            "que interesa es justo esa. Es una inclinación descriptiva, no una "
            "exposición a factores estimada por regresión: para eso harían falta "
            "series de factores que las fuentes gratuitas no dan."
            if referencia
            else "Medias ponderadas de la cartera. SIN referencia con la que "
            "compararlas no dicen si estás inclinado hacia algo: ejecuta el barrido "
            "de mercado en «Hoy» y la comparación aparece sola."
        ),
    }


# --- Estrés en crisis reales ---------------------------------------------------


def _tramo(puntos: list[tuple[date, float]], desde: date, hasta: date) -> list[tuple[date, float]]:
    return [(d, v) for d, v in puntos if desde <= d <= hasta]


def estres_en_crisis(
    posiciones: list[dict],
    series: dict[str, list[tuple[date, float]]],
    crisis: list[dict] | None = None,
) -> dict:
    """Qué le habría pasado a ESTA mezcla en cada crisis, con su cobertura.

    La honestidad de esta función está en el denominador. Si de ocho posiciones
    solo tres existían en 2008, el resultado NO es «tu cartera en 2008»: es «las
    tres que existían, reponderadas». Se calcula igual —es informativo— pero se
    dice qué fracción del dinero cubre, y por debajo de la mitad se retira el
    titular en vez de dejar que un número parcial pase por completo.

    Se simula con mezcla constante, rebalanceando a los pesos de hoy, por la
    misma razón que en `sizing.peor_ventana`: comprar y no tocar deja que los
    pesos deriven y acaba midiendo otra cartera.
    """
    resultados = []
    for c in crisis or CRISIS:
        cubiertas, sin_datos = [], []
        for p in posiciones:
            tramo = _tramo(series.get(p["symbol"]) or [], c["desde"], c["hasta"])
            # Se exige cubrir el tramo casi entero: unas pocas sesiones sueltas
            # dentro de una caída de un año no describen esa caída.
            if len(tramo) >= 20:
                cubiertas.append((p, sorted(tramo)))
            else:
                sin_datos.append(p["symbol"])

        peso_cubierto = sum(p["peso_pct"] for p, _ in cubiertas)
        peso_total = sum(p["peso_pct"] for p in posiciones) or 1.0
        cobertura = peso_cubierto / peso_total

        if not cubiertas or cobertura <= 0:
            resultados.append(
                {
                    **_meta(c),
                    "medible": False,
                    "cobertura_pct": 0.0,
                    "sin_datos": sin_datos,
                    "nota": (
                        f"Ninguna posición tiene histórico de {c['clave']}. No es que "
                        "aguantara bien: es que no existía o no hay datos."
                    ),
                }
            )
            continue

        # Fechas comunes a las cubiertas, y mezcla constante sobre ellas.
        comunes = None
        for _, tramo in cubiertas:
            fechas = {d for d, _ in tramo}
            comunes = fechas if comunes is None else (comunes & fechas)
        orden = sorted(comunes or [])
        if len(orden) < 20:
            resultados.append(
                {
                    **_meta(c),
                    "medible": False,
                    "cobertura_pct": round(cobertura * 100, 1),
                    "sin_datos": sin_datos,
                    "nota": "Las posiciones cubiertas no comparten suficientes sesiones.",
                }
            )
            continue

        normal = {p["symbol"]: p["peso_pct"] / peso_cubierto for p, _ in cubiertas}
        precios = {p["symbol"]: dict(tramo) for p, tramo in cubiertas}
        valor, curva = 1.0, []
        for anterior, hoy in zip(orden, orden[1:]):
            r = 0.0
            for sym, w in normal.items():
                p0, p1 = precios[sym][anterior], precios[sym][hoy]
                if p0:
                    r += w * (p1 / p0 - 1)
            valor *= 1 + r
            curva.append(valor)

        pico, peor = 1.0, 0.0
        for v in curva:
            pico = max(pico, v)
            peor = min(peor, v / pico - 1)
        retorno = (curva[-1] - 1) if curva else 0.0

        resultados.append(
            {
                **_meta(c),
                "medible": True,
                "retorno_pct": round(retorno * 100, 1),
                "max_drawdown_pct": round(peor * 100, 1),
                "vs_sp500_pp": round(retorno * 100 - c["caida_sp500_pct"], 1),
                "cobertura_pct": round(cobertura * 100, 1),
                "posiciones_cubiertas": len(cubiertas),
                "posiciones_totales": len(posiciones),
                "sin_datos": sin_datos,
                "sesiones": len(orden),
                "titular_fiable": cobertura >= COBERTURA_MINIMA,
                # El recorrido, no solo el destino. Un −45 % que llega en línea
                # recta y otro que baja un 60 %, rebota y se queda en −45 % son
                # experiencias distintas, y la segunda es la que hace vender en
                # el peor momento. El dato ya estaba calculado aquí dentro.
                "curva": _remuestrear(curva, orden[1:]),
                "nota": _leer_cobertura(cobertura, sin_datos, c, retorno),
            }
        )

    medibles = [r for r in resultados if r.get("medible")]
    return {
        "crisis": resultados,
        "medibles": len(medibles),
        "aviso_general": (
            "Aplicar los pesos de HOY al pasado responde «cómo se habría "
            "comportado esta mezcla», no «cómo se habría comportado tu cartera»: "
            "en 2008 no la tenías. Y la empresa de hoy tampoco es la de entonces "
            "—Apple en 2008 vendía iPods—, así que ninguna aritmética arregla eso. "
            "Sirve para ver de qué tamaño es el riesgo, no para predecir la "
            "próxima caída."
        ),
    }


PUNTOS_CURVA = 60


def _remuestrear(
    curva: list[float], fechas: list[date], n: int = PUNTOS_CURVA
) -> list[dict]:
    """Adelgaza la curva para que quepa en el payload, SIN perder el suelo.

    Diecisiete meses de 2008 son ~370 sesiones, y tres crisis a resolución
    completa engordan la respuesta para pintar una línea de 300 píxeles.

    Lo que no puede pasar es que el remuestreo se salte el mínimo. Coger una de
    cada seis sesiones tiene bastantes papeletas de perderse justo el día del
    suelo, y entonces el gráfico enseñaría una caída más suave que la que dice
    el titular de al lado: dos números contradiciéndose en la misma tarjeta, y
    el que parece más creíble es el dibujo. El mínimo y el máximo se fuerzan
    dentro siempre.
    """
    if not curva:
        return []
    total = len(curva)
    if total <= n:
        indices = list(range(total))
    else:
        paso = (total - 1) / (n - 1)
        indices = {round(i * paso) for i in range(n)}
        indices.add(0)
        indices.add(total - 1)
        indices.add(min(range(total), key=lambda i: curva[i]))  # el suelo
        indices.add(max(range(total), key=lambda i: curva[i]))  # el techo
        indices = sorted(indices)

    return [
        {
            "fecha": fechas[i].isoformat() if i < len(fechas) else None,
            # Base 100: comparable entre crisis sin que nadie divida nada.
            "valor": round(curva[i] * 100, 2),
        }
        for i in indices
    ]


def _meta(c: dict) -> dict:
    return {
        "clave": c["clave"],
        "nombre": c["nombre"],
        "desde": c["desde"].isoformat(),
        "hasta": c["hasta"].isoformat(),
        "caida_sp500_pct": c["caida_sp500_pct"],
        "contexto": c["contexto"],
    }


def _leer_cobertura(cobertura: float, sin_datos: list[str], c: dict, retorno: float) -> str:
    if cobertura < COBERTURA_MINIMA:
        return (
            f"Solo el {fmt_pct(cobertura, 0)} de la cartera tiene histórico de "
            f"{c['clave']} (faltan {', '.join(sin_datos[:5])}). El número de arriba "
            "describe esa parte reponderada, NO tu cartera: con menos de la mitad "
            "cubierta no se puede llamar de otra forma."
        )
    parte = (
        "Cubre la cartera entera."
        if not sin_datos
        else f"Cubre el {fmt_pct(cobertura, 0)} de la cartera; faltan "
        f"{', '.join(sin_datos[:4])}."
    )
    pct = retorno * 100
    caida_indice = abs(c["caida_sp500_pct"])
    if abs(pct) < 1:
        comparacion = (
            f"Se habría quedado plana mientras el S&P 500 caía un {fmt_pct(caida_indice, 0, en_puntos=True)}."
        )
    elif pct > 0:
        comparacion = (
            f"Habría SUBIDO un {fmt_pct(pct, 0, en_puntos=True)} mientras el S&P 500 caía un "
            f"{fmt_pct(caida_indice, 0, en_puntos=True)}."
        )
    elif pct < c["caida_sp500_pct"]:
        comparacion = (
            f"Habría caído un {fmt_pct(abs(pct), 0, en_puntos=True)}, MÁS que el {fmt_pct(caida_indice, 0, en_puntos=True)} del "
            "S&P 500."
        )
    else:
        comparacion = (
            f"Habría caído un {fmt_pct(abs(pct), 0, en_puntos=True)}, menos que el {fmt_pct(caida_indice, 0, en_puntos=True)} del "
            "S&P 500."
        )
    return f"{parte} {comparacion}"


# --- Contribución al riesgo ------------------------------------------------------
#
# «AAPL es el 15 % de la cartera» dice dónde está el DINERO. La pregunta de
# riesgo es otra: ¿cuánto de lo que se mueve la cartera lo mueve AAPL? Una
# posición pequeña y muy volátil, correlacionada con el resto, puede aportar
# más riesgo que una grande y tranquila. Se usa la descomposición estándar de
# la volatilidad de la cartera (Euler):
#
#     σ_p = √(wᵀ Σ w)
#     marginal_i   = (Σw)_i / σ_p          cuánto sube σ_p por unidad de peso
#     componente_i = w_i · marginal_i      su parte de σ_p; suman σ_p exactamente
#     %_i          = componente_i / σ_p    suman 100 %
#
# Lo que NO se puede medir no aporta cero: queda DESCONOCIDO y fuera, y el
# total dice qué parte de la cartera describe.

SESIONES_ANO = 252
UMBRAL_CLUSTER_CORRELACION = 0.70
UMBRAL_BETA_ALTA = 1.3


def _comunes(series: dict[str, list[tuple[date, float]]], minimo: int) -> tuple[list[str], list[str], list[date]]:
    """Qué posiciones comparten histórico suficiente, quitando de una en una la
    más corta hasta que el tramo común alcance el mínimo. Devuelve (dentro,
    fuera por histórico, fechas comunes)."""
    dentro = [s for s, p in series.items() if len(p) >= minimo + 1]
    fuera = [s for s in series if s not in dentro]
    while dentro:
        comunes = None
        for s in dentro:
            fechas = {d for d, _ in series[s]}
            comunes = fechas if comunes is None else comunes & fechas
        if comunes is not None and len(comunes) >= minimo + 1:
            return dentro, fuera, sorted(comunes)
        corta = min(dentro, key=lambda s: len(series[s]))
        dentro.remove(corta)
        fuera.append(corta)
    return [], fuera, []


def contribucion_al_riesgo(
    posiciones: list[dict],
    series: dict[str, list[tuple[date, float]]],
    *,
    mercado: list[tuple[date, float]] | None = None,
    minimo: int = MIN_OBSERVACIONES,
    sesiones: int = VENTANA_CORRELACION,
) -> dict:
    """Cuánto riesgo aporta cada posición, no cuánto pesa.

    `posiciones`: [{symbol, peso (fracción del TOTAL de la cartera), sector,
    industria, moneda}]. `series`: cierres EN LA MONEDA BASE (si no, una
    posición canadiense mediría su riesgo sin el del tipo de cambio).
    `mercado`: cierres de un índice para la beta; opcional.
    """
    pesos = {p["symbol"]: datos_peso for p in posiciones if (datos_peso := p.get("peso")) is not None}
    con_serie = {s: sorted(series[s])[-sesiones - 1:] for s in pesos if series.get(s)}
    dentro, fuera, fechas = _comunes(con_serie, minimo)
    desconocidas = [
        {"symbol": p["symbol"], "peso": p.get("peso"), "estado": "desconocido",
         "motivo": p.get("motivo") or (
             "sin histórico de precios" if p["symbol"] not in con_serie
             else "histórico insuficiente para el tramo común" if p["symbol"] in fuera
             else "sin peso")}
        for p in posiciones if p["symbol"] not in dentro
    ]
    peso_medido = sum(pesos[s] for s in dentro)
    peso_total = sum(v for v in pesos.values()) or None
    base = {
        "metodo": "descomposición de Euler de la volatilidad: σ_p = √(wᵀΣw), componente_i = w_i·(Σw)_i/σ_p",
        "desconocidas": desconocidas,
        "cobertura_peso": round(peso_medido / peso_total, 4) if peso_total else None,
    }
    if len(dentro) < 1 or not fechas:
        return {**base, "disponible": False, "posiciones": [],
                "nota": "Ninguna posición tiene histórico suficiente: el riesgo es DESCONOCIDO, no cero."}

    simbolos = sorted(dentro)
    filas = []
    for s in simbolos:
        precios = dict(con_serie[s])
        v = [precios[d] for d in fechas]
        filas.append([v[i] / v[i - 1] - 1 if v[i - 1] else 0.0 for i in range(1, len(v))])
    r = np.array(filas)
    cov = np.atleast_2d(np.cov(r)) * SESIONES_ANO
    w = np.array([pesos[s] for s in simbolos])
    var_p = float(w @ cov @ w)
    if not np.isfinite(var_p) or var_p <= 0:
        return {**base, "disponible": False, "posiciones": [],
                "nota": "La covarianza no es utilizable (series planas): riesgo desconocido."}
    sigma = var_p ** 0.5
    sw = cov @ w
    vols = np.sqrt(np.diag(cov))

    betas_mercado: dict[str, float | None] = {}
    if mercado:
        m = dict(sorted(mercado))
        if all(d in m for d in fechas):
            mv = [m[d] for d in fechas]
            rm = np.array([mv[i] / mv[i - 1] - 1 if mv[i - 1] else 0.0 for i in range(1, len(mv))])
            var_m = float(np.var(rm, ddof=1))
            for i, s in enumerate(simbolos):
                betas_mercado[s] = round(float(np.cov(r[i], rm)[0, 1] / var_m), 3) if var_m > 0 else None

    meta = {p["symbol"]: p for p in posiciones}
    resultado = []
    for i, s in enumerate(simbolos):
        componente = float(w[i] * sw[i] / sigma)
        pct = componente / sigma
        peso_rel = pesos[s] / peso_medido if peso_medido else None
        resultado.append({
            "symbol": s,
            "estado": "valido",
            "sector": meta[s].get("sector"),
            "industria": meta[s].get("industria"),
            "moneda": meta[s].get("moneda"),
            "peso": round(pesos[s], 6),
            "volatilidad": round(float(vols[i]), 6),
            "marginal": round(float(sw[i] / sigma), 6),
            "componente": round(componente, 6),
            "contribucion": round(pct, 6),
            "correlacion_con_cartera": round(float(sw[i] / (vols[i] * sigma)), 4) if vols[i] > 0 else None,
            "beta_a_la_cartera": round(float(sw[i] / var_p), 4),
            "beta_mercado": betas_mercado.get(s),
            # >1: aporta más riesgo que dinero. Es la frase que distingue peso de riesgo.
            "riesgo_por_peso": round(pct / peso_rel, 3) if peso_rel else None,
        })
    resultado.sort(key=lambda x: -x["contribucion"])

    corr = np.corrcoef(r) if len(simbolos) > 1 else np.array([[1.0]])
    parejas = {(simbolos[i], simbolos[j]): float(corr[i, j])
               for i in range(len(simbolos)) for j in range(i + 1, len(simbolos))}
    for x in resultado:
        otras = [c for (a, b), c in parejas.items() if x["symbol"] in (a, b)]
        x["cluster_nivel"] = (
            None if not otras else "alto" if max(otras) >= UMBRAL_CLUSTER_CORRELACION
            else "moderado" if sum(otras) / len(otras) >= 0.4 else "bajo"
        )

    por_peso = sorted((p for p in posiciones if p.get("peso") is not None), key=lambda p: -p["peso"])[:3]
    return {
        **base,
        "disponible": True,
        "volatilidad_cartera_medida": round(sigma, 6),
        "posiciones": resultado,
        "observaciones": len(fechas) - 1,
        "desde": fechas[0].isoformat(),
        "hasta": fechas[-1].isoformat(),
        "concentracion": {
            "top3_capital": {"symbols": [p["symbol"] for p in por_peso],
                             "peso": round(sum(p["peso"] for p in por_peso) / (peso_total or 1), 4)},
            "top3_riesgo": {"symbols": [x["symbol"] for x in resultado[:3]],
                            "contribucion": round(sum(x["contribucion"] for x in resultado[:3]), 4)},
        },
        "clusters": clusters_de_riesgo(resultado, desconocidas, parejas, posiciones),
        "nota": (
            f"Riesgo medido sobre el {fmt_pct(peso_medido / (peso_total or 1), 0)} de la cartera "
            f"({len(fechas) - 1} sesiones comunes, {fmt_fecha(fechas[0])} → {fmt_fecha(fechas[-1])}). "
            + (f"{len(desconocidas)} {plural(len(desconocidas), 'posición', 'posiciones')} con riesgo DESCONOCIDO "
               f"{plural(len(desconocidas), 'queda', 'quedan')} fuera: el riesgo "
               "real es mayor que el medido, no igual." if desconocidas else "Todas las posiciones medidas.")
        ),
    }


def clusters_de_riesgo(
    medidas: list[dict], desconocidas: list[dict], parejas: dict[tuple[str, str], float], posiciones: list[dict]
) -> list[dict]:
    """Grupos que se mueven juntos o comparten exposición, con su riesgo.

    Modular a propósito: cada dimensión es un criterio objetivo que ya existe
    (sector, industria, moneda, correlación medida, beta). Un modelo de factores
    sería mejor y no hay infraestructura para él; esto no lo finge.
    """
    por_symbol = {x["symbol"]: x for x in medidas}
    meta = {p["symbol"]: p for p in posiciones}
    salida = []

    def grupo(dimension: str, etiqueta: str, miembros: list[str], criterio: str):
        if len(miembros) < 2:
            return
        conocidos = [m for m in miembros if m in por_symbol]
        salida.append({
            "dimension": dimension, "etiqueta": etiqueta, "miembros": sorted(miembros),
            "peso": round(sum(meta[m].get("peso") or 0.0 for m in miembros), 4),
            "contribucion": round(sum(por_symbol[m]["contribucion"] for m in conocidos), 4),
            "desconocidos": sorted(m for m in miembros if m not in por_symbol),
            "criterio": criterio,
        })

    for campo, dimension in (("sector", "sector"), ("industria", "industria"), ("moneda", "moneda")):
        valores: dict[str, list[str]] = {}
        for p in posiciones:
            if p.get(campo):
                valores.setdefault(p[campo], []).append(p["symbol"])
        for valor, miembros in valores.items():
            grupo(dimension, valor, miembros, f"mismo {dimension}")

    from app.analysis.sizing import agrupar_por_correlacion

    for i, miembros in enumerate(agrupar_por_correlacion(list(por_symbol), parejas, UMBRAL_CLUSTER_CORRELACION)):
        grupo("correlacion", f"Se mueven juntas #{i + 1}", miembros,
              f"correlación ≥ {fmt_num(UMBRAL_CLUSTER_CORRELACION, 2, ceros=False)} con al menos otra del grupo")
    altas = [x["symbol"] for x in medidas if (x.get("beta_mercado") or 0) >= UMBRAL_BETA_ALTA]
    grupo("beta", "Muy sensibles al mercado", altas, f"beta frente al índice ≥ {fmt_num(UMBRAL_BETA_ALTA, 2, ceros=False)}")
    salida.sort(key=lambda g: -g["contribucion"])
    return salida


def riesgo_de_anadir(
    posiciones: list[dict],
    series: dict[str, list[tuple[date, float]]],
    candidato: str,
    serie_candidato: list[tuple[date, float]],
    peso_candidato: float,
) -> dict:
    """¿Qué le hace a la cartera añadir `candidato` con este peso?

    Los pesos actuales se reescalan por (1 − peso nuevo): el dinero sale de
    alguna parte. Es una foto con las covarianzas medidas, no una predicción.
    """
    antes = contribucion_al_riesgo(posiciones, series)
    escaladas = [{**p, "peso": (p.get("peso") or 0.0) * (1 - peso_candidato)} for p in posiciones if p.get("peso") is not None]
    despues = contribucion_al_riesgo(
        escaladas + [{"symbol": candidato, "peso": peso_candidato}],
        {**series, candidato: serie_candidato},
    )
    fila = next((x for x in despues.get("posiciones") or [] if x["symbol"] == candidato), None)
    if not antes.get("disponible") or fila is None:
        return {"disponible": False, "estado": "desconocido",
                "motivo": "sin histórico común suficiente entre la cartera y el candidato"}
    return {
        "disponible": True,
        "peso_supuesto": peso_candidato,
        "volatilidad_antes": antes["volatilidad_cartera_medida"],
        "volatilidad_despues": despues["volatilidad_cartera_medida"],
        "contribucion_del_candidato": fila["contribucion"],
        "correlacion_con_cartera": fila["correlacion_con_cartera"],
        "riesgo_por_peso": fila["riesgo_por_peso"],
        "cluster_nivel": fila["cluster_nivel"],
        "desconocidas": despues["desconocidas"],
        "nota": "Con las covarianzas del último periodo medido; las posiciones sin histórico quedan fuera y se nombran.",
    }
