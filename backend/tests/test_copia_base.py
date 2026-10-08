"""Copia de la base antes de migrar (ítem 0.8 del plan, rehecho tras la revisión de la Fase 0).

La copia vive en `app/db/copia.py` y la llaman `start.sh` (en cada arranque),
`migrar()` (antes de aplicar migraciones pendientes, venga de donde venga) y
`migrations/env.py` (un `alembic upgrade` a mano). La primera versión era un
script de bash que resolvía la ruta por su cuenta: copiaba otra base si había
un `backend/.env`, se saltaba en silencio las rutas con espacios y no avisaba si
`DATABASE_PATH` apuntaba a la nada. Todas las bases de aquí son temporales.
"""

from __future__ import annotations

import os
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from app.db import copia as cp

RAIZ = Path(__file__).resolve().parents[2]


def _base(ruta: Path) -> Path:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(ruta) as c:
        c.execute("CREATE TABLE positions (id INTEGER PRIMARY KEY, symbol TEXT)")
        c.execute("INSERT INTO positions (symbol) VALUES ('KO')")
    return ruta


def test_copia_la_base_entera_junto_a_ella(tmp_path):
    base = _base(tmp_path / "app.db")
    copia = cp.copiar(base)
    assert copia.parent == tmp_path / "copias" and copia.name.startswith("app-") and copia.suffix == ".db"
    with sqlite3.connect(copia) as c:
        assert c.execute("SELECT symbol FROM positions").fetchall() == [("KO",)]


def test_guarda_solo_las_diez_mas_recientes(tmp_path):
    base = _base(tmp_path / "app.db")
    copias = tmp_path / "copias"
    copias.mkdir()
    ahora = time.time()
    for i in range(12):  # doce copias viejas, la 0 la más antigua
        vieja = copias / f"app-2026010{i // 10}-{i:06d}.db"
        vieja.write_bytes(b"vieja")
        os.utime(vieja, (ahora - 10_000 + i, ahora - 10_000 + i))
    nueva = cp.copiar(base)
    quedan = sorted(copias.glob("app-*.db"))
    assert len(quedan) == 10 and nueva in quedan
    assert not any((copias / f"app-2026010{i // 10}-{i:06d}.db").exists() for i in range(3))


def test_dos_copias_en_el_mismo_segundo_no_se_pisan(tmp_path):
    base = _base(tmp_path / "app.db")
    momento = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)
    assert cp.copiar(base, ahora=momento) != cp.copiar(base, ahora=momento)


def test_sin_base_todavia_no_hace_nada(tmp_path):
    assert cp.copiar(tmp_path / "no-existe.db") is None
    assert not (tmp_path / "copias").exists()


def test_una_ruta_con_espacios_se_copia(tmp_path, monkeypatch, capsys):
    """El script de bash hacía `tr -d ' '`: «Mi Carpeta» pasaba a «MiCarpeta» y la copia se saltaba."""
    from app.config import settings

    base = _base(tmp_path / "Mi Carpeta" / "app.db")
    monkeypatch.setattr(settings, "database_path", str(base))
    assert cp.main([]) == 0
    impreso = Path(capsys.readouterr().out.strip())
    assert impreso.parent == base.parent / "copias" and impreso.is_file()


def test_avisa_si_la_base_configurada_no_existe(tmp_path, monkeypatch, capsys):
    from app.config import settings

    monkeypatch.setattr(settings, "database_path", str(tmp_path / "mal escrita" / "app.db"))
    assert cp.main([]) == 0
    salida = capsys.readouterr()
    assert salida.out == "" and "Aviso" in salida.err and "DATABASE_PATH" in salida.err


def test_si_la_copia_falla_start_no_arranca(tmp_path, monkeypatch, capsys):
    from app.config import settings

    base = _base(tmp_path / "app.db")
    monkeypatch.setattr(settings, "database_path", str(base))
    monkeypatch.setattr(cp, "carpeta_de_copias", lambda b: Path("/proc/no-se-puede-escribir-aqui"))
    assert cp.main([]) == 1
    assert "No pude copiar" in capsys.readouterr().err


