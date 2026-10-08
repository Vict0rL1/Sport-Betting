"""Calidad de los beneficios: evidencias verificables, no una nota.

«Quality score: 72/100» no dice qué mirar ni por qué. Aquí cada categoría es
una REGLA escrita —qué se mide, contra qué umbral, con qué cifras de qué
documento— y produce BUENO, NORMAL, AVISO o DESCONOCIDO. La lectura global se
deriva de esas evidencias con una regla también escrita; la puntuación, si se
quiere, es secundaria y se puede rehacer a mano.

Lo que mide cada categoría y por qué importa:

- **Conversión a caja.** Un beneficio que no llega a caja puede ser contable.
- **Accruals.** Beneficio menos caja, sobre activos (Sloan): la parte del
  beneficio que es estimación.
- **Cuentas por cobrar.** Si crecen persistentemente más que las ventas, se
  vende a crédito más laxo o se adelantan ingresos.
- **Inventario.** Si crece más que las ventas, demanda más floja de lo que dice
  la cuenta de resultados, o riesgo de deterioro.
- **SBC.** La retribución en acciones es un coste real que el flujo de caja
  no ve: diluye.
- **Capital circulante.** Si buena parte del flujo operativo viene de estirar
  proveedores o cobrar antes, no se repite.
- **Costes capitalizados.** Capitalizar desarrollo sube el beneficio hoy.
- **Extraordinarios.** Reestructuraciones, ventas de activos, litigios,
  deterioros y beneficios fiscales: separados del beneficio recurrente.
- **Calidad del FCF.** El beneficio crece y la caja no.

Límite dicho en alto: las partidas no recurrentes salen de etiquetas XBRL
concretas y «la primera etiqueta con datos gana». Lo que se encuentra es real;
lo que no aparece puede existir con otra etiqueta.
"""

from __future__ import annotations

import hashlib
import json

from app import datos
from app.analysis.fundamentals import free_cash_flow, partida
from app.formato import fmt_num, fmt_pct

BUENO, NORMAL, AVISO, DESCONOCIDO = "bueno", "normal", "aviso", "desconocido"

# --- Umbrales: todos aquí, con nombre ---------------------------------------
CFO_NI_BUENO = 1.0            # el flujo operativo cubre el beneficio
CFO_NI_AVISO = 0.8            # por debajo, una parte del beneficio no es caja
FCF_NI_DEBIL = 0.6            # mismo umbral que la lectura de caja del informe
FCF_NI_FUERTE = 1.1
ACCRUALS_NORMAL = 0.05        # (beneficio − CFO) / activos medios
ACCRUALS_AVISO = 0.10
BRECHA_CIRCULANTE_NORMAL = 0.05   # crecimiento de cobros/inventario − crecimiento de ventas
BRECHA_CIRCULANTE_AVISO = 0.10
SBC_NORMAL = 0.05             # SBC / ingresos
SBC_AVISO = 0.10
CIRCULANTE_EN_CFO_NORMAL = 0.10   # parte del CFO que viene del circulante
CIRCULANTE_EN_CFO_AVISO = 0.25
CAPITALIZADO_AVISO = 0.05     # software capitalizado / ingresos
EXTRAORDINARIOS_AVISO = 0.10  # |partidas no recurrentes| / |beneficio neto|
TIPO_FISCAL_BAJO = 0.10       # tipo efectivo por debajo, con beneficio antes de impuestos positivo
DIVERGENCIA_FCF = 0.05        # beneficio +5 % y FCF −5 % en el mismo tramo

REGLA_GLOBAL = (
    "≥2 avisos → PRECAUCIÓN; 1 aviso → VIGILAR; ningún aviso y al menos la mitad "
    "de las categorías evaluables → SÓLIDA; más de la mitad desconocidas → DESCONOCIDA."
)


def _div(a, b):
    a, b = datos.numero(a), datos.numero(b)
    return a / b if a is not None and b not in (None, 0) else None


