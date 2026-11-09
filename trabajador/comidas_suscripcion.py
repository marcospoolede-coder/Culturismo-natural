#!/usr/bin/env python3
"""Trabajador del Mac: analiza las fotos y descripciones de comida del plan
"propio" con la suscripcion de Claude (Claude Code en modo print), sin API.

Lo lanza launchd cada minuto (com.cuaderno.comidas.plist). Cada vuelta:
  1. busca comidas en estado pendiente de las personas con plan "propio";
  2. baja la foto a una carpeta temporal;
  3. le pide a Claude Code el calculo con salida JSON estructurada;
  4. guarda el resultado en Supabase.

Configuracion en ~/.config/cuaderno/servicio.json (fuera del repo):
  {"url": "https://<proyecto>.supabase.co", "service_key": "..."}

Si la suscripcion llega a su limite de uso, la comida se queda pendiente y
se reintenta en la siguiente vuelta.

Las instrucciones y el esquema son copia de supabase/functions/analiza-comida:
si cambias algo alli, cambialo aqui tambien.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

CONF = os.path.expanduser("~/.config/cuaderno/servicio.json")
CLAUDE = os.path.expanduser("~/.local/bin/claude")
LOG = os.path.expanduser("~/Library/Logs/cuaderno_comidas.log")
MAX_POR_VUELTA = 4

INSTRUCCIONES = """Eres un nutricionista deportivo que calcula lo que hay en un plato para una app de entrenamiento de fuerza.
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

