#!/usr/bin/env bash
# Captura full-height de una ruta del preview local seguro (datos ficticios, sesión de artista ficticia).
# Uso: shot.sh <ruta-sin-base, ej. /artist/dashboard/> <archivo.png> [ancho=1440] [alto=2600] [espera_ms=10000]
# Hash/query permitidos (ej. "/calendar/?view=week"). Cada llamada usa un perfil temporal limpio.
set -euo pipefail
ROUTE="$1"; OUT="$2"; W="${3:-1440}"; H="${4:-2600}"; WAIT="${5:-10000}"
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
PROFILE="$(mktemp -d)"
OUTWIN="$(cygpath -w "$(realpath -m "$OUT")")"
"$CH" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$(cygpath -w "$PROFILE")" \
  --window-size="$W,$H" --virtual-time-budget="$WAIT" --screenshot="$OUTWIN" \
  "http://localhost:4647/preview/preview-local-safe${ROUTE}" >/dev/null 2>&1 || true
rm -rf "$PROFILE"
[ -s "$OUT" ] && echo "ok $OUT" || { echo "FAIL $OUT"; exit 1; }
