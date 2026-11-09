#!/bin/bash
# Instala en el Mac el trabajador que analiza las comidas del plan "propio"
# con la suscripcion de Claude. Se puede repetir: deja todo como nuevo.
# Necesita la sesion de Supabase CLI abierta (supabase login) para sacar la
# service key, que se guarda en ~/.config/cuaderno y nunca en el repo.
set -euo pipefail
REF="${1:-ocrmaythsawmuotoqvzr}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Cuaderno"
CONF="$HOME/.config/cuaderno"
PLIST="$HOME/Library/LaunchAgents/com.cuaderno.comidas.plist"

mkdir -p "$DEST" "$CONF"
chmod 700 "$CONF"
cp "$AQUI/comidas_suscripcion.py" "$DEST/"

if [ ! -s "$CONF/servicio.json" ]; then
  KEY="$(supabase projects api-keys --project-ref "$REF" -o json \
        | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(k["api_key"] for k in d if k.get("name")=="service_role"))')"
  python3 - "$REF" "$KEY" "$CONF/servicio.json" <<'PY'
import json, sys
json.dump({"url": "https://%s.supabase.co" % sys.argv[1], "service_key": sys.argv[2]}, open(sys.argv[3], "w"))
PY
  chmod 600 "$CONF/servicio.json"
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.cuaderno.comidas</string>
<key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>$DEST/comidas_suscripcion.py</string></array>
<key>StartInterval</key><integer>60</integer>
<key>RunAtLoad</key><true/>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
<key>StandardErrorPath</key><string>$HOME/Library/Logs/cuaderno_comidas.err</string>
</dict></plist>
EOF

launchctl bootout "gui/$(id -u)/com.cuaderno.comidas" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Trabajador instalado: mira cada minuto si hay comidas que calcular."