Si la foto no es comida, devuelve items vacío, total a cero, confianza baja y explícalo en nota."""

ITEM = {
    "type": "object",
    "properties": {k: {"type": "integer"} for k in ("gramos", "kcal", "prot", "carb", "grasa")},
    "required": ["nombre", "gramos", "kcal", "prot", "carb", "grasa"],
    "additionalProperties": False,
}
ITEM["properties"]["nombre"] = {"type": "string"}
ESQUEMA = {
    "type": "object",
    "properties": {
        "items": {"type": "array", "items": ITEM},
        "total": {
            "type": "object",
            "properties": {k: {"type": "integer"} for k in ("kcal", "prot", "carb", "grasa")},
            "required": ["kcal", "prot", "carb", "grasa"],
            "additionalProperties": False,
        },
        "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
        "pregunta": {"type": "string"},
        "nota": {"type": "string"},
    },
    "required": ["items", "total", "confianza", "pregunta", "nota"],
    "additionalProperties": False,
}


def log(*a):
    with open(LOG, "a") as f:
        f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a) + "\n")


def conf():
    with open(CONF) as f:
        return json.load(f)


def pide(c, metodo, ruta, cuerpo=None, crudo=False, cabeceras=None):
    h = {"apikey": c["service_key"], "Authorization": "Bearer " + c["service_key"]}
    datos = None
    if cuerpo is not None:
        datos = json.dumps(cuerpo).encode()
        h["Content-Type"] = "application/json"
        h["Prefer"] = "return=minimal"
    h.update(cabeceras or {})
    req = urllib.request.Request(c["url"] + ruta, data=datos, method=metodo, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        b = r.read()
        if crudo:
            return b, r.headers.get("Content-Type", "")
        return json.loads(b) if b else None


def normaliza(r):
    items = r.get("items") or []
    suma = lambda k: sum(int(i.get(k) or 0) for i in items)
    t = r.get("total") or {}
    return {
        "items": items,
        "kcal": suma("kcal") if items else int(t.get("kcal") or 0),
        "prot": suma("prot") if items else int(t.get("prot") or 0),
        "carb": suma("carb") if items else int(t.get("carb") or 0),
        "grasa": suma("grasa") if items else int(t.get("grasa") or 0),
        "confianza": r.get("confianza"),
        "pregunta": r.get("pregunta") or None,
        "nota": r.get("nota") or None,
    }


def analiza(c, comida, carpeta):
    partes = []
    if comida.get("foto"):
        ruta = "/storage/v1/object/comidas/" + urllib.parse.quote(comida["foto"])
        datos, tipo = pide(c, "GET", ruta, crudo=True)
        ext = ".png" if "png" in tipo else ".webp" if "webp" in tipo else ".jpg"
        archivo = os.path.join(carpeta, "comida" + ext)
        with open(archivo, "wb") as f:
            f.write(datos)
        partes.append("Mira la foto de la comida en " + archivo + " con la herramienta Read.")
    if comida.get("descripcion"):
        partes.append("Lo que dice la persona sobre esta comida: " + comida["descripcion"])
    elif comida.get("foto"):
        partes.append("La persona no ha escrito nada: calcula solo con la foto.")
    partes.append("Responde solo con el JSON del esquema.")

    orden = [CLAUDE, "-p", "\n\n".join(partes),
             "--output-format", "json",
             "--json-schema", json.dumps(ESQUEMA),
             "--append-system-prompt", INSTRUCCIONES,
             "--allowedTools", "Read",
             "--add-dir", carpeta,
             "--max-turns", "4"]
    p = subprocess.run(orden, capture_output=True, text=True, timeout=240, cwd=carpeta)
    salida = (p.stdout or "") + (p.stderr or "")
    try:
        r = json.loads(p.stdout)
    except ValueError:
        r = None
    if not r or r.get("is_error") or p.returncode != 0:
        texto = (r or {}).get("result") or salida
        if "limit" in texto.lower():
            return "limite", texto[:200]
        return "error", texto[:300]
    estructurado = r.get("structured_output")
    if estructurado is None:
        try:
            estructurado = json.loads(r.get("result") or "")
        except ValueError:
            return "error", "sin JSON: " + (r.get("result") or "")[:200]
    return "ok", normaliza(estructurado)


def vuelta():
    c = conf()
    propios = pide(c, "GET", "/rest/v1/acceso?plan=eq.propio&estado=eq.aprobado&select=user_id") or []
    if not propios:
        return
    ids = ",".join(p["user_id"] for p in propios)
    # tambien recoge las que se quedaron "analizando" mas de diez minutos (Mac dormido a medias)
    hace = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 600))
    q = ("/rest/v1/comidas?select=*&user_id=in.(" + ids + ")"
         "&or=(estado.eq.pendiente,and(estado.eq.analizando,creado.lt." + hace + "))"
         "&origen=neq.manual&order=creado.asc&limit=" + str(MAX_POR_VUELTA))
    pendientes = pide(c, "GET", q) or []
    for comida in pendientes:
        filtro = "/rest/v1/comidas?id=eq." + comida["id"]
        pide(c, "PATCH", filtro, {"estado": "analizando", "via": "suscripcion"})
        with tempfile.TemporaryDirectory(prefix="cuaderno_") as carpeta:
            try:
                estado, res = analiza(c, comida, carpeta)
            except Exception as e:  # red, tiempo agotado...
                estado, res = "error", str(e)[:300]
        if estado == "ok":
            res.update({"estado": "hecha", "analizado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
            pide(c, "PATCH", filtro, res)
            log("hecha", comida["id"], res["kcal"], "kcal")
        elif estado == "limite":
            pide(c, "PATCH", filtro, {"estado": "pendiente",
                                      "nota": "La suscripción de Claude está en su límite. Sale sola en cuanto se libere."})
            log("limite", comida["id"], res)
            return
        else:
            pide(c, "PATCH", filtro, {"estado": "error",
                                      "nota": "No se pudo calcular. Apúntala a mano o vuelve a enviarla."})
            log("error", comida["id"], res)


if __name__ == "__main__":
    try:
        vuelta()
    except urllib.error.URLError as e:
        log("sin red", e)
    except FileNotFoundError:
        log("falta", CONF)
        sys.exit(1)
