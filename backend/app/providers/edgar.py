"""Proveedor SEC EDGAR (https://www.sec.gov/search-filings/edgar-application-programming-interfaces).

Gratis, oficial y sin API key — por eso es la fuente PRIORITARIA de estados
financieros: descargar un companyfacts una vez al día (TTL 24 h) alimenta
ratios, DCF, Altman Z y Piotroski F sin gastar créditos de ningún otro API.

La SEC exige identificarse vía User-Agent (EDGAR_USER_AGENT en .env) y pide
mantenerse por debajo de 10 req/s; el rate limiter de la app lo garantiza.
"""

from __future__ import annotations

import time

import httpx

from app.providers.base import (
    DataNotFoundError,
    DataProvider,
    ProviderError,
    iso_utc,
)

TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"

# Etiquetas us-gaap por campo, en orden de preferencia: las empresas no usan
# todas las mismas etiquetas XBRL, así que se prueba cada alternativa.
_FLOW_TAGS: dict[str, list[str]] = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
    ],
    "gross_profit": ["GrossProfit"],
    "operating_income": ["OperatingIncomeLoss"],
    "net_income": ["NetIncomeLoss"],
    "interest_expense": ["InterestExpense", "InterestExpenseDebt"],
    "depreciation_amortization": [
        "DepreciationDepletionAndAmortization",
        "DepreciationAmortizationAndAccretionNet",
        "DepreciationAndAmortization",
    ],
    "cfo": [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    "capex": [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
    ],
    # --- Calidad de beneficios. Cada partida es evidencia, no un total: con
    # «la primera etiqueta con datos gana», una empresa que reporta deterioro
    # de fondo de comercio Y de activos aparece solo con el primero. Por eso
    # el análisis las usa para avisar, nunca para restar del beneficio.
    "sbc": ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
    "pretax_income": [
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    ],
    "income_tax": ["IncomeTaxExpenseBenefit"],
    "restructuring": ["RestructuringCharges", "RestructuringCosts"],
    "impairment": [
        "GoodwillImpairmentLoss",
        "AssetImpairmentCharges",
        "ImpairmentOfLongLivedAssetsHeldForUse",
    ],
    "gain_on_asset_sales": [
        "GainLossOnSaleOfPropertyPlantEquipment",
        "GainLossOnDispositionOfAssets",
        "GainLossOnSaleOfBusiness",
    ],
    "litigation": ["LitigationSettlementExpense", "LossContingencyLossInPeriod"],
    # Variaciones de circulante tal como las da el estado de flujos. Convenio
    # XBRL: un AUMENTO de cuentas por cobrar o de inventario es positivo y
    # RESTA caja; un aumento de proveedores es positivo y SUMA caja.
    "change_receivables": ["IncreaseDecreaseInAccountsReceivable"],
    "change_inventory": ["IncreaseDecreaseInInventories"],
    "change_payables": ["IncreaseDecreaseInAccountsPayable"],
    "capitalized_software": ["PaymentsToDevelopSoftware", "PaymentsForSoftware"],
}

