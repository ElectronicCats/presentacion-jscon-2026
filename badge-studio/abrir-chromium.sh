#!/bin/sh
# Abre la app con el Chromium que Playwright dejó en ~/.cache/ms-playwright.
# Ubuntu bloquea el sandbox de un Chromium sin perfil AppArmor, de ahí --no-sandbox: úsalo solo para
# esta página local, con su propio perfil. Con Google Chrome (.deb) instalado basta abrir index.html.
DIR=$(dirname "$(readlink -f "$0")")
CHROME=$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1)
if [ -z "$CHROME" ]; then
    echo "No encontré Chromium en ~/.cache/ms-playwright. Instala Google Chrome y abre $DIR/index.html" >&2
    exit 1
fi
# esptool, PlatformIO and pyserial leave ttys at min=0 time=0; Chromium then takes every idle read for
# "The device has been lost". Restore the default on the badges' ports (Espressif VID 303a).
for tty in /dev/ttyACM*; do
    [ -e "$tty" ] || continue
    if udevadm info -q property -n "$tty" 2>/dev/null | grep -q '^ID_VENDOR_ID=303a$'; then
        stty -F "$tty" min 1 time 0 2>/dev/null
    fi
done

exec "$CHROME" --no-sandbox --user-data-dir="$HOME/.cache/badge-canvas-chromium" \
    --no-first-run --no-default-browser-check --app="file://$DIR/index.html" "$@"