def _crec(nuevo, viejo):
    n, v = datos.numero(nuevo), datos.numero(viejo)
    return n / v - 1 if n is not None and v is not None and v > 0 else None


def _evidencia(categoria, estado, regla, umbral, valor, periodo, entradas, **extra):
    return {"categoria": categoria, "estado": estado, "regla": regla, "umbral": umbral,
            "valor": None if valor is None else round(valor, 6), "periodo": periodo,
            "entradas": entradas, "fuente": "edgar", **extra}


def _desconocido(categoria, regla, motivo, periodo=None, entradas=None):
    return _evidencia(categoria, DESCONOCIDO, regla, None, None, periodo, entradas or {}, motivo=motivo)


def analizar(periodos: list[dict], trimestres: list[dict] | None = None, obtenido_en: str | None = None) -> dict:
    """Las evidencias de la calidad del beneficio del último ejercicio, con su historia."""
    if not periodos:
        return {"estado": DESCONOCIDO, "global": DESCONOCIDO, "evidencias": [],
                "motivo": "sin estados financieros", "huella": None}
    ult = periodos[-1]
    ant = periodos[-2] if len(periodos) >= 2 else None
    fy = ult.get("fiscal_year")

    def p(per, campo):
        return partida(per, campo, obtenido_en) if per else {"valor": None}

    ev = [
        _conversion(ult, periodos, p, fy),
        _accruals(ult, ant, p, fy),
        _brecha(ult, ant, periodos, p, fy, "accounts_receivable", "cuentas_por_cobrar", "cuentas por cobrar"),
        _brecha(ult, ant, periodos, p, fy, "inventory", "inventario", "inventario"),
        _sbc(ult, periodos, p, fy),
        _circulante(ult, p, fy),
        _capitalizado(ult, p, fy),
        _extraordinarios(ult, p, fy),
        _calidad_fcf(periodos, p, fy),
    ]
    avisos = [e for e in ev if e["estado"] == AVISO]
    evaluables = [e for e in ev if e["estado"] != DESCONOCIDO]
    if len(evaluables) < len(ev) / 2:
        glob = DESCONOCIDO
    elif len(avisos) >= 2:
        glob = "precaucion"
    elif avisos:
        glob = "vigilar"
    else:
        glob = "solida"
    puntos = sum({BUENO: 1, NORMAL: 0, AVISO: -1}[e["estado"]] for e in evaluables)
    salida = {
        "estado": "valido",
        "ejercicio": fy,
        "global": glob,
        "regla_global": REGLA_GLOBAL,
        "evidencias": ev,
        "por_categoria": {e["categoria"]: e["estado"] for e in ev},
        "avisos": [e["categoria"] for e in avisos],
        # Secundaria y reconstruible a mano: +1 por bueno, −1 por aviso.
        "puntuacion": {"valor": puntos, "evaluables": len(evaluables),
                       "regla": "bueno +1, normal 0, aviso −1; las desconocidas no puntúan"},
        "historia": historia(periodos),
        "trimestral": historia_trimestral(trimestres or []),
        "generado_por": "app",
        "limite": ("Las partidas no recurrentes salen de etiquetas XBRL concretas: lo que se encuentra "
                   "es real; lo que no aparece puede existir con otra etiqueta."),
    }
    salida["huella"] = hashlib.sha256(json.dumps(
        [fy, glob, salida["por_categoria"]], sort_keys=True).encode()).hexdigest()[:12]
    return salida


# --- Las reglas, una a una -------------------------------------------------------


