#!/bin/bash
# Al empezar una sesión de Claude Code en la web (el contenedor es nuevo cada vez): las
# dependencias, para que los tests y el lint funcionen desde el principio, y el grafo del código
# con graphify (local, sin modelo ni clave de API; ver CLAUDE.md). En tu ordenador no hace nada.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

npm install --no-audit --no-fund

# graphify: si algo falla aquí, la sesión arranca igual (sin grafo, se leen los ficheros).
export PATH="$HOME/.local/bin:$PATH"
echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "${CLAUDE_ENV_FILE:-/dev/null}"
{
  if ! command -v graphify >/dev/null 2>&1; then
    command -v uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh
    uv tool install graphifyy==0.9.86
  fi
  if [ -f graphify-out/graph.json ]; then
    graphify update .
  else
    graphify extract . --code-only && graphify cluster-only . --no-label --no-viz
  fi
} >&2 || echo "graphify no está disponible en esta sesión (el hook siguió sin él)." >&2
