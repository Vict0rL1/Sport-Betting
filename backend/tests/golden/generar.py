"""Genera o comprueba los ficheros del golden master.

    python -m tests.golden.generar              # compara y dice qué cambió
    python -m tests.golden.generar --escribir   # reescribe (acto deliberado)

Reescribir solo cuando un cambio de decisión está aprobado: el golden existe
para demostrar que el plan de correcciones NO cambia lo que decide la app.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

# Como en conftest.py: nunca la base real. Se ASIGNA, no `setdefault`: con
# DATABASE_PATH exportado en la shell, el motor se conectaría a la base de verdad.
os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(prefix="golden-"), "golden.db")

DIR = Path(__file__).resolve().parent


def ruta(nombre: str) -> Path:
    return DIR / f"{nombre}.json"


def serializar(casos: list[dict]) -> str:
    """Un caso por línea: diffs legibles en git sin ficheros gigantes indentados."""
    lineas = [json.dumps(c, ensure_ascii=False, sort_keys=True, separators=(",", ":")) for c in casos]
    return "[\n" + ",\n".join(lineas) + "\n]\n"


def main(argv: list[str]) -> int:
    from tests.golden.motor import COMPONENTES, generar

    escribir = "--escribir" in argv
    nombres = [a for a in argv if not a.startswith("--")] or list(COMPONENTES)
    distintos = 0
    for nombre in nombres:
        texto = serializar(generar(nombre))
        if escribir:
            ruta(nombre).write_text(texto, encoding="utf-8")
            print(f"escrito {ruta(nombre).name} ({len(texto) // 1024} KB)")
        elif not ruta(nombre).exists() or ruta(nombre).read_text(encoding="utf-8") != texto:
            distintos += 1
            print(f"DISTINTO: {nombre}")
        else:
            print(f"igual: {nombre}")
    return 1 if distintos else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
