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

import functools
import json

import pytest

from tests.golden import generar as g
from tests.golden import umbrales
from tests.golden.motor import COMPONENTES, generar, generar_perezoso


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


# El golden sirve si de verdad VE los umbrales. El inventario sale del código
# (`tests/golden/umbrales.py`): toda constante numérica de un módulo del motor
# está cubierta —se mueve y el componente que la usa tiene que cambiar— o exenta
# con su motivo. La primera versión era una lista escrita a mano de lo que sí se
# veía, y por eso no podía decir lo que no: la revisión de la fase encontró
# catorce umbrales (confianza, calidad) que se podían doblar sin que nada fallara.

def test_todo_umbral_del_motor_esta_cubierto_o_exento_con_motivo():
    inventario = set(umbrales.inventario())
    clasificados = set(umbrales.UMBRALES) | set(umbrales.EXENTOS)
    assert not set(umbrales.UMBRALES) & set(umbrales.EXENTOS), "un umbral no puede estar cubierto y exento"
    sin_clasificar = sorted(inventario - clasificados)
    assert not sin_clasificar, (
        "Umbrales nuevos sin clasificar. Añade un caso al golden que los roce y ponlos en UMBRALES, o "
        "explica en EXENTOS por qué no deciden nada:\n  " + "\n  ".join(sin_clasificar))
    assert not clasificados - inventario, f"Ya no existen: {sorted(clasificados - inventario)}"
    assert all(len(m) > 20 for m in umbrales.EXENTOS.values()), "cada exención lleva su motivo"


@functools.cache
def _grabado(componente: str) -> dict[str, object]:
    return _por_caso(json.loads(g.ruta(componente).read_text(encoding="utf-8")))


_MOVIDOS = [(ruta, valor, comp) for ruta, filas in umbrales.UMBRALES.items() for valor, comp in filas]


@pytest.mark.parametrize("ruta,valor,componente", _MOVIDOS,
                         ids=[f"{r.rsplit('.', 2)[-2]}.{r.rsplit('.', 1)[-1]}.{i}" for i, (r, _, _) in enumerate(_MOVIDOS)])
def test_el_golden_detecta_un_umbral_movido(ruta, valor, componente):
    esperado = _grabado(componente)
    vistos = 0
    with umbrales.mover(ruta, valor):
        # Caso a caso: basta con el primero que cambie (regenerar el análisis
        # entero para cada uno de los ~100 umbrales costaba más de un minuto).
        for caso in generar_perezoso(componente):
            vistos += 1
            normal = json.loads(g.serializar([caso]))[0]
            if esperado.get(normal["caso"]) != normal["salida"]:
                return
    if vistos != len(esperado):
        return  # desaparecieron casos: también es un cambio visto
    pytest.fail(f"Mover {ruta} a {valor!r} no cambia «{componente}»: el golden no cubre ese umbral")


def test_canon_guarda_las_decisiones_dichas_con_palabras():
    """Antes se descartaban por llevar tilde o espacio: el golden no veía qué tope
    recortó el tamaño ni qué dato faltaba."""
    from tests.golden.canon import canon

    assert canon({"limite": "posición", "faltan": ["puntuación"], "hacia": "cualquier acción",
                  "impuestos": "sin plusvalía", "key": "Consumer Staples"}) == {
        "limite": "posición", "faltan": ["puntuación"], "hacia": "cualquier acción",
        "impuestos": "sin plusvalía", "key": "Consumer Staples"}
    # Una frase bajo la misma clave es texto (la calidad usa `limite` para el límite del método).
    assert canon({"limite": "Las partidas salen de etiquetas concretas."}) == {}


def test_canon_no_descarta_en_silencio_un_texto_sin_clasificar():
    from tests.golden.canon import TextoSinClasificar, canon

    with pytest.raises(TextoSinClasificar, match="clave_nueva"):
        canon({"clave_nueva": "Un texto que nadie ha clasificado"})
    with pytest.raises(TextoSinClasificar):
        canon({"limite": "tope: raro"})  # ni palabra-código ni frase
    assert canon({"motivo": "Prosa conocida"}) == {} and canon({"regla": "r_precio"}) == {"regla": "r_precio"}
