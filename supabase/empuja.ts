// Edge Function "empuja": manda las notificaciones de los avisos vencidos.
// La llama el reloj de push.sql cada 10 segundos cuando hay algo pendiente.
// Se crea en el panel de Supabase (Edge Functions, Deploy a new function,
// via Editor), con el nombre exacto "empuja" y "Verify JWT" desactivado.
// Necesita dos secretos en Edge Functions, Secrets: VAPID_PUBLICA y
// VAPID_PRIVADA (los tiene Marcos en un archivo local, nunca en este repo).

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (_req) => {
  webpush.setVapidDetails(
    "mailto:marcos@relevofamiliar.com",
    Deno.env.get("VAPID_PUBLICA")!,
    Deno.env.get("VAPID_PRIVADA")!,
  );
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data } = await db
    .from("avisos")
    .select("*")
    .lte("vence", new Date().toISOString())
    .limit(20);

  for (const a of data ?? []) {
    // se borra antes de mandar: mejor un aviso perdido que uno repetido
    await db.from("avisos").delete().eq("id", a.id);
    try {
      await webpush.sendNotification(
        a.sub,
        JSON.stringify({ titulo: a.titulo, cuerpo: a.cuerpo }),
      );
    } catch (_e) {
      // la suscripción ya no vale (app desinstalada, permiso quitado): se ignora
    }
  }

  // limpieza de huérfanos: avisos de hace más de una hora que nadie reclamó
  await db
    .from("avisos")
    .delete()
    .lt("creado", new Date(Date.now() - 3_600_000).toISOString());

  return new Response("ok");
});
