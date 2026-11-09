// Edge Function "salud": recibe lo que manda el atajo de Apple Salud del iPhone.
// Safari no puede leer Salud; el atajo si, y lo envia aqui.
//
// Se crea en el panel de Supabase (Edge Functions, Deploy a new function,
// via Editor) con el nombre exacto "salud" y "Verify JWT" DESACTIVADO: el atajo
// no tiene sesion, se identifica con el codigo personal que da la app.
//
// El atajo hace un POST con JSON plano (las listas anidadas fallan en Atajos):
//   cabecera  x-codigo: <codigo de la app>
//   cuerpo    { "hoy_activa": 420, "hoy_basal": 1650, "ayer_activa": 610,
//               "ayer_basal": 1660, "peso": 70.4, "hoy_pasos": 8200 }
// Todo es opcional menos el codigo. Acepta numeros con coma ("1.650,5 kcal").
// Las fechas las pone el servidor en hora de Madrid, o la del campo "zona".

import { createClient } from "npm:@supabase/supabase-js@2";

const responde = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

// "1.650,5 kcal" -> 1650.5 ; "70,4" -> 70.4 ; "1650.5" -> 1650.5
function numero(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function fechaEn(zona: string, diasAtras: number) {
  const d = new Date(Date.now() - diasAtras * 24 * 3600 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responde({ error: "metodo" }, 405);
  // deno-lint-ignore no-explicit-any
  let b: any = {};
  try { b = await req.json(); } catch (_e) { return responde({ error: "json" }, 400); }

  const codigo = (req.headers.get("x-codigo") ?? b.codigo ?? "").toString().trim();
  if (codigo.length < 20) return responde({ error: "codigo" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: i } = await db.from("integraciones").select("user_id")
    .eq("proveedor", "apple").eq("token", codigo).maybeSingle();
  if (!i) return responde({ error: "codigo" }, 401);
  const uid = i.user_id;

  let zona = "Europe/Madrid";
  try { if (b.zona) { fechaEn(String(b.zona), 0); zona = String(b.zona); } } catch (_e) { /* zona no valida */ }

  const filas = [];
  for (const [pre, atras] of [["hoy", 0], ["ayer", 1]] as const) {
    const activa = numero(b[pre + "_activa"]);
    const basal = numero(b[pre + "_basal"]);
    const pasos = numero(b[pre + "_pasos"]);
    if (activa === null && basal === null && pasos === null) continue;
    filas.push({
      user_id: uid,
      fecha: fechaEn(zona, atras),
      fuente: "apple",
      activa: activa === null ? null : Math.round(activa),
      basal: basal === null ? null : Math.round(basal),
      total: activa !== null && basal !== null ? Math.round(activa + basal) : null,
      pasos: pasos === null ? null : Math.round(pasos),
      parcial: pre === "hoy",
      actualizado: new Date().toISOString(),
    });
  }
  if (filas.length) {
    const { error } = await db.from("gasto_diario").upsert(filas, { onConflict: "user_id,fecha,fuente" });
    if (error) return responde({ error: "guardar" }, 500);
  }

  const peso = numero(b.peso);
  if (peso !== null && peso >= 25 && peso <= 300) {
    await db.from("peso_corporal").upsert(
      { user_id: uid, fecha: fechaEn(zona, 0), kg: Math.round(peso * 10) / 10, fuente: "apple" },
      { onConflict: "user_id,fecha" },
    );
  }

  await db.from("integraciones").update({ ultima_sync: new Date().toISOString(), detalle: "recibiendo datos" })
    .eq("user_id", uid).eq("proveedor", "apple");

  return responde({ ok: true, dias: filas.length, peso: peso !== null });
});
