#!/usr/bin/env bash
#
# Copia de seguridad de la base antes de arrancar (ítem 0.8 del plan).
#
#   backend/scripts/copia_base.sh <base> <carpeta-de-copias> [cuántas-guardar=10]
#
# El backend migra la base al arrancar (Alembic). Una migración no destruye
# datos, pero si algo sale mal a mitad, la copia de justo antes es lo único que
# devuelve tus posiciones, tesis e instantáneas. Se usa la API de copia de
# SQLite (consistente aunque la base esté abierta) y se guardan las N más
# recientes. Sin base todavía (primera ejecución), no hace nada.

set -euo pipefail

BASE=${1:?falta la ruta de la base}
DESTINO=${2:?falta la carpeta de copias}
GUARDAR=${3:-10}

[[ -f "$BASE" ]] || exit 0
mkdir -p "$DESTINO"
COPIA="$DESTINO/app-$(date +%Y%m%d-%H%M%S).db"

python3 - "$BASE" "$COPIA" <<'PY'
import sqlite3, sys
origen = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
copia = sqlite3.connect(sys.argv[2])
origen.backup(copia)
copia.close()
origen.close()
PY

# Las más recientes primero; de la N+1 en adelante, fuera. (Sin `xargs -r`,
# que no existe en macOS.)
ls -1t "$DESTINO"/app-*.db 2>/dev/null | tail -n +"$((GUARDAR + 1))" | while IFS= read -r vieja; do
  rm -f -- "$vieja"
done
echo "$COPIA"