def _conversion(ult, periodos, p, fy):
    regla = (f"CFO / beneficio neto ≥ {fmt_num(CFO_NI_BUENO, 2, ceros=False)} bueno; "
             f"< {fmt_num(CFO_NI_AVISO, 2, ceros=False)} aviso (y FCF / beneficio < {fmt_num(FCF_NI_DEBIL, 2, ceros=False)} aviso)")
    cfo, ni = p(ult, "cfo"), p(ult, "net_income")
    if ni["valor"] is None or cfo["valor"] is None:
        return _desconocido("conversion_caja", regla, "falta el flujo operativo o el beneficio", fy,
                            {"cfo": cfo, "beneficio_neto": ni})
    if ni["valor"] <= 0:
        return _desconocido("conversion_caja", regla,
                            "beneficio no positivo: el cociente no significa nada", fy, {"cfo": cfo, "beneficio_neto": ni})
    r = cfo["valor"] / ni["valor"]
    fcf = free_cash_flow(ult)
    fcf_ni = fcf / ni["valor"] if fcf is not None else None
    debiles = [x.get("fiscal_year") for x in periodos[-3:]
               if (c := _div(x.get("cfo"), x.get("net_income"))) is not None
               and datos.numero(x.get("net_income")) and x["net_income"] > 0 and c < CFO_NI_AVISO]
    estado = AVISO if r < CFO_NI_AVISO or (fcf_ni is not None and fcf_ni < FCF_NI_DEBIL) else (
        BUENO if r >= CFO_NI_BUENO else NORMAL)
    return _evidencia("conversion_caja", estado, regla, {"bueno": CFO_NI_BUENO, "aviso": CFO_NI_AVISO,
                                                         "fcf_debil": FCF_NI_DEBIL},
                      r, fy, {"cfo": cfo, "beneficio_neto": ni, "capex": p(ult, "capex")},
                      fcf_sobre_beneficio=None if fcf_ni is None else round(fcf_ni, 6),
                      persistente=len(debiles) >= 2, ejercicios_debiles=debiles,
                      metodo="flujo operativo / beneficio neto del ejercicio")


def _accruals(ult, ant, p, fy):
    regla = (f"(beneficio − CFO) / activos medios < {fmt_num(ACCRUALS_NORMAL, 2, ceros=False)} bueno; "
             f"> {fmt_num(ACCRUALS_AVISO, 2, ceros=False)} aviso")
    ni, cfo, act = p(ult, "net_income"), p(ult, "cfo"), p(ult, "total_assets")
    act_ant = p(ant, "total_assets")
    if None in (ni["valor"], cfo["valor"], act["valor"]):
        return _desconocido("accruals", regla, "falta beneficio, CFO o activos", fy,
                            {"beneficio_neto": ni, "cfo": cfo, "activos": act})
    medios = (act["valor"] + act_ant["valor"]) / 2 if act_ant.get("valor") else act["valor"]
    r = (ni["valor"] - cfo["valor"]) / medios if medios else None
    if r is None:
        return _desconocido("accruals", regla, "activos nulos", fy)
    estado = AVISO if r > ACCRUALS_AVISO else NORMAL if r > ACCRUALS_NORMAL else BUENO
    return _evidencia("accruals", estado, regla, {"normal": ACCRUALS_NORMAL, "aviso": ACCRUALS_AVISO}, r, fy,
                      {"beneficio_neto": ni, "cfo": cfo, "activos": act, "activos_anterior": act_ant},
                      metodo="ratio de accruals de Sloan sobre activos medios"
                      + ("" if act_ant.get("valor") else " (sin activos del año anterior: activos del ejercicio)"))


