"""Un solo formato de cifras para backend y frontend (ítem 1.7: V4, V5, V8).

La tabla de casos es la MISMA que prueba `frontend/src/lib/formato.test.ts`: si
un lado cambia una regla y el otro no, uno de los dos tests falla. Antes el
backend escribía «31.2 %» y el frontend «45,5 %» en la misma pantalla.
"""

from __future__ import annotations

import ast
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app import formato

CASOS = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/lib/formato.casos.json").read_text())
FUNCIONES = [k for k in CASOS if not k.startswith("_")]
ESPECIALES = {"NaN": math.nan, "Infinity": math.inf}


def _llamar(funcion: str, args: list, opciones: dict) -> str:
    if funcion == "fmt_antiguedad":
        args = [args[0], datetime.fromisoformat(args[1].replace("Z", "+00:00"))]
    elif funcion != "fmt_fecha" and isinstance(args[0], str):
        args = [ESPECIALES[args[0]], *args[1:]]
    return getattr(formato, funcion)(*args, **opciones)


def test_la_tabla_cubre_todas_las_funciones_publicas():
    publicas = {n for n in dir(formato) if n.startswith("fmt_")} | {"plural"}
    assert set(FUNCIONES) == publicas


@pytest.mark.parametrize(
    "funcion,args,opciones,esperado",
    [(f, *caso) for f in FUNCIONES for caso in CASOS[f]],
    ids=lambda x: json.dumps(x, ensure_ascii=False) if isinstance(x, (list, dict)) else str(x),
)
def test_caso_compartido(funcion, args, opciones, esperado):
    assert _llamar(funcion, args, opciones) == esperado


def test_el_cero_negativo_de_json_llega_como_cero_negativo():
    # Si `-0.0` llegara como 0, el caso de V8 no probaría nada.
    ceros = [c[0][0] for c in CASOS["fmt_num"] if c[0][0] == 0]
    assert any(isinstance(z, float) and math.copysign(1, z) == -1 for z in ceros)


def test_un_instante_y_un_datetime_con_zona_dan_lo_mismo():
    instante = datetime(2026, 9, 12, 14, 35, tzinfo=timezone.utc)
    assert formato.fmt_fecha(instante, hora=True, zona="America/New_York") == "12 sept 2026, 10:35\u00a0ET"
    assert formato.fmt_antiguedad(instante, datetime(2026, 9, 12, 15, 35, tzinfo=timezone.utc)) == "hace 1 h"


def test_un_booleano_no_es_una_cifra():
    assert formato.fmt_num(True) == "—"


# --- Guarda: nadie más formatea cifras -------------------------------------------
#
# Había 249 sitios con `{x:.1f} %`, `{x:+.2f}`, `{x:.0%}` o `{x:g}` repartidos por
# el backend, cada uno con su punto decimal inglés (V4). Toda cifra para una
# persona pasa por `app/formato.py`; un f-string que formatea un número por su
# cuenta, o que interpola en crudo una constante decimal («≥ 0.7»), rompe esto.

APP = Path(__file__).resolve().parents[1] / "app"

# Lo que no es texto para leer, con su motivo. (fichero, expresión) → motivo.
INTERNOS = {
    ("analisis_empresa.py", "round(propia['contribucion'], 2)"):
        "huella para comparar dos contribuciones al riesgo; no se enseña",
    ("analisis_empresa.py", "round(hipotesis['contribucion_del_candidato'], 2)"):
        "huella para comparar dos contribuciones al riesgo; no se enseña",
    ("snapshots.py", "ahora.astimezone(timezone.utc)"):
        "identificador del origen de una instantánea; cómo se enseña es el ítem 1.8",
}


def _constantes_decimales() -> dict[str, set[str]]:
    """Módulo → nombres de constantes de módulo que valen un float (0.7, 1.0…)."""
    salida: dict[str, set[str]] = {}
    for f in APP.rglob("*.py"):
        nombres = set()
        for n in ast.parse(f.read_text()).body:
            if isinstance(n, ast.Assign) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, float):
                nombres |= {t.id for t in n.targets if isinstance(t, ast.Name)}
        salida[".".join(f.relative_to(APP.parent).with_suffix("").parts)] = nombres
    return salida


def _formatos_sueltos() -> list[str]:
    decimales = _constantes_decimales()
    malos = []
    for f in sorted(APP.rglob("*.py")):
        if f.name == "formato.py":
            continue
        arbol = ast.parse(f.read_text())
        modulo = ".".join(f.relative_to(APP.parent).with_suffix("").parts)
        flotantes = set(decimales.get(modulo, set()))
        for n in arbol.body:
            if isinstance(n, ast.ImportFrom) and n.module in decimales:
                flotantes |= {a.asname or a.name for a in n.names if a.name in decimales[n.module]}
        for n in ast.walk(arbol):
            if not isinstance(n, ast.FormattedValue):
                continue
            expr = ast.unparse(n.value)
            es_round = isinstance(n.value, ast.Call) and getattr(n.value.func, "id", None) == "round"
            crudo = n.format_spec is None and isinstance(n.value, ast.Name) and n.value.id in flotantes
            if (n.format_spec is not None or es_round or crudo) and (f.name, expr) not in INTERNOS:
                spec = ast.unparse(n.format_spec)[2:-1] if n.format_spec is not None else ""
                malos.append(f"{f.relative_to(APP.parent)}:{n.lineno} {{{expr}{':' + spec if spec else ''}}}")
    return malos


def test_ningun_modulo_formatea_cifras_por_su_cuenta():
    malos = _formatos_sueltos()
    assert not malos, (
        "Cifras formateadas fuera de app/formato.py (usa fmt_num, fmt_pct, fmt_dinero, "
        "fmt_compacto o fmt_fecha):\n  " + "\n  ".join(malos)
    )


def test_los_internos_siguen_existiendo():
    """Si un interno desaparece, su excepción sobra: la lista solo encoge."""
    vistos = set()
    for f in APP.rglob("*.py"):
        for n in ast.walk(ast.parse(f.read_text())):
            if isinstance(n, ast.FormattedValue):
                vistos.add((f.name, ast.unparse(n.value)))
    assert set(INTERNOS) <= vistos


def test_la_guarda_ve_cada_forma_de_formatear(tmp_path, monkeypatch):
    """Comprueba la guarda: cada forma conocida de formatear a mano salta."""
    paquete = tmp_path / "app"
    paquete.mkdir()
    (paquete / "malo.py").write_text(
        "UMBRAL = 0.7\n"
        "ENTERO = 20\n"
        "def f(x):\n"
        "    return [f'{x:.1f} %', f'{x:+.2f}', f'{x:.0%}', f'{x:g}', f'{x:,}',\n"
        "            f'{round(x, 1)}', f'≥ {UMBRAL}', f'{ENTERO} días', f'{x}']\n"
    )
    monkeypatch.setattr(sys.modules[__name__], "APP", paquete)
    malos = _formatos_sueltos()
    assert [m.split(" ", 1)[1] for m in malos] == [
        "{x:.1f}", "{x:+.2f}", "{x:.0%}", "{x:g}", "{x:,}", "{round(x, 1)}", "{UMBRAL}",
    ]
