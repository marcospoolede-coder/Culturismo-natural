// Edge Function "whoop": conecta la cuenta de WHOOP y trae el gasto de cada dia.
//
// Se crea en el panel de Supabase (Edge Functions, Deploy a new function,
// via Editor) con el nombre exacto "whoop" y "Verify JWT" DESACTIVADO: la
// vuelta de WHOOP llega desde el navegador sin sesion. La funcion comprueba
// ella misma la sesion en las rutas que la necesitan.
//
// Rutas:
//   POST /whoop/inicio      (con sesion) devuelve la URL de WHOOP para dar permiso
//   GET  /whoop/vuelta      WHOOP vuelve aqui con el codigo; guarda los tokens
//   POST /whoop/sincroniza  (con sesion) trae los ultimos dias
//   POST /whoop/todos       (cabecera x-reloj = RELOJ_WHOOP) sincroniza a todos; para un cron
//
// Secretos en Edge Functions, Secrets:
//   WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET  de developer-dashboard.whoop.com
//   APP_URL       opcional, a donde se vuelve al terminar
//   RELOJ_WHOOP   opcional, clave para la ruta /todos
// En el panel de WHOOP, Redirect URL exacta:
//   https://ocrmaythsawmuotoqvzr.supabase.co/functions/v1/whoop/vuelta
//
// Condiciones de WHOOP: no se guardan copias largas. Solo el total de kcal
// por dia y solo 30 dias (lo borra el cron limpia-whoop de nutricion.sql).

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const AUTH = "https://api.prod.whoop.com/oauth/oauth2/auth";
const TOKEN = "https://api.prod.whoop.com/oauth/oauth2/token";
const API = "https://api.prod.whoop.com/developer";
const SCOPES = "offline read:cycles";
const DIAS = 7;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const responde = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// trim: al pegar una clave en el panel se cuela a veces un salto de linea al final
// y WHOOP la rechaza con invalid_client
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const vuelta = () => env("SUPABASE_URL") + "/functions/v1/whoop/vuelta";
const appUrl = () => env("APP_URL") || "https://marcospoolede-coder.github.io/Culturismo-natural/";

function servicio() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
}

async function usuario(db: SupabaseClient, req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: acc } = await db.from("acceso").select("estado").eq("user_id", data.user.id).maybeSingle();
  return acc && acc.estado === "aprobado" ? data.user.id : null;
}

// la doc de WHOOP pide un state de ocho caracteres
function estadoAleatorio() {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => abc[x % abc.length]).join("");
}

async function pideToken(form: Record<string, string>) {
  const r = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("WHOOP_CLIENT_ID"),
      client_secret: env("WHOOP_CLIENT_SECRET"),
      ...form,
    }),
  });
  if (!r.ok) throw new Error("token " + r.status + " " + (await r.text()));
  return await r.json() as { access_token: string; refresh_token: string; expires_in: number };
}

// Token valido para un usuario. WHOOP rota el refresh token y falla si se
// refresca dos veces a la vez, asi que se bloquea la fila mientras tanto.
async function tokenValido(db: SupabaseClient, uid: string): Promise<string | null> {
  const { data: t } = await db.from("whoop_tokens").select("*").eq("user_id", uid).maybeSingle();
  if (!t) return null;
  if (new Date(t.expira).getTime() > Date.now() + 5 * 60 * 1000) return t.access;

  const hace = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: mio } = await db.from("whoop_tokens")
    .update({ bloqueo: new Date().toISOString() })
    .eq("user_id", uid).or(`bloqueo.is.null,bloqueo.lt.${hace}`).select("user_id");
  if (!mio || mio.length === 0) return null; // otro refresco en marcha

  try {
    const n = await pideToken({ grant_type: "refresh_token", refresh_token: t.refresh, scope: "offline" });
    await db.from("whoop_tokens").update({
      access: n.access_token,
      refresh: n.refresh_token,
      expira: new Date(Date.now() + n.expires_in * 1000).toISOString(),
      bloqueo: null,
    }).eq("user_id", uid);
    return n.access_token;
  } catch (e) {
    await db.from("whoop_tokens").update({ bloqueo: null }).eq("user_id", uid);
    await db.from("integraciones").update({ detalle: "WHOOP ha cortado el permiso. Vuelve a conectar." })
      .eq("user_id", uid).eq("proveedor", "whoop");
    console.error(e);
    return null;
  }
}