_BALANCE_TAGS: dict[str, list[str]] = {
    "total_assets": ["Assets"],
    "total_liabilities": ["Liabilities"],
    "equity": [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ],
    "current_assets": ["AssetsCurrent"],
    "current_liabilities": ["LiabilitiesCurrent"],
    "cash": [
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
    "retained_earnings": ["RetainedEarningsAccumulatedDeficit"],
    "long_term_debt": ["LongTermDebtNoncurrent", "LongTermDebt"],
    "short_term_debt": ["LongTermDebtCurrent", "DebtCurrent"],
    "accounts_receivable": ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"],
    "inventory": ["InventoryNet"],
    "accounts_payable": ["AccountsPayableCurrent"],
}

_INSIDER_FORMS = {"3", "4", "5"}
_COMPANY_FORMS = {"10-K", "10-Q", "8-K", "20-F", "DEF 14A", "S-1"}

# Mapa ticker→CIK en memoria de proceso (el archivo pesa ~1 MB; no tiene
# sentido bajarlo por símbolo). Se refresca cada 24 h.
_cik_cache: dict = {"fetched_at": 0.0, "map": {}}
_CIK_TTL = 24 * 3600


def _annual_entries(units: list[dict], is_flow: bool) -> dict[str, dict]:
    """Filtra los datos anuales (10-K/20-F, fp=FY) y deduplica por año fiscal."""
    out: dict[str, dict] = {}
    for entry in units:
        form = entry.get("form", "")
        if not ("10-K" in form or "20-F" in form) or entry.get("fp") != "FY":
            continue
        end = entry.get("end")
        if not end:
            continue
        if is_flow:
            start = entry.get("start")
            if not start:
                continue
            # Solo duraciones ~anuales: descarta trimestres acumulados.
            try:
                days = (
                    time.mktime(time.strptime(end, "%Y-%m-%d"))
                    - time.mktime(time.strptime(start, "%Y-%m-%d"))
                ) / 86400
            except ValueError:
                continue
            if not 300 <= days <= 400:
                continue
        # LOOK-AHEAD BIAS. El mismo ejercicio aparece en varios filings cuando
        # la empresa lo reexpresa, y quedarse con el más reciente mete en un
        # backtest de 2021 una cifra corregida en 2023 — información que nadie
        # tenía entonces. Filtrar por fecha de filing NO basta si el valor ya
        # es el reexpresado: hay que quedarse con el que se publicó primero.
        #
        # Se conserva también `filed`, la fecha real de publicación de ESE
        # dato, que es más precisa que el retardo de 90 días que el backtest
        # tenía que suponer.
        year = end[:4]
        previo = out.get(year)
        if previo is None or (entry.get("filed") or "9999") < (previo.get("filed") or "9999"):
            out[year] = entry
    return out


def procedencia(entry: dict, etiqueta: str) -> dict:
    """De dónde sale un número: etiqueta XBRL, formulario, fecha y documento."""
    return {
        "etiqueta": etiqueta,
        "formulario": entry.get("form"),
        "presentado": entry.get("filed"),
        "accn": entry.get("accn"),
        "inicio": entry.get("start"),
        "fin": entry.get("end"),
    }


# Duraciones en días de cada tipo de hecho de flujo. Un 10-Q trae el trimestre
# Y el acumulado del año (6 y 9 meses) con la misma etiqueta: sin filtrar por
# duración se mezclarían.
_DIAS_TRIMESTRE = (75, 105)
_DIAS_SEIS_MESES = (165, 200)
_DIAS_NUEVE_MESES = (250, 290)
_DIAS_ANO = (300, 400)


def _dias(entry: dict) -> float | None:
    try:
        return (
            time.mktime(time.strptime(entry["end"], "%Y-%m-%d"))
            - time.mktime(time.strptime(entry["start"], "%Y-%m-%d"))
        ) / 86400
    except (KeyError, TypeError, ValueError):
        return None


def _originales(units: list[dict], rango: tuple[int, int] | None) -> dict[tuple, dict]:
    """El hecho PUBLICADO PRIMERO para cada periodo exacto (inicio, fin).

    Misma disciplina que `_annual_entries`: una reexpresión posterior no
    sustituye a la cifra que se conoció en su momento.
    """
    salida: dict[tuple, dict] = {}
    for e in units:
        if not e.get("end") or e.get("val") is None:
            continue
        if rango is None:
            if e.get("start"):
                continue
        else:
            d = _dias(e)
            if d is None or not rango[0] <= d <= rango[1]:
                continue
        clave = (e.get("start"), e["end"])
        previo = salida.get(clave)
        if previo is None or (e.get("filed") or "9999") < (previo.get("filed") or "9999"):
            salida[clave] = e
    return salida


def _etiqueta_fiscal(entry: dict, mes_cierre: int | None) -> tuple[str | None, str | None]:
    """(año fiscal, trimestre) de un hecho trimestral.

    `fy`/`fp` de EDGAR describen el FILING, no el hecho: la cifra comparativa
    del año anterior viaja con la etiqueta del año actual. Solo se fían cuando
    el hecho es el original (publicado en los 120 días siguientes a su cierre);
    si no, se deduce del mes de cierre del ejercicio.
    """
    try:
        fin = time.strptime(entry["end"], "%Y-%m-%d")
        publicado = time.strptime(entry.get("filed") or "", "%Y-%m-%d")
        retraso = (time.mktime(publicado) - time.mktime(fin)) / 86400
    except (KeyError, TypeError, ValueError):
        retraso = None
    if retraso is not None and retraso <= 120 and entry.get("fy") and entry.get("fp"):
        return str(entry["fy"]), entry["fp"]
    if mes_cierre is None:
        return None, None
    try:
        fin = time.strptime(entry["end"], "%Y-%m-%d")
    except (KeyError, TypeError, ValueError):
        return None, None
    trimestre = ((fin.tm_mon - mes_cierre - 1) % 12) // 3 + 1
    ano = fin.tm_year if fin.tm_mon <= mes_cierre else fin.tm_year + 1
    return str(ano), f"Q{trimestre}"


def parse_quarters(facts_json: dict, maximo: int = 12) -> list[dict]:
    """Trimestres normalizados, con su fecha de publicación y su linaje.

    El cuarto trimestre casi nunca se presenta suelto: el 10-K da el AÑO. Se
    deriva como año menos nueve meses —y se marca `derivado`— solo para
    partidas de flujo que se suman; el BPA no se deriva así (el número de
    acciones cambia entre trimestres y la resta daría un número falso).
    """
    gaap = (facts_json.get("facts") or {}).get("us-gaap") or {}
    por_fin: dict[str, dict] = {}
    meses_cierre: list[int] = []

    def flujo(campo: str, etiquetas: list[str], unidades: tuple[str, ...], derivar: bool):
        for tag in etiquetas:
            por_unidad = (gaap.get(tag) or {}).get("units") or {}
            units = next((por_unidad[u] for u in unidades if u in por_unidad), None)
            if not units:
                continue
            trimestres = _originales(units, _DIAS_TRIMESTRE)
            seis = _originales(units, _DIAS_SEIS_MESES)
            nueve = _originales(units, _DIAS_NUEVE_MESES)
            anos = _originales(units, _DIAS_ANO)
            if not trimestres and not anos:
                continue
            for (_, fin), e in trimestres.items():
                q = por_fin.setdefault(fin, {"end_date": fin, "_hechos": {}})
                if campo not in q:
                    q[campo] = e["val"]
                    q.setdefault("fuentes", {})[campo] = procedencia(e, tag)
                    q["_hechos"][campo] = e
            for (_, fin), _e in anos.items():
                try:
                    meses_cierre.append(time.strptime(fin, "%Y-%m-%d").tm_mon)
                except ValueError:
                    pass
            if not derivar:
                return
            # Trimestre = acumulado − acumulado anterior del MISMO ejercicio
            # (mismo inicio). Los 10-Q dan el flujo de caja solo acumulado, así
            # que sin esto el CFO del segundo y tercer trimestre no existiría.
            acumulados = [
                (trimestres, seis, "seis meses − primer trimestre"),
                (seis, nueve, "nueve meses − seis meses"),
                (nueve, anos, "año (10-K) − nueve meses"),
            ]
            for previos, largos, metodo in acumulados:
                for (inicio, fin), largo in largos.items():
                    q = por_fin.setdefault(fin, {"end_date": fin, "_hechos": {}})
                    if campo in q:
                        continue
                    corto = next((e for (i, _), e in previos.items() if i == inicio), None)
                    if corto is None:
                        continue
                    q[campo] = largo["val"] - corto["val"]
                    q.setdefault("fuentes", {})[campo] = {
                        **procedencia(largo, tag),
                        "derivado": metodo,
                        "restado": procedencia(corto, tag),
                    }
                    q["_hechos"][campo] = {**largo, "_derivado": True,
                                           "fp": "Q4" if largos is anos else largo.get("fp")}
            return

    for campo, etiquetas in _FLOW_TAGS.items():
        flujo(campo, etiquetas, ("USD",), derivar=True)
    flujo("eps_diluted", ["EarningsPerShareDiluted"], ("USD/shares",), derivar=False)

    for campo, etiquetas in _BALANCE_TAGS.items():
        for tag in etiquetas:
            units = ((gaap.get(tag) or {}).get("units") or {}).get("USD")
            if not units:
                continue
            instantes = _originales(units, None)
            if not instantes:
                continue
            for (_, fin), e in instantes.items():
                if fin in por_fin and campo not in por_fin[fin]:
                    por_fin[fin][campo] = e["val"]
                    por_fin[fin].setdefault("fuentes", {})[campo] = procedencia(e, tag)
            break

    mes_cierre = max(set(meses_cierre), key=meses_cierre.count) if meses_cierre else None
    salida = []
    for fin in sorted(por_fin):
        q = por_fin[fin]
        hechos = q.pop("_hechos")
        if q.get("revenue") is None and q.get("net_income") is None:
            continue
        # La fecha de publicación del trimestre es la MÁS TARDÍA de sus
        # partidas: el trimestre completo no se conoció antes que su último dato.
        publicadas = [f.get("presentado") for f in (q.get("fuentes") or {}).values() if f.get("presentado")]
        q["filed_at"] = max(publicadas) if publicadas else None
        referencia = hechos.get("revenue") or hechos.get("net_income") or {}
        if referencia.get("_derivado") and referencia.get("fp") == "Q4":
            ano, _ = _etiqueta_fiscal({**referencia, "fp": None}, mes_cierre)
            q["fiscal_year"], q["fiscal_period"] = ano, "Q4"
        else:
            q["fiscal_year"], q["fiscal_period"] = _etiqueta_fiscal(referencia, mes_cierre)
        q["periodo"] = (
            f"{q['fiscal_year']}-{q['fiscal_period']}"
            if q.get("fiscal_year") and q.get("fiscal_period")
            else None
        )
        salida.append(q)
    return salida[-maximo:]


def parse_companyfacts(facts_json: dict) -> list[dict]:
    """Convierte el companyfacts de EDGAR en periodos anuales normalizados.

    Función pura (testeable con fixtures sin red). Devuelve una lista
    cronológica de dicts con end_date y los campos disponibles; un campo que
    la empresa no reporta queda como None, nunca se inventa.
    """
    gaap = (facts_json.get("facts") or {}).get("us-gaap") or {}
    dei = (facts_json.get("facts") or {}).get("dei") or {}

    per_year: dict[str, dict] = {}

    def collect(field: str, tags: list[str], unit_names: tuple[str, ...], is_flow: bool):
        for tag in tags:
            units_by_name = (gaap.get(tag) or {}).get("units") or {}
            units = next(
                (units_by_name[u] for u in unit_names if u in units_by_name), None
            )
            if not units:
                continue
            annual = _annual_entries(units, is_flow)
            if not annual:
                continue
            for year, entry in annual.items():
                period = per_year.setdefault(year, {"end_date": entry["end"]})
                if field not in period:
                    period[field] = entry.get("val")
                    # Linaje por partida: de qué etiqueta, de qué documento y de
                    # qué fecha sale ESTE número. Sin esto, «CFO / beneficio =
                    # 1,20×» no se podía reconstruir hasta el filing.
                    period.setdefault("fuentes", {})[field] = procedencia(entry, tag)
                    if entry["end"] > period["end_date"]:
                        period["end_date"] = entry["end"]
                # La fecha de publicación más tardía entre los campos del
                # ejercicio: el periodo completo no se conoció antes que su
                # último dato. Quedarse con la más temprana adelantaría la
                # disponibilidad, que es el sesgo que esto viene a evitar.
                filed = entry.get("filed")
                if filed and filed > period.get("filed_at", ""):
                    period["filed_at"] = filed
            return  # primera etiqueta con datos anuales gana

    for field, tags in _FLOW_TAGS.items():
        collect(field, tags, ("USD",), is_flow=True)
    for field, tags in _BALANCE_TAGS.items():
        collect(field, tags, ("USD",), is_flow=False)
    collect("eps_diluted", ["EarningsPerShareDiluted"], ("USD/shares",), is_flow=True)

    # Acciones en circulación (dei, dato instantáneo por año).
    shares_units = (
        (dei.get("EntityCommonStockSharesOutstanding") or {}).get("units") or {}
    ).get("shares") or []
    for entry in shares_units:
        year = (entry.get("end") or "")[:4]
        if year in per_year and "shares_outstanding" not in per_year[year]:
            per_year[year]["shares_outstanding"] = entry.get("val")
            per_year[year].setdefault("fuentes", {})["shares_outstanding"] = procedencia(
                entry, "dei:EntityCommonStockSharesOutstanding"
            )

    periods = [
        {"fiscal_year": year, **fields}
        for year, fields in sorted(per_year.items())
        if fields.get("revenue") is not None or fields.get("total_assets") is not None
    ]
    return periods[-8:]  # últimos 8 ejercicios: suficiente para CAGR 5A y F-score


class EdgarProvider(DataProvider):
    name = "edgar"
    capabilities = frozenset({"financials", "filings", "filing_document"})

    def __init__(self, user_agent: str, timeout: float = 30.0):
        self.user_agent = user_agent
        self.timeout = timeout

    def get_filing_document(self, url: str) -> dict:
        """El TEXTO de un filing concreto, no su metadato.

        `get_filings` devuelve la lista con sus URLs; esto trae el documento en
        sí, que es lo que hace falta para leer el MD&A o los factores de riesgo.
        Se restringe a sec.gov a propósito: la URL viaja desde la respuesta de
        otro endpoint y un fetch sin restringir sería una puerta abierta a que
        un dato de terceros dirija peticiones desde el servidor.
        """
        if not url.startswith("https://www.sec.gov/Archives/"):
            raise DataNotFoundError(
                "edgar: solo se descargan documentos de https://www.sec.gov/Archives/"
            )
        try:
            resp = httpx.get(
                url,
                headers={"User-Agent": self.user_agent},
                timeout=self.timeout,
                follow_redirects=False,
            )
        except httpx.HTTPError as exc:
            raise ProviderError(f"edgar: error de red: {exc}") from exc
        if resp.status_code == 404:
            raise DataNotFoundError(f"edgar: documento no encontrado: {url}")
        if resp.status_code != 200:
            raise ProviderError(f"edgar: HTTP {resp.status_code} al leer el documento")
        return {"url": url, "html": resp.text, "as_of": iso_utc()}

    def _get(self, url: str) -> dict:
        try:
            resp = httpx.get(
                url, headers={"User-Agent": self.user_agent}, timeout=self.timeout
            )
        except httpx.HTTPError as exc:
            raise ProviderError(f"edgar: error de red: {exc}") from exc
        if resp.status_code == 404:
            raise DataNotFoundError("edgar: recurso no encontrado")
        if resp.status_code == 403:
            raise ProviderError(
                "edgar: acceso rechazado — revisa que EDGAR_USER_AGENT tenga "
                "tu nombre y email reales (requisito de la SEC)"
            )
        if resp.status_code != 200:
            raise ProviderError(f"edgar: HTTP {resp.status_code}")
        return resp.json()

    def _cik_for(self, symbol: str) -> int:
        now = time.time()
        if not _cik_cache["map"] or now - _cik_cache["fetched_at"] > _CIK_TTL:
            data = self._get(TICKER_MAP_URL)
            _cik_cache["map"] = {
                row["ticker"].upper(): int(row["cik_str"]) for row in data.values()
            }
            _cik_cache["fetched_at"] = now
        cik = _cik_cache["map"].get(symbol.upper())
        if cik is None:
            raise DataNotFoundError(
                f"edgar: {symbol} no está registrado en la SEC (¿empresa no-EE. UU. o ETF?)"
            )
        return cik

    def get_financials(self, symbol: str) -> dict:
        cik = self._cik_for(symbol)
        facts = self._get(FACTS_URL.format(cik=cik))
        periods = parse_companyfacts(facts)
        if not periods:
            raise DataNotFoundError(f"edgar: sin estados financieros anuales para {symbol}")
        return {
            "symbol": symbol.upper(),
            "cik": cik,
            "entity": facts.get("entityName"),
            "periods": periods,
            # Trimestres con fecha de publicación y linaje: los resultados de
            # cada trimestre frente a lo que se esperaba de él.
            "quarters": parse_quarters(facts),
            "as_of": iso_utc(),
        }

    def get_filings(self, symbol: str) -> dict:
        cik = self._cik_for(symbol)
        data = self._get(SUBMISSIONS_URL.format(cik=cik))
        recent = (data.get("filings") or {}).get("recent") or {}
        forms = recent.get("form") or []
        dates = recent.get("filingDate") or []
        accessions = recent.get("accessionNumber") or []
        docs = recent.get("primaryDocument") or []

        filings, insider = [], []
        for form, date, accn, doc in zip(forms, dates, accessions, docs):
            entry = {
                "type": form,
                "filed_at": date,
                "accession_no": accn,
                "url": (
                    f"https://www.sec.gov/Archives/edgar/data/{cik}/"
                    f"{accn.replace('-', '')}/{doc}"
                ),
            }
            if form in _INSIDER_FORMS and len(insider) < 40:
                insider.append(entry)
            elif form in _COMPANY_FORMS and len(filings) < 40:
                filings.append(entry)
        return {
            "symbol": symbol.upper(),
            "cik": cik,
            "filings": filings,
            "insider_filings": insider,
            "as_of": iso_utc(),
        }