def test_la_ruta_se_resuelve_como_la_del_backend(tmp_path, monkeypatch):
    """`backend/.env` tiene prioridad sobre el `.env` de la raíz: el script de
    bash leía solo el de la raíz y copiaba otra base mientras se migraba esta."""
    from app.config import Settings

    monkeypatch.delenv("DATABASE_PATH", raising=False)  # la de conftest pisaría a los ficheros

    raiz, backend = tmp_path / "raiz.env", tmp_path / "backend.env"
    raiz.write_text("DATABASE_PATH=/datos/la-de-la-raiz.db\n", encoding="utf-8")
    backend.write_text('DATABASE_PATH="/datos/Mi Carpeta/la-del-backend.db"\n', encoding="utf-8")
    s = Settings(_env_file=(raiz, backend))
    assert s.database_path == "/datos/Mi Carpeta/la-del-backend.db"


def test_migrar_copia_antes_de_tocar_una_base_con_datos(tmp_path):
    from app.db.migraciones import migrar, version_actual

    from tests.test_migraciones import _base_antigua

    engine = _base_antigua(tmp_path / "vieja.db")
    assert version_actual(engine) is None
    r = migrar(engine)
    assert r["migrada"]
    copias = list((tmp_path / "copias").glob("vieja-*.db"))
    assert len(copias) == 1
    with sqlite3.connect(copias[0]) as c:  # la copia es la base de ANTES: sin versión de Alembic
        tablas = {t for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "alembic_version" not in tablas and "positions" in tablas


def test_si_la_copia_falla_no_se_migra(tmp_path, monkeypatch):
    from app.db import migraciones
    from app.db.migraciones import migrar, version_actual

    from tests.test_migraciones import _base_antigua

    engine = _base_antigua(tmp_path / "vieja.db")

    def falla(_):
        raise OSError("disco lleno")

    monkeypatch.setattr(migraciones, "copiar", falla)
    with pytest.raises(OSError, match="disco lleno"):
        migrar(engine)
    assert version_actual(engine) is None  # la base sigue intacta


def test_una_base_al_dia_no_genera_copias(tmp_path):
    from app.db.migraciones import migrar

    engine = create_engine(f"sqlite:///{tmp_path / 'nueva.db'}")
    migrar(engine)  # la crea: no había nada que copiar
    migrar(engine)  # ya al día: no se toca
    assert not (tmp_path / "copias").exists()
    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM alembic_version")).scalar() == 1


def test_start_sh_copia_con_el_backend_antes_de_arrancarlo():
    """El orden importa: la copia tiene que ser ANTES de que el backend migre."""
    texto = (RAIZ / "start.sh").read_text(encoding="utf-8")
    assert texto.index("-m app.db.copia") < texto.index('step "Arrancando backend…"')
    assert "die " in texto[texto.index("-m app.db.copia"):texto.index('step "Arrancando backend…"')]
    assert "copia_base.sh" not in texto and "grep -E '^DATABASE_PATH" not in texto


def test_nada_que_abra_el_motor_hereda_la_base_real():
    """Los scripts de los tests ASIGNAN DATABASE_PATH a un temporal: con un
    `setdefault`, una variable exportada en la shell los conectaba a la base real."""
    culpables = [str(f.relative_to(RAIZ)) for d in ("backend/tests", "backend/scripts")
                 for f in (RAIZ / d).rglob("*.py")
                 if re.search(r"setdefault\(\s*[\"']DATABASE_PATH", f.read_text(encoding="utf-8"))]
    assert not culpables, culpables


def test_un_alembic_upgrade_a_mano_tambien_copia(tmp_path):
    """El camino que no pasa por `migrar()`: la orden de Alembic en la terminal."""
    import subprocess
    import sys

    from tests.test_migraciones import _base_antigua

    carpeta = tmp_path / "con espacio"
    carpeta.mkdir()
    _base_antigua(carpeta / "vieja.db")
    entorno = {**os.environ, "DATABASE_PATH": str(tmp_path / "otra.db")}

    def alembic(*orden):
        r = subprocess.run([sys.executable, "-m", "alembic", "-x", f"url=sqlite:///{carpeta / 'vieja.db'}", *orden],
                           cwd=RAIZ / "backend", env=entorno, capture_output=True, text=True, timeout=120)
        assert r.returncode == 0, r.stderr[-1500:]

    alembic("current")  # mirar no toca nada: no copia
    assert not (carpeta / "copias").exists()
    alembic("upgrade", "head")
    assert len(list((carpeta / "copias").glob("vieja-*.db"))) == 1
