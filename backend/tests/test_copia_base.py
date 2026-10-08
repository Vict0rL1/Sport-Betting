"""Copia de la base antes de migrar (ítem 0.8 del plan).

`start.sh` llama a `backend/scripts/copia_base.sh` antes de arrancar el backend,
que migra la base al arrancar. Se prueba el script de verdad, con bash, sobre
una base temporal: nunca la tuya.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]
SCRIPT = RAIZ / "backend" / "scripts" / "copia_base.sh"

pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="sin bash")


def _base(ruta: Path) -> Path:
    with sqlite3.connect(ruta) as c:
        c.execute("CREATE TABLE positions (id INTEGER PRIMARY KEY, symbol TEXT)")
        c.execute("INSERT INTO positions (symbol) VALUES ('KO')")
    return ruta


def _copiar(base: Path, destino: Path, guardar: int = 10) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(SCRIPT), str(base), str(destino), str(guardar)],
                          capture_output=True, text=True, check=True)


def test_copia_la_base_entera_y_dice_donde(tmp_path):
    base = _base(tmp_path / "app.db")
    r = _copiar(base, tmp_path / "backups")
    copia = Path(r.stdout.strip())
    assert copia.parent == tmp_path / "backups" and copia.name.startswith("app-") and copia.suffix == ".db"
    with sqlite3.connect(copia) as c:
        assert c.execute("SELECT symbol FROM positions").fetchall() == [("KO",)]


def test_guarda_solo_las_diez_mas_recientes(tmp_path):
    base = _base(tmp_path / "app.db")
    backups = tmp_path / "backups"
    backups.mkdir()
    ahora = time.time()
    for i in range(12):  # doce copias viejas, la 0 la más antigua
        vieja = backups / f"app-2026010{i // 10}-{i:06d}.db"
        vieja.write_bytes(b"vieja")
        os.utime(vieja, (ahora - 10_000 + i, ahora - 10_000 + i))
    nueva = Path(_copiar(base, backups).stdout.strip())
    quedan = sorted(backups.glob("app-*.db"))
    assert len(quedan) == 10 and nueva in quedan
    # Se fueron las más antiguas: las tres primeras.
    assert not any((backups / f"app-2026010{i // 10}-{i:06d}.db").exists() for i in range(3))


def test_sin_base_todavia_no_hace_nada(tmp_path):
    r = _copiar(tmp_path / "no-existe.db", tmp_path / "backups")
    assert r.stdout == "" and not (tmp_path / "backups").exists()


def test_start_sh_copia_antes_de_arrancar_el_backend():
    """El orden importa: la copia tiene que ser ANTES de que el backend migre."""
    texto = (RAIZ / "start.sh").read_text(encoding="utf-8")
    assert texto.index("copia_base.sh") < texto.index('step "Arrancando backend…"')
    assert "backups/" in (RAIZ / ".gitignore").read_text(encoding="utf-8")