def _brecha(ult, ant, periodos, p, fy, campo, categoria, nombre):
    regla = (f"crecimiento de {nombre} − crecimiento de ingresos > {fmt_pct(BRECHA_CIRCULANTE_AVISO, 0)} aviso "
             f"(> {fmt_pct(BRECHA_CIRCULANTE_NORMAL, 0)} normal)")
    if ant is None:
        return _desconocido(categoria, regla, "hace falta el ejercicio anterior", fy)
    x, x_ant = p(ult, campo), p(ant, campo)
    rev, rev_ant = p(ult, "revenue"), p(ant, "revenue")
    if x["valor"] is None or x_ant["valor"] is None:
        return _desconocido(categoria, regla,
                            f"la empresa no reporta {nombre} con las etiquetas conocidas (puede no tenerlo)", fy,
                            {nombre: x})
    g_x, g_r = _crec(x["valor"], x_ant["valor"]), _crec(rev["valor"], rev_ant["valor"])
    if g_x is None or g_r is None:
        return _desconocido(categoria, regla, "crecimiento no calculable (base cero o negativa)", fy)
    brecha = g_x - g_r
    # Persistencia: la misma brecha en el ejercicio anterior también.
    previas = []
    for a, b in zip(periodos[-3:-1], periodos[-2:]):
        gx, gr = _crec(b.get(campo), a.get(campo)), _crec(b.get("revenue"), a.get("revenue"))
        if gx is not None and gr is not None:
            previas.append(gx - gr)
    persistente = len(previas) >= 2 and all(v > BRECHA_CIRCULANTE_AVISO for v in previas)
    estado = AVISO if brecha > BRECHA_CIRCULANTE_AVISO else NORMAL if brecha > BRECHA_CIRCULANTE_NORMAL else BUENO
    dias = _div(x["valor"], rev["valor"])
    return _evidencia(categoria, estado, regla, {"normal": BRECHA_CIRCULANTE_NORMAL, "aviso": BRECHA_CIRCULANTE_AVISO},
                      brecha, fy, {nombre: x, f"{nombre}_anterior": x_ant, "ingresos": rev, "ingresos_anterior": rev_ant},
                      crecimiento=round(g_x, 6), crecimiento_ingresos=round(g_r, 6), persistente=persistente,
                      dias_sobre_ventas=None if dias is None else round(dias * 365, 1),
                      metodo=f"crecimiento interanual de {nombre} menos el de ingresos")


def _sbc(ult, periodos, p, fy):
    regla = f"SBC / ingresos < {fmt_pct(SBC_NORMAL, 0)} bueno; > {fmt_pct(SBC_AVISO, 0)} aviso; creciente 3 años seguidos aviso"
    sbc, rev, ni = p(ult, "sbc"), p(ult, "revenue"), p(ult, "net_income")
    if sbc["valor"] is None or not rev["valor"]:
        return _desconocido("sbc", regla, "sin compensación en acciones reportada o sin ingresos", fy, {"sbc": sbc})
    r = sbc["valor"] / rev["valor"]
    serie = [_div(x.get("sbc"), x.get("revenue")) for x in periodos[-4:]]
    serie = [v for v in serie if v is not None]
    creciente = len(serie) >= 3 and all(b > a for a, b in zip(serie[-3:], serie[-2:]))
    estado = AVISO if r > SBC_AVISO or creciente else NORMAL if r > SBC_NORMAL else BUENO
    return _evidencia("sbc", estado, regla, {"normal": SBC_NORMAL, "aviso": SBC_AVISO}, r, fy,
                      {"sbc": sbc, "ingresos": rev, "beneficio_neto": ni},
                      sobre_beneficio=_div(sbc["valor"], ni["valor"]) if ni["valor"] and ni["valor"] > 0 else None,
                      tendencia=[round(v, 6) for v in serie], creciente=creciente,
                      metodo="compensación en acciones / ingresos del ejercicio")


