"""Repaso de seguridad (ítem 0.9 del plan), convertido en guardas.

- Un ticker se valida en la frontera de TODA la API con el mismo patrón
  (`app/simbolos.py`). Se recorre el esquema OpenAPI entero —no una lista
  escrita a mano, que es como se quedaron seis rutas sin validar— y se exige el
  patrón en cada parámetro o campo con «symbol» en el nombre. Y se prueba el
  comportamiento: un símbolo malicioso es un 422 en español y NUNCA una llamada
  a un proveedor.
- El backend solo escucha en 127.0.0.1; CORS solo admite el Vite local.
- `.env` no se versiona y `.env.example` no lleva claves; ningún fichero
  versionado contiene algo con forma de clave.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.simbolos import PATRON_LISTA_SIMBOLOS, PATRON_SIMBOLO

RAIZ = Path(__file__).resolve().parents[2]
MALOS = ["AAPL;DROP", "A" * 13, "AA PL", "AAPL$", "..", "<b>"]


@pytest.fixture(scope="module")
def esquema():
    from app.main import app

    return app.openapi()


def _con_simbolo(esquema):
    """(método, ruta, dónde, nombre, esquema del campo) de cada símbolo de la API."""
    componentes = esquema.get("components", {}).get("schemas", {})

    def resolver(s):
        while "$ref" in s:
            s = componentes[s["$ref"].split("/")[-1]]
        return s

    for ruta, ops in esquema["paths"].items():
        for metodo, op in ops.items():
            for p in op.get("parameters", []):
                if "symbol" in p["name"]:
                    yield metodo, ruta, p["in"], p["name"], p.get("schema", {})
            cuerpo = (((op.get("requestBody") or {}).get("content") or {}).get("application/json") or {})
            if "schema" in cuerpo:
                for nombre, campo in (resolver(cuerpo["schema"]).get("properties") or {}).items():
                    if "symbol" in nombre:
                        yield metodo, ruta, "body", nombre, campo


def _patrones(campo: dict) -> set[str]:
    """Los patrones que impone un campo, mirando dentro de anyOf (opcionales) y de listas."""
    salida = set()
    for alternativa in campo.get("anyOf", [campo]):
        if alternativa.get("type") == "null":
            continue
        objetivo = alternativa.get("items", alternativa) if alternativa.get("type") == "array" else alternativa
        salida.add(objetivo.get("pattern"))
    return salida


def test_todo_simbolo_de_la_api_lleva_el_patron_comun(esquema):
    campos = list(_con_simbolo(esquema))
    assert len(campos) >= 40, "el recorrido no encontró las rutas: ¿cambió la forma del esquema?"
    sin_patron = [f"{m.upper()} {r} ({d}: {n})" for m, r, d, n, c in campos
                  if not _patrones(c) <= {PATRON_SIMBOLO, PATRON_LISTA_SIMBOLOS} or None in _patrones(c)]
    assert not sin_patron, "Símbolos sin validar en la frontera:\n  " + "\n  ".join(sin_patron)


class _ServicioEspia:
    """Cuenta cualquier intento de pedir datos: con un símbolo malo no puede haber ninguno."""

    def __init__(self):
        self.llamadas = []

        class _Cache:
            def get(self, *a, **k):
                return None

            def set(self, *a, **k):
                pass

        self.cache = _Cache()

    def get(self, tipo, **kw):
        from app.providers.base import DataNotFoundError

        self.llamadas.append((tipo, kw))
        raise DataNotFoundError("espía")


@pytest.fixture
def cliente(session_factory):
    from app.db.engine import get_session
    from app.deps import get_llm, get_service
    from app.main import app

    espia = _ServicioEspia()

    def sesion():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides.update({get_service: lambda: espia, get_session: sesion, get_llm: lambda: None})
    try:
        yield TestClient(app, raise_server_exceptions=False), espia
    finally:
        app.dependency_overrides.clear()


def test_un_simbolo_malicioso_es_un_422_en_espanol_y_nunca_una_llamada(esquema, cliente):
    c, espia = cliente
    probadas = 0
    for metodo, ruta, donde, nombre, _ in _con_simbolo(esquema):
        if donde == "body":
            continue
        # «..» en una RUTA lo normaliza el propio cliente HTTP («/a/../b» → «/b»): la
        # petición que llega es otra, legítima. Se prueba en queries y cuerpos.
        for malo in [m for m in MALOS if not (donde == "path" and m == "..")]:
            espia.llamadas.clear()
            url = re.sub(r"\{symbol\}", malo, ruta)
            url = re.sub(r"\{[a-z_]+\}", "1", url)  # otros parámetros de ruta: cualquier valor válido
            params = {nombre: malo} if donde == "query" else {}
            r = c.request(metodo.upper(), url, params=params, json={} if metodo != "get" else None)
            # Un 422 y en español: antes se aceptaba también un 404, que habría
            # dejado pasar una ruta que no valida y encima no encuentra nada.
            assert r.status_code == 422, (metodo, ruta, malo, r.status_code)
            assert not espia.llamadas, f"{metodo.upper()} {ruta} con «{malo}» llegó al proveedor"
            assert "Símbolo inválido" in r.text, (ruta, r.text[:200])
        probadas += 1
    assert probadas >= 35


@pytest.mark.parametrize("ruta,cuerpo", [
    ("/api/portfolio/positions", {"symbol": "AAPL;DROP", "quantity": 1, "cost_basis": 1}),
    ("/api/watchlist", {"symbol": "AA PL"}),
    ("/api/theses", {"symbol": "A" * 13, "title": "t", "body_md": "b"}),
    ("/api/screener/run", {"symbols": ["AAPL", "MSFT;X"], "filters": []}),
    ("/api/signals/score", {"symbols": ["AAPL", "MSFT", "<b>"]}),
    ("/api/news/interpret", {"headline": "x", "symbol": "AAPL$"}),
    ("/api/expectativas/eventos", {"symbol": "..", "tipo": "earnings"}),
])
def test_un_simbolo_malicioso_en_un_cuerpo_tambien(cliente, ruta, cuerpo):
    c, espia = cliente
    r = c.post(ruta, json=cuerpo)
    assert r.status_code == 422 and "Símbolo inválido" in r.text, (ruta, r.status_code, r.text[:200])
    assert not espia.llamadas


def test_los_simbolos_buenos_siguen_pasando(cliente):
    c, espia = cliente
    for bueno in ("AAPL", "BRK-B", "RY.TO", "BTC-USD", "aapl"):
        r = c.get(f"/api/stocks/{bueno}/quote")
        assert r.status_code != 422, (bueno, r.text[:200])


def test_los_simbolos_buenos_pasan_tambien_por_query_lista_y_cuerpo_y_llegan_en_mayusculas(cliente):
    """La revisión de la Fase 0 vio que solo se probaba la ruta. Y que la
    validación común había cambiado el contrato: un `?symbol=` vacío o con
    espacios pasó a 422, cuando antes era «sin filtro» o se recortaba."""
    c, espia = cliente
    c.get("/api/news", params={"symbol": " aapl "})
    c.get("/api/etfs/recomendar", params={"symbols": "spy , qqq"})
    pedidos = {kw.get("symbol") for _, kw in espia.llamadas}
    assert {"AAPL", "SPY", "QQQ"} <= pedidos, pedidos
    r = c.post("/api/watchlist", json={"symbol": " brk-b "})
    assert r.status_code != 422 and r.json().get("symbol", "BRK-B") == "BRK-B", r.text[:200]
    # Lo vacío sigue siendo «sin filtro» en todas las queries opcionales con símbolo.
    for url in ("/api/expectativas/eventos", "/api/snapshots", "/api/theses/decisiones", "/api/news"):
        for vacio in ("", "  "):
            r = c.get(url, params={"symbol": vacio})
            assert r.status_code != 422, (url, repr(vacio), r.text[:200])


def test_un_cuerpo_con_symbol_vacio_opcional_no_es_un_ticker_malo(cliente):
    c, _ = cliente
    r = c.post("/api/news/interpret", json={"headline": "x", "symbol": ""})
    assert r.status_code != 422, r.text[:200]


def test_el_backend_solo_escucha_en_local_y_cors_solo_admite_el_vite_local(cliente):
    from app.config import settings

    start = (RAIZ / "start.sh").read_text(encoding="utf-8")
    assert "--host 127.0.0.1" in start and "0.0.0.0" not in start
    assert "0.0.0.0" not in (RAIZ / "frontend" / "vite.config.ts").read_text(encoding="utf-8")
    assert set(settings.cors_origins) <= {"http://localhost:5173", "http://127.0.0.1:5173"}
    c, _ = cliente
    ajena = c.options("/api/meta/health", headers={"Origin": "https://malicioso.example",
                                                   "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in {k.lower() for k in ajena.headers}
    local = c.options("/api/meta/health", headers={"Origin": "http://localhost:5173",
                                                   "Access-Control-Request-Method": "GET"})
    assert local.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_env_no_se_versiona_y_la_plantilla_no_lleva_claves():
    assert re.search(r"^\.env$", (RAIZ / ".gitignore").read_text(encoding="utf-8"), re.M)
    for linea in (RAIZ / ".env.example").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Z_]+_API_KEY)=(.*)$", linea)
        if m:
            assert m.group(2).strip() == "", f"{m.group(1)} lleva un valor en .env.example"


def test_ningun_fichero_versionado_contiene_algo_con_forma_de_clave():
    try:
        ficheros = subprocess.run(["git", "ls-files"], cwd=RAIZ, capture_output=True, text=True, check=True).stdout.split()
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("sin git")
    patron = re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}|(?:API_KEY|apikey|token)=[A-Za-z0-9]{16,}")
    sospechosos = []
    for f in ficheros:
        ruta = RAIZ / f
        if ruta.suffix in {".png", ".gz", ".ico", ".db"} or not ruta.is_file() or ruta.stat().st_size > 2_000_000:
            continue
        try:
            texto = ruta.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        sospechosos += [f"{f}: {m.group(0)[:12]}…" for m in patron.finditer(texto)]
    assert not sospechosos, sospechosos


def test_las_rutas_fijas_no_las_tapa_una_ruta_con_parametro(cliente):
    """Encontrado por el sondeo de símbolos: «/api/etfs/{symbol}» iba antes que
    «/api/etfs/recomendar» y se la quedaba. La recomendación de ETFs nunca se
    ejecutaba: devolvía la ficha del «ETF» RECOMENDAR."""
    c, espia = cliente
    c.get("/api/etfs/recomendar", params={"symbols": "SPY,QQQ"})
    pedidos = {kw.get("symbol") for _, kw in espia.llamadas}
    assert "RECOMENDAR" not in pedidos and {"SPY", "QQQ"} & pedidos, pedidos


def test_ninguna_ruta_con_parametro_tapa_a_una_fija_declarada_despues():
    """La forma general del fallo de /api/etfs/recomendar, en todos los routers."""
    import ast

    tapadas = []
    for f in sorted((RAIZ / "backend" / "app" / "routers").glob("*.py")):
        rutas = []
        for n in ast.parse(f.read_text(encoding="utf-8")).body:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for d in n.decorator_list:
                    if (isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.args
                            and isinstance(d.args[0], ast.Constant) and d.func.attr in ("get", "post", "put", "delete", "patch")):
                        rutas.append((d.func.attr, d.args[0].value))
        for i, (m1, p1) in enumerate(rutas):
            patron = "^" + re.sub(r"\{[^}]+\}", "[^/]+", p1) + "$"
            tapadas += [f"{f.name}: {m1.upper()} {p1} tapa a {p2}" for m2, p2 in rutas[i + 1:]
                        if m1 == m2 and p1 != p2 and "{" in p1 and re.match(patron, p2)]
    assert not tapadas, tapadas


def test_ninguna_ruta_tapa_a_otra_en_toda_la_app():
    """Lo mismo, con el orden REAL de registro: los `include_router` de `main.py`
    y, dentro de cada router, el orden de declaración. El test anterior solo
    comparaba rutas de un mismo fichero; dos routers con el mismo prefijo
    podían taparse sin que nada lo dijera."""
    import ast
    import importlib

    principal = ast.parse((RAIZ / "backend" / "app" / "main.py").read_text(encoding="utf-8"))
    incluidos = [n.args[0] for n in ast.walk(principal) if isinstance(n, ast.Call)
                 and isinstance(n.func, ast.Attribute) and n.func.attr == "include_router" and n.args]
    rutas = []
    for arg in incluidos:
        modulo, atributo = arg.value.id, arg.attr  # stocks.router, portfolio.watchlist_router…
        router = getattr(importlib.import_module(f"app.routers.{modulo}"), atributo)
        rutas += [(m, r.path) for r in router.routes for m in sorted(getattr(r, "methods", None) or [])]
    # Todas las operaciones del esquema tienen que estar en la lista reconstruida.
    from app.main import app

    esquema = {(m.upper(), r) for r, ops in app.openapi()["paths"].items() for m in ops}
    assert esquema <= set(rutas), f"rutas sin reconstruir: {sorted(esquema - set(rutas))[:5]}"
    tapadas = []
    for i, (m1, p1) in enumerate(rutas):
        if "{" not in p1:
            continue
        patron = "^" + re.sub(r"\{[^}]+\}", "[^/]+", p1) + "$"
        tapadas += [f"{m1} {p1} tapa a {p2}" for m2, p2 in rutas[i + 1:]
                    if m1 == m2 and p1 != p2 and re.match(patron, p2)]
    assert not tapadas, tapadas
