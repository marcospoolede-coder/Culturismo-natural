#!/usr/bin/env python3
"""Convierte las imágenes generadas por la IA al formato y peso de la app.

Uso:  python3 scripts/optimiza_imagenes.py <carpeta_con_las_imagenes>

Acepta PNG, JPG o WebP con el nombre de IMAGENES.md (creatina.png, c1.jpg...).
Recorta al formato, reduce al tamaño de la app y guarda en img/<grupo>/ en WebP
(la de compartir en JPG). Baja la calidad hasta quedar por debajo del peso máximo.
No borra nada: los originales se quedan donde estaban.
"""
import re
import sys
from pathlib import Path
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
G = {  # grupo: (carpeta, ancho, alto, KB máximos, nombres)
    "sup":        ("img/sup",        960, 540, 60, "creatina proteina_polvo magnesio fuerza_opcionales"),
    "com":        ("img/com",        512, 512, 30, "desayuno media comida merienda cena"),
    "guia":       ("img/guia",       960, 540, 60, "proteina_comida base volumen mas_peso fuerza descarga"),
    "bloques":    ("img/bloques",    960, 540, 60, "c1 c2 c3 c4 c5 c6 f fin"),
    "bienvenida": ("img/bienvenida", 800, 1000, 70, "1 2 3 4 5 6 7"),
    "vacio":      ("img/vacio",      512, 512, 30, "sesiones marcas comidas"),
    "logros":     ("img/logros",     256, 256, 15, "s1 w1 w4 w12 w24 s25 s50 s100 ciclo pr pico "
                                                   "f_c1 f_c2 f_c3 f_c4 f_c5 f_c6 f_f f_fin"),
    "compartir":  ("img",           1200, 630, 150, "compartir"),
}
DESTINO = {n: (k,) + v[:4] for k, v in G.items() for n in v[4].split()}


def recorta(im, w, h):
    """Recorte centrado al formato y reducción con buen filtro."""
    r, R = w / h, im.width / im.height
    if R > r:
        nw = round(im.height * r); x = (im.width - nw) // 2
        im = im.crop((x, 0, x + nw, im.height))
    elif R < r:
        nh = round(im.width / r); y = (im.height - nh) // 2
        im = im.crop((0, y, im.width, y + nh))
    return im.resize((w, h), Image.LANCZOS)


def guarda(im, ruta, kb, jpg):
    for q in range(82, 39, -6):
        if jpg:
            im.save(ruta, "JPEG", quality=q, optimize=True, progressive=True)
        else:
            im.save(ruta, "WEBP", quality=q, method=6)
        if ruta.stat().st_size <= kb * 1024:
            break
    return q, ruta.stat().st_size / 1024


def main(carpeta):
    hechas, raras = 0, []
    for f in sorted(Path(carpeta).expanduser().iterdir()):
        if f.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
            continue
        nombre = re.sub(r"^\d+-", "", f.stem.lower())  # "02-magnesio" -> "magnesio"
        d = DESTINO.get(nombre)
        if not d:
            raras.append(f.name); continue
        try:
            im = Image.open(f).convert("RGB")
        except Exception:
            raras.append(f.name + " (no es una imagen)"); continue
        grupo, sub, w, h, kb = d
        jpg = grupo == "compartir"
        out = RAIZ / sub / (nombre + (".jpg" if jpg else ".webp"))
        out.parent.mkdir(parents=True, exist_ok=True)
        if grupo == "logros":  # la moneda sale pequeña: se recorta el centro para agrandarla
            c = round(min(im.size) * 0.62)
            x, y = (im.width - c) // 2, (im.height - c) // 2
            im = im.crop((x, y, x + c, y + c))
        im = recorta(im, w, h)
        q, peso = guarda(im, out, kb, jpg)
        aviso = "" if peso <= kb else "  (pasa del máximo, simplifica la imagen)"
        print(f"{f.name:28} -> {out.relative_to(RAIZ)}  {w}x{h}  q{q}  {peso:.0f} KB{aviso}")
        hechas += 1
    print(f"\n{hechas} convertidas.")
    if raras:
        print("Sin destino (revisa el nombre):", ", ".join(raras))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
