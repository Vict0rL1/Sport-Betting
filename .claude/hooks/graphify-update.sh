#!/bin/bash
# Después de cada Edit/Write de Claude: pone al día el grafo de graphify (CLAUDE.md) en SEGUNDO
# PLANO. Una actualización tarda unos 15 s y no puede frenar cada edición: el hook deja una
# marca, lanza el trabajo y vuelve al momento. Uno solo a la vez; si llegan más ediciones
# mientras trabaja, repite al acabar. Sin graphify o sin grafo (un ordenador sin instalarlo),
# no hace nada.
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT" 2>/dev/null || exit 0
export PATH="$HOME/.local/bin:$PATH"
OUT=graphify-out

if [ "${1:-}" = "--trabajar" ]; then
  # Un candado viejo (un contenedor que se cerró a medias) no puede bloquear para siempre.
  find "$OUT/.actualizando" -maxdepth 0 -mmin +10 -exec rmdir {} \; 2>/dev/null
  mkdir "$OUT/.actualizando" 2>/dev/null || exit 0 # ya hay uno: verá la marca y repetirá
  trap 'rmdir "$OUT/.actualizando" 2>/dev/null' EXIT
  while [ -f "$OUT/.pendiente" ]; do
    rm -f "$OUT/.pendiente"
    graphify update . >> "$OUT/.actualizar.log" 2>&1 || true
  done
  exit 0
fi

command -v graphify >/dev/null 2>&1 || exit 0
[ -f "$OUT/graph.json" ] || exit 0
# Solo si lo editado es código (lo que extrae `--code-only`); si no se sabe qué fue, se actualiza.
fichero=$(sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
case "$fichero" in
  "" | *.ts | *.tsx | *.mts | *.cts | *.js | *.jsx | *.mjs | *.cjs | *.py | *.sh) ;;
  *) exit 0 ;;
esac
touch "$OUT/.pendiente"
nohup "$0" --trabajar >/dev/null 2>&1 &
exit 0