def _circulante(ult, p, fy):
    regla = (f"parte del CFO que viene del circulante > {fmt_pct(CIRCULANTE_EN_CFO_AVISO, 0)} aviso "
             f"(> {fmt_pct(CIRCULANTE_EN_CFO_NORMAL, 0)} normal)")
    cfo = p(ult, "cfo")
    cambios = {c: p(ult, c) for c in ("change_receivables", "change_inventory", "change_payables")}
    if cfo["valor"] is None or all(v["valor"] is None for v in cambios.values()) or cfo["valor"] <= 0:
        return _desconocido("capital_circulante", regla,
                            "sin variaciones de circulante en el estado de flujos, o CFO no positivo", fy,
                            {"cfo": cfo, **cambios})
    # Convenio XBRL: un aumento de cobros o inventario es positivo y RESTA caja;
    # un aumento de proveedores SUMA. Lo ausente no aporta (y se dice).
    aporte = (-(cambios["change_receivables"]["valor"] or 0.0) - (cambios["change_inventory"]["valor"] or 0.0)
              + (cambios["change_payables"]["valor"] or 0.0))
    r = aporte / cfo["valor"]
    estado = AVISO if r > CIRCULANTE_EN_CFO_AVISO else NORMAL if r > CIRCULANTE_EN_CFO_NORMAL else BUENO
    faltan = [c for c, v in cambios.items() if v["valor"] is None]
    return _evidencia("capital_circulante", estado, regla,
                      {"normal": CIRCULANTE_EN_CFO_NORMAL, "aviso": CIRCULANTE_EN_CFO_AVISO}, r, fy,
                      {"cfo": cfo, **cambios}, aporte_circulante=round(aporte, 2), partidas_ausentes=faltan,
                      metodo="(−Δcobros − Δinventario + Δproveedores) / CFO")


def _capitalizado(ult, p, fy):
    regla = f"software capitalizado / ingresos > {fmt_pct(CAPITALIZADO_AVISO, 0)} aviso"
    cap, rev = p(ult, "capitalized_software"), p(ult, "revenue")
    if cap["valor"] is None or not rev["valor"]:
        return _desconocido("costes_capitalizados", regla,
                            "no se identifican costes capitalizados con las etiquetas conocidas", fy, {"capitalizado": cap})
    r = cap["valor"] / rev["valor"]
    return _evidencia("costes_capitalizados", AVISO if r > CAPITALIZADO_AVISO else BUENO, regla,
                      {"aviso": CAPITALIZADO_AVISO}, r, fy, {"capitalizado": cap, "ingresos": rev},
                      metodo="pagos por desarrollo de software capitalizado / ingresos")


def _extraordinarios(ult, p, fy):
    regla = (f"|partidas no recurrentes| / |beneficio neto| > {fmt_pct(EXTRAORDINARIOS_AVISO, 0)} aviso; "
             f"tipo fiscal efectivo < {fmt_pct(TIPO_FISCAL_BAJO, 0)} con beneficio antes de impuestos positivo aviso")
    ni = p(ult, "net_income")
    partidas = {
        "reestructuracion": p(ult, "restructuring"),
        "deterioros": p(ult, "impairment"),
        "venta_de_activos": p(ult, "gain_on_asset_sales"),
        "litigios": p(ult, "litigation"),
    }
    pre, imp = p(ult, "pretax_income"), p(ult, "income_tax")
    tipo = _div(imp["valor"], pre["valor"]) if pre["valor"] and pre["valor"] > 0 else None
    encontradas = {k: v for k, v in partidas.items() if v["valor"] is not None}
    if not encontradas and tipo is None:
        return _desconocido("extraordinarios", regla, "no se identifican partidas no recurrentes ni el tipo fiscal", fy,
                            {"beneficio_neto": ni})
    # Gastos que restan beneficio (reestructuración, deterioros, litigios) y
    # una ganancia que lo suma (venta de activos): ambos lo alejan del recurrente.
    magnitud = sum(abs(v["valor"]) for v in encontradas.values())
    r = magnitud / abs(ni["valor"]) if ni["valor"] else None
    fiscal_bajo = tipo is not None and tipo < TIPO_FISCAL_BAJO
    estado = AVISO if (r is not None and r > EXTRAORDINARIOS_AVISO) or fiscal_bajo else BUENO
    return _evidencia("extraordinarios", estado, regla, {"aviso": EXTRAORDINARIOS_AVISO, "tipo_fiscal_bajo": TIPO_FISCAL_BAJO},
                      r, fy, {"beneficio_neto": ni, **partidas, "beneficio_antes_impuestos": pre, "impuesto": imp},
                      tipo_fiscal_efectivo=None if tipo is None else round(tipo, 4), beneficio_fiscal=fiscal_bajo,
                      separadas={k: v["valor"] for k, v in encontradas.items()},
                      metodo="suma de magnitudes de las partidas no recurrentes encontradas / beneficio neto")


