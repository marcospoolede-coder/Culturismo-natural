#!/bin/bash
# Despliega todo lo de Alimentacion en Supabase de una vez, sin tocar el panel:
# tablas (nutricion.sql), las tres Edge Functions y el reloj de WHOOP.
# Necesita `supabase login` hecho una vez. Se puede repetir sin miedo.
#
#   bash supabase/despliega.sh                 todo
#   WHOOP_ID=... WHOOP_SECRET=... bash supabase/despliega.sh   y guarda las claves de WHOOP
#   ANTHROPIC_API_KEY=... bash supabase/despliega.sh           y activa la foto para el plan de pago
set -euo pipefail
REF="${REF:-ocrmaythsawmuotoqvzr}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"

echo "1. Tablas y permisos"
supabase db query --remote="$REF" --yes -f nutricion.sql >/dev/null

echo "2. Funciones"
supabase functions deploy analiza-comida --project-ref "$REF" --use-api
supabase functions deploy whoop  --project-ref "$REF" --use-api --no-verify-jwt
supabase functions deploy salud  --project-ref "$REF" --use-api --no-verify-jwt

echo "3. Secretos"
SEC=()
[ -n "${WHOOP_ID:-}" ]          && SEC+=("WHOOP_CLIENT_ID=$WHOOP_ID")
[ -n "${WHOOP_SECRET:-}" ]      && SEC+=("WHOOP_CLIENT_SECRET=$WHOOP_SECRET")
[ -n "${ANTHROPIC_API_KEY:-}" ] && SEC+=("ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY")
if ! supabase secrets list --project-ref "$REF" 2>/dev/null | grep -q RELOJ_WHOOP; then
  RELOJ="$(openssl rand -hex 24)"
  SEC+=("RELOJ_WHOOP=$RELOJ")
  echo "4. Reloj de WHOOP, cada hora"
  supabase db query --remote="$REF" --yes "
    create extension if not exists pg_net;
    select cron.unschedule('sincroniza-whoop') where exists (select 1 from cron.job where jobname = 'sincroniza-whoop');
    select cron.schedule('sincroniza-whoop', '7 * * * *', \$\$select net.http_post(
      url := 'https://$REF.supabase.co/functions/v1/whoop/todos',
      headers := '{\"Content-Type\":\"application/json\",\"x-reloj\":\"$RELOJ\"}'::jsonb,
      body := '{}'::jsonb)\$\$);" >/dev/null
fi
[ ${#SEC[@]} -gt 0 ] && supabase secrets set --project-ref "$REF" "${SEC[@]}" >/dev/null
echo "Hecho."
