"""Copia de seguridad de la base antes de tocarla (ítem 0.8 del plan).

Una migración no destruye datos, pero si algo sale mal a mitad, la copia de
justo antes es lo único que devuelve tus posiciones, tesis e instantáneas. Se
usa la API de copia de SQLite (consistente aunque la base esté abierta) y se
guardan las `GUARDAR` más recientes en `copias/`, junto a la base.

Una sola implementación para todos los caminos que pueden migrar:

- `start.sh` la llama en cada arranque (`python -m app.db.copia`);
- `migrar()` la llama antes de aplicar migraciones pendientes, así que también
  la cubren `scripts/validar_con_datos_reales.py` y cualquier `init_db()`;
- `migrations/env.py`, para un `alembic upgrade` hecho a mano.

La primera versión era un script de bash que resolvía la ruta de la base por su
cuenta, y la revisión de la Fase 0 le encontró tres agujeros: solo leía el
`.env` de la raíz (el backend da prioridad a `backend/.env`, así que copiaba
otra base, o ninguna, mientras se migraba la de verdad); borraba los espacios
de la ruta («Mi Carpeta» → «MiCarpeta», y la copia se saltaba sin aviso); y si
`DATABASE_PATH` apuntaba a un fichero que no existía, callaba. Aquí la ruta la
resuelve `settings`, exactamente como el backend que la va a abrir.
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

GUARDAR = 10


def carpeta_de_copias(base: Path) -> Path:
    return base.parent / "copias"


def copiar(base: Path, guardar: int = GUARDAR, ahora: datetime | None = None) -> Path | None:
    """Copia `base` en `copias/app-AAAAMMDD-HHMMSS.db` y deja solo las `guardar` más recientes.

    Devuelve la ruta de la copia, o `None` si no hay nada que copiar (la base aún
    no existe o está vacía: primera ejecución). Lanza si la copia falla: quien
    llama no debe seguir adelante sin ella."""
    base = Path(base)
    if not base.is_file() or base.stat().st_size == 0:
        return None
    destino = carpeta_de_copias(base)
    destino.mkdir(parents=True, exist_ok=True)
    marca = (ahora or datetime.now(timezone.utc)).strftime("%Y%m%d-%H%M%S")
    copia = destino / f"{base.stem}-{marca}.db"
    n = 1
    while copia.exists():  # dos copias en el mismo segundo no se pisan
        copia = destino / f"{base.stem}-{marca}-{n}.db"
        n += 1
    origen = sqlite3.connect(f"file:{base}?mode=ro", uri=True)
    try:
        with sqlite3.connect(copia) as nueva:
            origen.backup(nueva)
        nueva.close()
    finally:
        origen.close()
    viejas = sorted(destino.glob(f"{base.stem}-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    for vieja in viejas[guardar:]:
        vieja.unlink()
    return copia


def ruta_de_sqlite(url: str) -> Path | None:
    """La ruta del fichero de una URL `sqlite:///…`; `None` si es en memoria o no es SQLite."""
    if not url.startswith("sqlite:///"):
        return None
    ruta = url[len("sqlite:///"):]
    return Path(ruta) if ruta and ruta != ":memory:" else None


def main(argv: list[str]) -> int:
    """Lo que llama `start.sh`: copia la base que va a abrir el backend y dice dónde."""
    from app.config import settings

    base = Path(settings.database_path)
    try:
        copia = copiar(base)
    except (OSError, sqlite3.Error) as exc:
        print(f"No pude copiar la base ({base}): {exc}", file=sys.stderr)
        return 1
    if copia is None:
        # Fail-safe: si la ruta se configuró a mano y no hay nada, puede que esté mal escrita.
        print(f"Aviso: no hay base en {base} todavía; nada que copiar. Si ya tenías datos, "
              "revisa DATABASE_PATH en .env o backend/.env.", file=sys.stderr)
        return 0
    print(copia)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