def _calidad_fcf(periodos, p, fy):
    regla = f"beneficio +{fmt_pct(DIVERGENCIA_FCF, 0)} y FCF −{fmt_pct(DIVERGENCIA_FCF, 0)} en los dos últimos ejercicios aviso"
    if len(periodos) < 3:
        return _desconocido("calidad_fcf", regla, "hacen falta tres ejercicios", fy)
    a, b = periodos[-3], periodos[-1]
    g_ni = _crec(b.get("net_income"), a.get("net_income"))
    g_fcf = _crec(free_cash_flow(b), free_cash_flow(a))
    if g_ni is None or g_fcf is None:
        return _desconocido("calidad_fcf", regla, "beneficio o FCF no positivos o ausentes en la base", fy)
    diverge = g_ni > DIVERGENCIA_FCF and g_fcf < -DIVERGENCIA_FCF
    estado = AVISO if diverge else BUENO if g_fcf >= g_ni - DIVERGENCIA_FCF else NORMAL
    return _evidencia("calidad_fcf", estado, regla, {"divergencia": DIVERGENCIA_FCF}, g_fcf - g_ni, fy,
                      {"beneficio_inicio": p(a, "net_income"), "beneficio_fin": p(b, "net_income"),
                       "cfo_inicio": p(a, "cfo"), "capex_inicio": p(a, "capex"),
                       "cfo_fin": p(b, "cfo"), "capex_fin": p(b, "capex")},
                      crecimiento_beneficio=round(g_ni, 6), crecimiento_fcf=round(g_fcf, 6),
                      metodo=f"crecimiento del FCF frente al del beneficio, {a.get('fiscal_year')}→{b.get('fiscal_year')}")


# --- Historia -------------------------------------------------------------------------


def _fila(x: dict, previo: dict | None) -> dict:
    fcf = free_cash_flow(x)
    ni = datos.numero(x.get("net_income"))
    fila = {
        "cfo_sobre_beneficio": _div(x.get("cfo"), ni) if ni and ni > 0 else None,
        "fcf_sobre_beneficio": fcf / ni if fcf is not None and ni and ni > 0 else None,
        "sbc_sobre_ingresos": _div(x.get("sbc"), x.get("revenue")),
        "dias_de_cobro": (_div(x.get("accounts_receivable"), x.get("revenue")) or 0) * 365
        if _div(x.get("accounts_receivable"), x.get("revenue")) is not None else None,
    }
    if previo:
        g_ar, g_rev = _crec(x.get("accounts_receivable"), previo.get("accounts_receivable")), _crec(x.get("revenue"), previo.get("revenue"))
        g_inv = _crec(x.get("inventory"), previo.get("inventory"))
        fila["brecha_cobros"] = g_ar - g_rev if g_ar is not None and g_rev is not None else None
        fila["brecha_inventario"] = g_inv - g_rev if g_inv is not None and g_rev is not None else None
    return {k: (None if v is None else round(v, 6)) for k, v in fila.items()}


def historia(periodos: list[dict], anos: int = 5) -> list[dict]:
    """Las mismas medidas, ejercicio a ejercicio, hasta cinco años."""
    tramo = periodos[-anos:]
    salida = []
    for i, x in enumerate(tramo):
        idx = len(periodos) - len(tramo) + i
        previo = periodos[idx - 1] if idx > 0 else None
        salida.append({"periodo": x.get("fiscal_year"), "publicado": x.get("filed_at"), **_fila(x, previo)})
    return salida


def historia_trimestral(trimestres: list[dict], n: int = 8) -> list[dict]:
    """Ocho trimestres, si los hay. Las brechas trimestrales no se calculan: la
    estacionalidad las haría ruido."""
    return [
        {"periodo": q.get("periodo"), "publicado": q.get("filed_at"),
         **{k: v for k, v in _fila(q, None).items() if not k.startswith("brecha")}}
        for q in trimestres[-n:]
    ]
