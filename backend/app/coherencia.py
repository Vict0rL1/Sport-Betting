"""Coherencia interna de los datos reales: lo que los tests no pueden ver.

Los tests corren con dobles: prueban que el código hace lo que dice con datos
que el propio test fabrica. No prueban que EDGAR etiquete los trimestres como
el parser supone, que el consenso de Finnhub venga en dólares y no en millones,
ni que un proveedor no mande fechas del futuro. Eso solo se ve con datos
reales, y aquí se comprueba sin necesitar ninguna «verdad» externa: los datos
se cruzan entre sí.

`validacion.py` es otra cosa: valida cada respuesta en la frontera del
proveedor (¿es utilizable este precio?). Esto cruza respuestas ya aceptadas
(¿cuadran los cuatro trimestres con el año?).

Cada comprobación devuelve filas `{comprobacion, simbolo, estado, detalle}` con
estado PASS, FAIL o UNKNOWN. UNKNOWN no es PASS: es «no se pudo comprobar» y
se dice por qué. Funciones puras: el script `scripts/validar_con_datos_reales.py`
reúne los datos; los tests las prueban con datos fabricados.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from app import datos
from app.formato import fmt_num, fmt_pct, plural

PASS, FAIL, UNKNOWN = "PASS", "FAIL", "UNKNOWN"

# Tolerancias. Son las de este fichero y viajan en cada detalle.
TOLERANCIA_SUMA_TRIMESTRES = 0.01   # 1 % entre Q1+Q2+Q3+Q4 y el año
RETRASO_MAXIMO_TRIMESTRE = 120      # días entre cierre y primera publicación
RETRASO_MAXIMO_ANUAL = 200
DESVIO_MAXIMO_COTIZACION = 0.10     # 10 % entre la cotización y el último cierre
DIAS_MAXIMOS_ULTIMO_CIERRE = 7

FLUJOS = ("revenue", "net_income", "cfo")


def _fila(comprobacion: str, simbolo: str | None, estado: str, detalle: str, **extra) -> dict:
    return {"comprobacion": comprobacion, "simbolo": simbolo, "estado": estado, "detalle": detalle, **extra}


def _fecha(valor) -> date | None:
    if valor is None:
        return None
    try:
        return date.fromisoformat(str(valor)[:10])
    except ValueError:
        return None


# --- 1. Los cuatro trimestres suman el año ------------------------------------------


def trimestres_frente_al_ano(simbolo: str, financials: dict, ejercicios: int = 2) -> list[dict]:
    """Q1+Q2+Q3+Q4 de cada flujo frente al ejercicio anual, en los últimos
    `ejercicios` con los cuatro trimestres.

    El cuarto trimestre se deriva como año − nueve meses, pero los trimestres
    conservan la cifra publicada PRIMERO y el año puede ser una reexpresión: si
    no cuadran, o el año se reexpresó (y entonces hay que saber cuál se usa), o
    el parser asignó mal un trimestre a su ejercicio. Un cuarto trimestre de
    ingresos negativo es siempre un error de asignación.
    """
    anuales = {str(p.get("fiscal_year")): p for p in financials.get("periods") or [] if p.get("fiscal_year")}
    por_ano: dict[str, dict[str, dict]] = {}
    for q in financials.get("quarters") or []:
        if q.get("fiscal_year") and q.get("fiscal_period"):
            por_ano.setdefault(str(q["fiscal_year"]), {})[q["fiscal_period"]] = q
    completos = [a for a in sorted(por_ano) if a in anuales and {"Q1", "Q2", "Q3", "Q4"} <= set(por_ano[a])]
    if not completos:
        return [_fila("trimestres_suman_el_ano", simbolo, UNKNOWN,
                      "ningún ejercicio con sus cuatro trimestres y el anual a la vez")]
    filas = []
    for ano in completos[-ejercicios:]:
        qs, anual = por_ano[ano], anuales[ano]
        for campo in FLUJOS:
            valores = [datos.numero(qs[t].get(campo)) for t in ("Q1", "Q2", "Q3", "Q4")]
            total = datos.numero(anual.get(campo))
            nombre = f"trimestres_suman_el_ano:{campo}"
            if total is None or any(v is None for v in valores):
                filas.append(_fila(nombre, simbolo, UNKNOWN, f"FY{ano}: falta algún trimestre o el anual"))
                continue
            q4_derivado = bool(((qs["Q4"].get("fuentes") or {}).get(campo) or {}).get("derivado"))
            if campo == "revenue" and valores[3] <= 0:
                filas.append(_fila(nombre, simbolo, FAIL,
                                   f"FY{ano}: cuarto trimestre de ingresos {fmt_num(valores[3], 0)} (≤ 0): "
                                   "trimestre asignado al ejercicio equivocado", ejercicio=ano))
                continue
            suma = sum(valores)
            if total == 0:
                estado = PASS if suma == 0 else FAIL
                desvio = None
            else:
                desvio = suma / total - 1
                estado = PASS if abs(desvio) <= TOLERANCIA_SUMA_TRIMESTRES else FAIL
            filas.append(_fila(
                nombre, simbolo, estado,
                f"FY{ano}: suma {fmt_num(suma, 0)} frente a {fmt_num(total, 0)} anual"
                + (f" ({fmt_pct(desvio, 2, signo=True)}; tolerancia {fmt_pct(TOLERANCIA_SUMA_TRIMESTRES, 0)})" if desvio is not None else "")
                + ("; Q4 derivado (año − nueve meses)" if q4_derivado else "; Q4 publicado")
                + ("" if estado == PASS else ": ¿reexpresión del año o trimestre mal asignado?"),
                ejercicio=ano, desvio=desvio,
            ))
    return filas


# --- 2. Fechas de publicación ---------------------------------------------------------


def fechas_de_publicacion(simbolo: str, financials: dict, hoy: date | None = None) -> list[dict]:
    """Cada periodo se publicó después de cerrarse, no en el futuro, y dentro
    de un plazo razonable para ser la PRIMERA publicación.

    Publicado antes del cierre o en el futuro rompe la regla anti-anticipación
    de raíz. Publicado muy tarde no adelanta nada (es conservador), pero
    contradice «cifra publicada primero»: probablemente es la de un filing
    posterior.
    """
    hoy = hoy or datetime.now(timezone.utc).date()
    problemas, revisados, sin_fecha = [], 0, 0
    for tipo, lista, maximo in (("anual", financials.get("periods") or [], RETRASO_MAXIMO_ANUAL),
                                ("trimestre", financials.get("quarters") or [], RETRASO_MAXIMO_TRIMESTRE)):
        for p in lista:
            fin, publicado = _fecha(p.get("end_date")), _fecha(p.get("filed_at"))
            etiqueta = p.get("periodo") or p.get("fiscal_year") or p.get("end_date")
            if fin is None or publicado is None:
                sin_fecha += 1
                continue
            revisados += 1
            if publicado < fin:
                problemas.append(f"{tipo} {etiqueta}: publicado {publicado} ANTES de cerrar ({fin})")
            elif publicado > hoy:
                problemas.append(f"{tipo} {etiqueta}: publicado {publicado}, en el futuro")
            elif (publicado - fin).days > maximo:
                problemas.append(f"{tipo} {etiqueta}: {(publicado - fin).days} días tras el cierre "
                                 f"(máx. {maximo}): ¿no es la primera publicación?")
    if not revisados:
        return [_fila("fechas_de_publicacion", simbolo, UNKNOWN, "ningún periodo con cierre y publicación")]
    detalle = f"{revisados} periodos revisados" + (f", {sin_fecha} sin fecha" if sin_fecha else "")
    if problemas:
        return [_fila("fechas_de_publicacion", simbolo, FAIL, detalle + ": " + "; ".join(problemas[:5]))]
    return [_fila("fechas_de_publicacion", simbolo, PASS, detalle)]


# --- 3. Escala del consenso -----------------------------------------------------------


def escala_del_consenso(simbolo: str, evento: dict | None, trimestres: list[dict]) -> list[dict]:
    """El consenso del calendario frente al último trimestre publicado, con la
    MISMA regla que decide si se registra (`expectativas.comprobar_escala`)."""
    from app.analysis import expectativas as ev

    if not evento:
        return [_fila("escala_del_consenso", simbolo, UNKNOWN, "la empresa no aparece en el calendario de resultados")]
    filas = []
    for metrica, campo in (("eps_diluted", "eps_estimate"), ("revenue", "revenue_estimate")):
        valor = datos.numero(evento.get(campo))
        nombre = f"escala_del_consenso:{metrica}"
        if valor is None:
            filas.append(_fila(nombre, simbolo, UNKNOWN, f"el calendario no trae {campo}"))
            continue
        r = ev.comprobar_escala({"metrica": metrica, "valor": valor}, trimestres)
        estado = {"ok": PASS, "dudosa": FAIL}.get(r["estado"], UNKNOWN)
        detalle = r.get("motivo") or (
            f"{fmt_num(valor, 4, ceros=False)} frente a {fmt_num(r['referencia'], 4, ceros=False)} del trimestre "
            f"cerrado el {r['periodo_referencia']} ({fmt_num(r['ratio'], 0 if abs(r['ratio']) >= 100 else 2, ceros=False)} veces, banda "
            f"{fmt_num(r['banda'][0], 2, ceros=False)}–{fmt_num(r['banda'][1], 2, ceros=False)})"
        )
        filas.append(_fila(nombre, simbolo, estado, detalle))
    return filas


# --- 4. Tipos de cambio ---------------------------------------------------------------


def tipo_de_cambio(moneda: str, tipo: dict | None) -> list[dict]:
    """El tipo que usa la cartera: dentro de su banda de cordura (detecta una
    serie leída del revés) y fresco."""
    from app.analysis import fx

    nombre = f"tipo_de_cambio:{moneda}"
    if not tipo:
        return [_fila(nombre, None, UNKNOWN, "no se pidió (sin FRED configurado o moneda sin serie)")]
    if datos.numero(tipo.get("por_usd")) is None:
        return [_fila(nombre, None, FAIL, tipo.get("error") or "la serie no dio ningún tipo utilizable")]
    por_usd = tipo["por_usd"]
    banda = fx.BANDAS_POR_USD.get(moneda)
    if banda and not banda[0] <= por_usd <= banda[1]:
        return [_fila(nombre, None, FAIL, f"{fmt_num(por_usd, 4, ceros=False)} {moneda}/USD fuera de "
                                         f"{fmt_num(banda[0], 2, ceros=False)}–{fmt_num(banda[1], 2, ceros=False)}: ¿serie invertida?")]
    if not tipo.get("fresco"):
        return [_fila(nombre, None, FAIL, f"{fmt_num(por_usd, 4, ceros=False)} {moneda}/USD del {tipo.get('fecha')}: "
                                         f"más de {fx.DIAS_FRESCO} días")]
    return [_fila(nombre, None, PASS, f"{fmt_num(por_usd, 4, ceros=False)} {moneda}/USD del {tipo.get('fecha')} ({tipo.get('serie')})"
                  + ("" if banda else "; sin banda de cordura para esta moneda"))]


# --- 5. Cotización frente al último cierre --------------------------------------------


def cotizacion_frente_a_cierre(simbolo: str, quote: dict | None, barras: list[dict] | None,
                               hoy: date | None = None) -> list[dict]:
    """La cotización y el último cierre del histórico no pueden estar lejos: si
    lo están, uno de los dos es de otra acción, de otra moneda o de antes de un
    split."""
    hoy = hoy or datetime.now(timezone.utc).date()
    precio = datos.numero((quote or {}).get("price"))
    utiles = [b for b in barras or [] if datos.numero(b.get("close")) and _fecha(b.get("ts"))]
    if precio is None or not utiles:
        return [_fila("cotizacion_frente_a_cierre", simbolo, UNKNOWN,
                      "sin cotización" if precio is None else "sin histórico")]
    ultima = max(utiles, key=lambda b: str(b["ts"]))
    cierre, fecha = float(ultima["close"]), _fecha(ultima["ts"])
    desvio = precio / cierre - 1
    viejo = (hoy - fecha).days > DIAS_MAXIMOS_ULTIMO_CIERRE
    estado = FAIL if abs(desvio) > DESVIO_MAXIMO_COTIZACION or viejo else PASS
    detalle = (f"{fmt_num(precio, 4, ceros=False)} frente al cierre de {fmt_num(cierre, 4, ceros=False)} del {fecha} ({fmt_pct(desvio, 2, signo=True)}; máx. "
               f"{fmt_pct(DESVIO_MAXIMO_COTIZACION, 0)})")
    if viejo:
        detalle += f"; el último cierre tiene {(hoy - fecha).days} días"
    return [_fila("cotizacion_frente_a_cierre", simbolo, estado, detalle)]


# --- 6. Analizar, congelar y reproducir -----------------------------------------------


def ida_y_vuelta(simbolo: str, analisis: dict, replay: dict) -> list[dict]:
    """Lo congelado se reproduce igual: huella intacta, misma acción y nada
    fechado después de la decisión."""
    filas = []
    huella = (replay.get("integridad") or {}).get("huella_coincide")
    filas.append(_fila("replay:huella", simbolo, PASS if huella else FAIL,
                       "la huella SHA-256 coincide" if huella else "la huella NO coincide"))
    accion = (analisis.get("decision") or {}).get("action")
    reproducida = ((replay.get("secciones") or {}).get("decision") or {}).get("action")
    filas.append(_fila("replay:decision", simbolo, PASS if accion == reproducida else FAIL,
                       f"analizada «{accion}», reproducida «{reproducida}»"))
    proteccion = replay.get("proteccion_anticipacion") or {}
    retiradas = proteccion.get("retiradas_por_fecha_futura") or []
    comprobadas = proteccion.get("marcas_comprobadas") or 0
    incompletas = (f"; secciones incompletas: {', '.join(replay.get('incompletas') or [])}"
                   if replay.get("incompletas") else "")
    if retiradas:
        filas.append(_fila("replay:sin_datos_futuros", simbolo, FAIL,
                           f"{len(retiradas)} {plural(len(retiradas), 'dato fechado', 'datos fechados')} después de la decisión: {retiradas[:5]}"))
    elif not comprobadas:
        # Sin ninguna marca no se ha comprobado nada: eso no es un PASS.
        filas.append(_fila("replay:sin_datos_futuros", simbolo, UNKNOWN,
                           "ninguna marca de tiempo que comprobar" + incompletas))
    else:
        filas.append(_fila("replay:sin_datos_futuros", simbolo, PASS, f"{comprobadas} marcas comprobadas" + incompletas))
    return filas


def sin_anticipacion_en_el_pasado(simbolo: str, analisis_pasado: dict, momento: datetime) -> list[dict]:
    """Un análisis a una fecha pasada no contiene nada publicado después: cada
    marca fechada se compara con ese momento por la regla común."""
    from app.snapshots import anomalias_temporales

    marcas = analisis_pasado.get("marcas") or []
    if not marcas:
        return [_fila("pasado:sin_anticipacion", simbolo, UNKNOWN, "el análisis no trae marcas de tiempo")]
    revision = anomalias_temporales(marcas, momento)
    futuras = [m.get("dato") for m in revision["futuras"]]
    if futuras:
        return [_fila("pasado:sin_anticipacion", simbolo, FAIL,
                      f"a {momento.date()} {plural(len(futuras), 'entra', 'entran')} {len(futuras)} "
                      f"{plural(len(futuras), 'dato publicado', 'datos publicados')} después: {futuras[:5]}")]
    return [_fila("pasado:sin_anticipacion", simbolo, PASS,
                  f"a {momento.date()}: {len(marcas)} marcas, ninguna posterior; "
                  f"{len(revision['sin_fecha_verificable'])} sin fecha verificable")]


def resumen(filas: list[dict]) -> dict:
    cuenta = {PASS: 0, FAIL: 0, UNKNOWN: 0}
    for f in filas:
        cuenta[f["estado"]] = cuenta.get(f["estado"], 0) + 1
    return cuenta
