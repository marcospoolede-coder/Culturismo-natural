// Edge Function "analiza-comida": calcula las calorias de una comida a partir
// de una foto o de una descripcion, con la API de Claude. Solo para el plan
// "pago". El plan "propio" (Marcos) no pasa por aqui: lo analiza su Mac con su
// suscripcion (trabajador/comidas_suscripcion.py).
//
// Se crea en el panel de Supabase (Edge Functions, Deploy a new function,
// via Editor) con el nombre exacto "analiza-comida" y "Verify JWT" ACTIVADO.
// Secretos en Edge Functions, Secrets:
//   ANTHROPIC_API_KEY  la clave de la API. Mientras no exista, la funcion
//                      contesta "sin_clave" y la app lo explica.
//   MODELO_COMIDA      opcional. Por defecto claude-opus-5-5.
//   TOPE_DIARIO        opcional. Fotos al dia por persona. Por defecto 15.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

// Las instrucciones y el esquema estan copiados en trabajador/comidas_suscripcion.py:
// si cambias algo aqui, cambialo alli tambien.

const INSTRUCCIONES = `Eres un nutricionista deportivo que calcula lo que hay en un plato para una app de entrenamiento de fuerza.
Te llega una foto de una comida, una descripcion o las dos.

Como calcular:
- Separa cada alimento visible y estima sus gramos por el tamaño del plato, los cubiertos y la mano si salen.
- Si la persona da cantidades ("200 g de pollo", "3 huevos"), mandan sobre lo que veas.
- Cuenta el aceite y las salsas aunque no se vean: un salteado o una ensalada aliñada suelen llevar 10 a 15 g de aceite. Si no lo sabes, ponlo como alimento aparte y pregúntalo.
- Usa valores de alimentos cocinados cuando lo estén (arroz y pasta cocidos, pollo a la plancha).
- Redondea: gramos a 5, kcal a 10, macros a gramo entero.

Qué devolver:
- items: cada alimento con nombre corto en español, gramos, kcal, proteína, hidratos y grasa.
- total: la suma de los items.
- confianza: alta si la foto es clara y hay cantidades, media si hay que estimar porciones, baja si apenas se ve.
- pregunta: una sola pregunta corta que más cambiaría el cálculo (casi siempre el aceite o la cantidad del alimento principal). Vacía si no hace falta.
- nota: una frase útil para alguien que quiere ganar músculo (por ejemplo, si la proteína se queda corta). Vacía si no aporta.

Si la foto no es comida, devuelve items vacío, total a cero, confianza baja y explícalo en nota.`;

const item = {
  type: "object",
  properties: {
    nombre: { type: "string" },
    gramos: { type: "integer" },
    kcal: { type: "integer" },
    prot: { type: "integer" },
    carb: { type: "integer" },
    grasa: { type: "integer" },
  },
  required: ["nombre", "gramos", "kcal", "prot", "carb", "grasa"],
  additionalProperties: false,
};

const ESQUEMA = {
  type: "object",
  properties: {
    items: { type: "array", items: item },
    total: {
      type: "object",
      properties: {
        kcal: { type: "integer" },
        prot: { type: "integer" },
        carb: { type: "integer" },
        grasa: { type: "integer" },
      },
      required: ["kcal", "prot", "carb", "grasa"],
      additionalProperties: false,
    },
    confianza: { type: "string", enum: ["alta", "media", "baja"] },
    pregunta: { type: "string" },
    nota: { type: "string" },
  },
  required: ["items", "total", "confianza", "pregunta", "nota"],
  additionalProperties: false,
};

