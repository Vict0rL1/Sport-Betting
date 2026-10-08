"""Golden master del motor (ítem 0.3 del plan de correcciones).

El plan arregla textos, formatos y pantallas, y tiene una regla dura: **no
cambiar lo que la app decide**. Esto lo demuestra. Cada componente del motor
—`decide()`, el dimensionador, el coste de oportunidad, la calidad de
beneficios, la vigilancia de tesis, el análisis de empresa entero (confianza,
riesgo, valoración), los dos DCF y la lista diaria— se ejecuta sobre entradas
fijas y su salida canónica (códigos y números, sin texto) se compara con la
grabada en `tests/golden/*.json`.

Si este test falla, NO se regenera el golden para que pase: primero se explica
qué decisión cambió y por qué, y se pide el visto bueno.
"""

from __future__ import annotations

import importlib
import json

import pytest

from tests.golden import generar as g
from tests.golden.motor import COMPONENTES, generar


def _por_caso(casos: list[dict]) -> dict[str, object]:
    return {c["caso"]: c["salida"] for c in casos}


def _primera_diferencia(a, b, ruta: str = "") -> str | None:
    if type(a) is not type(b):
        return f"{ruta or '/'}: {a!r} → {b!r}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                return f"{ruta}/{k}: {'falta' if k not in b else 'nuevo'}"
            d = _primera_diferencia(a[k], b[k], f"{ruta}/{k}")
            if d:
                return d
        return None
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{ruta}: {len(a)} elementos → {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = _primera_diferencia(x, y, f"{ruta}[{i}]")
            if d:
                return d
        return None
    return None if a == b else f"{ruta}: {a!r} → {b!r}"


def _diferencias(esperado: list[dict], actual: list[dict], maximo: int = 8) -> list[str]:
    e, a = _por_caso(esperado), _por_caso(actual)
    salida = [f"caso desaparecido: {k}" for k in e if k not in a] + [f"caso nuevo: {k}" for k in a if k not in e]
    for k in e:
        if k in a and e[k] != a[k]:
            salida.append(f"{k}: {_primera_diferencia(e[k], a[k])}")
    return salida[:maximo] + ([f"… y {len(salida) - maximo} más"] if len(salida) > maximo else [])


@pytest.mark.parametrize("nombre", list(COMPONENTES))
def test_el_motor_decide_lo_mismo_que_en_el_golden(nombre):
    ruta = g.ruta(nombre)
    assert ruta.exists(), f"Falta {ruta.name}: genera con `python -m tests.golden.generar --escribir {nombre}`"
    esperado = json.loads(ruta.read_text(encoding="utf-8"))
    actual = json.loads(g.serializar(generar(nombre)))
    if actual != esperado:
        pytest.fail(
            f"El motor ya no decide lo mismo en «{nombre}». Esto NO se arregla regenerando el golden:\n  "
            + "\n  ".join(_diferencias(esperado, actual))
        )


# El golden sirve si de verdad VE los umbrales. Cada fila mueve uno —de los que
# el motor lee al ejecutarse— y exige que el componente que lo usa cambie. Si
# alguien recorta las entradas del golden hasta dejar un umbral sin cubrir, esto
# lo dice. (Los umbrales que viajan como argumento por defecto, como el +0,35 de
# `decide()` o el 10 % por posición, se comprobaron a mano editando el fichero.)
SENSIBILIDAD = [
    # STOP_MIN_PCT se copia en TOPES_STOP al importar: lo que se lee es la tabla.
    ("app.analysis.decision", "TOPES_STOP", {"accion": (9.0, 25.0), "cripto": (15.0, 60.0), "etf": (6.0, 20.0)},
     "decide"),
    ("app.analysis.decision", "TOPES_STOP", {"accion": (8.0, 25.0), "cripto": (15.0, 50.0), "etf": (6.0, 20.0)},
     "decide"),
    ("app.analysis.decision", "RATIO_OBJETIVO", 2.5, "decide"),
    ("app.analysis.decision", "BANDA_TENDENCIA_ENTRAR_PCT", 3.0, "decide"),
    ("app.analysis.decision", "BANDA_TENDENCIA_SALIR_PCT", 2.0, "decide"),
    ("app.analysis.sizing", "FACTOR_EVIDENCIA_BAJA", 0.6, "sizing"),
    ("app.analysis.coste_de_oportunidad", "MEJORA_MINIMA", 4, "oportunidad"),
    ("app.analysis.coste_de_oportunidad", "TENENCIA_MINIMA_DIAS", 5, "oportunidad"),
    ("app.analysis.coste_de_oportunidad", "PUNTOS_PRUDENCIA_IMPUESTOS", 2, "oportunidad"),
    ("app.analysis.calidad_beneficios", "CFO_NI_BUENO", 1.5, "calidad"),
    ("app.analysis.calidad_beneficios", "SBC_NORMAL", 0.01, "calidad"),
    ("app.analysis.confianza", "MAX_DESCONOCIDOS_DEBIL", 0, "analisis"),
    ("app.routers.signals", "FAVORABLE_MIN", 0.5, "hoy"),
]


@pytest.mark.parametrize("modulo,constante,valor,componente", SENSIBILIDAD,
                         ids=[f"{m.rsplit('.', 1)[-1]}.{c}.{i}" for i, (m, c, _, _) in enumerate(SENSIBILIDAD)])
def test_el_golden_detecta_un_umbral_movido(monkeypatch, modulo, constante, valor, componente):
    monkeypatch.setattr(importlib.import_module(modulo), constante, valor)
    esperado = json.loads(g.ruta(componente).read_text(encoding="utf-8"))
    actual = json.loads(g.serializar(generar(componente)))
    assert actual != esperado, f"Mover {constante} no cambia «{componente}»: el golden no cubre ese umbral"