// Fecha del dia al que pertenece un ciclo. El ciclo de WHOOP va de dormirse a
// dormirse: empieza la noche anterior, asi que se le suman seis horas.
function fechaCiclo(inicio: string, offset: string | null) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset ?? "");
  const min = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 60;
  const local = new Date(new Date(inicio).getTime() + (min + 6 * 60) * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

async function sincroniza(db: SupabaseClient, uid: string) {
  const access = await tokenValido(db, uid);
  if (!access) return { ok: false, motivo: "token" };

  const desde = new Date(Date.now() - (DIAS + 1) * 24 * 3600 * 1000).toISOString();
  const r = await fetch(`${API}/v2/cycle?limit=25&start=${encodeURIComponent(desde)}`, {
    headers: { Authorization: "Bearer " + access },
  });
  if (r.status === 401) return { ok: false, motivo: "token" };
  if (!r.ok) return { ok: false, motivo: "whoop " + r.status };
  const { records } = await r.json() as {
    records: Array<{ start: string; end?: string | null; timezone_offset?: string; score_state: string;
                     score?: { kilojoule?: number }; step_count?: number | null }>;
  };

  const filas = (records ?? [])
    .filter((c) => c.score_state === "SCORED" && c.score && typeof c.score.kilojoule === "number")
    .map((c) => ({
      user_id: uid,
      fecha: fechaCiclo(c.start, c.timezone_offset ?? null),
      fuente: "whoop",
      total: Math.round((c.score!.kilojoule as number) / 4.184),
      pasos: c.step_count ?? null,
      parcial: !c.end,
      actualizado: new Date().toISOString(),
    }));
  // si dos ciclos caen el mismo dia, manda el mas largo (el ultimo leido es el mas antiguo)
  const porDia = new Map<string, typeof filas[number]>();
  for (const f of filas) {
    const ya = porDia.get(f.fecha);
    if (!ya || (ya.parcial && !f.parcial) || (ya.parcial === f.parcial && f.total > ya.total)) porDia.set(f.fecha, f);
  }
  if (porDia.size) {
    await db.from("gasto_diario").upsert([...porDia.values()], { onConflict: "user_id,fecha,fuente" });
  }

  await db.from("integraciones").update({ ultima_sync: new Date().toISOString(), detalle: "conectado" })
    .eq("user_id", uid).eq("proveedor", "whoop");
  return { ok: true, dias: porDia.size };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const ruta = url.pathname.split("/").filter(Boolean).pop();
  const db = servicio();

  if (!env("WHOOP_CLIENT_ID") || !env("WHOOP_CLIENT_SECRET")) {
    if (ruta === "vuelta") return Response.redirect(appUrl() + "?whoop=sin-configurar", 302);
    return responde({ error: "sin_configurar" }, 503);
  }

  if (ruta === "inicio") {
    const uid = await usuario(db, req);
    if (!uid) return responde({ error: "sesion" }, 401);
    const estado = estadoAleatorio();
    await db.from("whoop_estados").insert({ estado, user_id: uid });
    const u = new URL(AUTH);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", env("WHOOP_CLIENT_ID"));
    u.searchParams.set("redirect_uri", vuelta());
    u.searchParams.set("scope", SCOPES);
    u.searchParams.set("state", estado);
    return responde({ url: u.toString() });
  }

  if (ruta === "vuelta") {
    const code = url.searchParams.get("code");
    const estado = url.searchParams.get("state") ?? "";
    if (!code) return Response.redirect(appUrl() + "?whoop=cancelado", 302);
    const { data: e } = await db.from("whoop_estados").delete().eq("estado", estado).select("user_id, creado");
    const fila = e && e[0];
    if (!fila || Date.now() - new Date(fila.creado).getTime() > 15 * 60 * 1000) {
      return Response.redirect(appUrl() + "?whoop=caducado", 302);
    }
    try {
      const t = await pideToken({ grant_type: "authorization_code", code, redirect_uri: vuelta() });
      let whoopId: number | null = null;
      const p = await fetch(`${API}/v2/user/profile/basic`, { headers: { Authorization: "Bearer " + t.access_token } });
      if (p.ok) whoopId = (await p.json()).user_id ?? null;
      await db.from("whoop_tokens").upsert({
        user_id: fila.user_id, whoop_id: whoopId, access: t.access_token, refresh: t.refresh_token,
        expira: new Date(Date.now() + t.expires_in * 1000).toISOString(), bloqueo: null,
      });
      await db.from("integraciones").upsert({ user_id: fila.user_id, proveedor: "whoop", detalle: "conectado" },
        { onConflict: "user_id,proveedor" });
      await sincroniza(db, fila.user_id);
      return Response.redirect(appUrl() + "?whoop=ok", 302);
    } catch (err) {
      console.error(err);
      return Response.redirect(appUrl() + "?whoop=error", 302);
    }
  }

  if (ruta === "sincroniza") {
    const uid = await usuario(db, req);
    if (!uid) return responde({ error: "sesion" }, 401);
    return responde(await sincroniza(db, uid));
  }

  if (ruta === "todos") {
    if (!env("RELOJ_WHOOP") || req.headers.get("x-reloj") !== env("RELOJ_WHOOP")) {
      return responde({ error: "no" }, 403);
    }
    const { data: ts } = await db.from("whoop_tokens").select("user_id");
    const res = [];
    for (const t of ts ?? []) res.push(await sincroniza(db, t.user_id));
    return responde({ usuarios: res.length });
  }

  return responde({ error: "ruta" }, 404);
});