// Pasa la respuesta de Claude a columnas de la tabla comidas.
// El total se recalcula con los items para que cuadre siempre.
// deno-lint-ignore no-explicit-any
function normaliza(r: any) {
  const items = Array.isArray(r?.items) ? r.items : [];
  const suma = (k: string) =>
    items.reduce((s: number, i: Record<string, number>) => s + (Number(i[k]) || 0), 0);
  const hay = items.length > 0;
  return {
    items,
    kcal: hay ? suma("kcal") : Number(r?.total?.kcal) || 0,
    prot: hay ? suma("prot") : Number(r?.total?.prot) || 0,
    carb: hay ? suma("carb") : Number(r?.total?.carb) || 0,
    grasa: hay ? suma("grasa") : Number(r?.total?.grasa) || 0,
    confianza: r?.confianza ?? null,
    pregunta: r?.pregunta || null,
    nota: r?.nota || null,
  };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responde = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responde({ error: "metodo" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: u, error: eu } = await db.auth.getUser(jwt);
  if (eu || !u?.user) return responde({ error: "sesion" }, 401);
  const uid = u.user.id;

  const { data: acc } = await db.from("acceso").select("estado, plan")
    .eq("user_id", uid).maybeSingle();
  if (!acc || acc.estado !== "aprobado") return responde({ error: "sin_acceso" }, 403);
  if (acc.plan !== "pago") return responde({ error: "no_pago" }, 403);

  const clave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!clave) return responde({ error: "sin_clave" }, 503);

  let id = "";
  try { id = (await req.json()).id; } catch (_e) { /* cuerpo vacio */ }
  if (!id) return responde({ error: "falta_id" }, 400);

  const { data: c } = await db.from("comidas").select("*")
    .eq("id", id).eq("user_id", uid).maybeSingle();
  if (!c) return responde({ error: "no_existe" }, 404);
  if (c.origen === "manual") return responde({ error: "manual" }, 400);

  // tope diario por persona, para que una cuenta no se coma la factura
  const tope = Number(Deno.env.get("TOPE_DIARIO") ?? "15");
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db.from("comidas").select("id", { count: "exact", head: true })
    .eq("user_id", uid).eq("via", "api").gte("analizado", desde);
  if ((count ?? 0) >= tope) return responde({ error: "tope", tope }, 429);

  await db.from("comidas").update({ estado: "analizando", via: "api" }).eq("id", id);

  // lo que se le manda a Claude: la foto si la hay y lo que haya escrito la persona
  const contenido: Anthropic.ContentBlockParam[] = [];
  if (c.foto) {
    const { data: blob, error: ef } = await db.storage.from("comidas").download(c.foto);
    if (ef || !blob) {
      await db.from("comidas").update({ estado: "error", nota: "No se pudo leer la foto." }).eq("id", id);
      return responde({ error: "foto" }, 500);
    }
    const tipo = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
    contenido.push({
      type: "image",
      source: {
        type: "base64",
        media_type: tipo as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        data: encodeBase64(new Uint8Array(await blob.arrayBuffer())),
      },
    });
  }
  contenido.push({
    type: "text",
    text: c.descripcion
      ? "Lo que dice la persona sobre esta comida: " + c.descripcion
      : "La persona no ha escrito nada: calcula solo con la foto.",
  });

  const claude = new Anthropic({ apiKey: clave });
  try {
    const r = await claude.messages.create({
      model: Deno.env.get("MODELO_COMIDA") ?? "claude-opus-5-5",
      max_tokens: 8000,
      system: INSTRUCCIONES,
      output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
      messages: [{ role: "user", content: contenido }],
    });
    if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") {
      throw new Error("sin respuesta util: " + r.stop_reason);
    }
    const texto = r.content.find((b) => b.type === "text");
    if (!texto || texto.type !== "text") throw new Error("sin texto");
    const fila = { ...normaliza(JSON.parse(texto.text)), estado: "hecha", via: "api",
                   analizado: new Date().toISOString() };
    const { data: hecha } = await db.from("comidas").update(fila).eq("id", id).select().single();
    return responde({ comida: hecha });
  } catch (e) {
    let nota = "No se pudo calcular. Apúntala a mano o prueba otra vez.";
    if (e instanceof Anthropic.RateLimitError) nota = "Hay mucha cola. Prueba en un minuto.";
    if (e instanceof Anthropic.AuthenticationError) nota = "La clave de la IA no vale. Avisa a Marcos.";
    await db.from("comidas").update({ estado: "error", nota }).eq("id", id);
    console.error(e);
    return responde({ error: "claude", nota }, 502);
  }
});
