#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ ! -x "$here/appdir/AppRun" ]; then
  echo "Tiao's Linux runtime is missing. Verify the game files in Steam." >&2
  exit 1
fi
export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
exec "$here/appdir/AppRun" "$@"
