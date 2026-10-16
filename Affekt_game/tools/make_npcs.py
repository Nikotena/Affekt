#!/usr/bin/env python3
"""Genera los sprites de NPC (16x128: abajo, derecha, arriba, izquierda; frames de 16x32).

    python tools/make_npcs.py

Parte del diseno de Alan (public/character/alan.png, que a su vez sigue la silueta de
template.png) y lo recolorea por clases de pixel (pelo, piel, ropa...) con ajustes puntuales
(pluma, barba, pelo largo). Sobrescribe marta/guardia/elena/kael.png; alan.png no se toca.
"""
import os
from PIL import Image

DIR = os.path.join(os.path.dirname(__file__), "..", "public", "character")

# clases de color en alan.png
CLASS = {
    (41, 29, 24): "a", (73, 49, 36): "c",             # pelo oscuro / medio
    (158, 112, 68): "d", (209, 160, 103): "e",        # piel sombra / luz
    (79, 46, 136): "f", (60, 118, 196): "g",          # ropa sombra / luz
    (67, 46, 39): "h", (248, 248, 248): "i",          # cinturon / hebilla
    (85, 134, 185): "j", (101, 101, 155): "k",        # piernas
    (106, 72, 52): "m",                               # botas
}
LIGHT = {"d": (191, 167, 135), "e": (232, 212, 178)}  # tono de piel de template.png
TAN = {"d": (158, 112, 68), "e": (209, 160, 103)}
DARK = {"d": (112, 74, 48), "e": (150, 104, 70)}

NPCS = {
    "marta": dict(  # mercader: pelo caoba largo, vestido rosa
        pal={"a": (122, 48, 28), "c": (168, 78, 40), **LIGHT, "f": (150, 40, 110), "g": (205, 75, 155),
             "h": (240, 232, 212), "i": (255, 215, 90), "j": (150, 40, 110), "k": (120, 30, 90), "m": (90, 50, 40)},
        long_hair=True),
    "guardia": dict(  # armadura de acero, casco con penacho rojo
        pal={"a": (70, 78, 92), "c": (146, 156, 172), **TAN, "f": (92, 102, 118), "g": (152, 164, 180),
             "h": (60, 40, 30), "i": (232, 192, 60), "j": (70, 78, 92), "k": (58, 64, 78), "m": (48, 38, 34)},
        plume=(205, 50, 50)),
    "elena": dict(  # sanadora: tunica verde, pelo rubio largo
        pal={"a": (196, 184, 130), "c": (242, 228, 172), **LIGHT, "f": (30, 110, 80), "g": (72, 172, 122),
             "h": (240, 240, 230), "i": (255, 215, 90), "j": (40, 130, 95), "k": (30, 100, 75), "m": (110, 80, 60)},
        long_hair=True),
    "kael": dict(  # herrero: pelo rojo, barba, delantal de cuero
        pal={"a": (150, 50, 20), "c": (206, 88, 32), **DARK, "f": (84, 56, 40), "g": (128, 88, 58),
             "h": (36, 28, 24), "i": (186, 186, 196), "j": (70, 60, 60), "k": (54, 48, 50), "m": (38, 30, 28)},
        beard=True),
}

# (frame, x, y) pixeles extra, en coordenadas del frame de 16x32
BEARD = {0: [(x, y) for y in (16, 17) for x in range(4, 12)],
         1: [(x, y) for y in (16, 17) for x in range(8, 13)],
         3: [(x, y) for y in (16, 17) for x in range(3, 8)]}
PLUME = {0: [(7, 6), (8, 6)], 1: [(8, 6), (9, 6)], 2: [(7, 6), (8, 6)], 3: [(6, 6), (7, 6)]}
HAIR_SIDES = {0: [(2, y) for y in range(14, 18)] + [(13, y) for y in range(14, 18)],      # mechones junto a la cara
              1: [(x, y) for y in range(16, 20) for x in (4, 5)],                          # pelo por la espalda
              2: [(x, y) for y in (17, 18) for x in range(3, 13)],                         # pelo cubre la espalda
              3: [(x, y) for y in range(16, 20) for x in (10, 11)]}


def build(name, spec):
    src = Image.open(os.path.join(DIR, "alan.png")).convert("RGBA")
    out = Image.new("RGBA", src.size)
    sp, op = src.load(), out.load()
    pal = spec["pal"]
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = sp[x, y]
            k = CLASS.get((r, g, b)) if a == 255 else None
            op[x, y] = (*pal[k], 255) if k else (r, g, b, a)

    def paint(pixels, color):
        for f, pts in pixels.items():
            for x, y in pts:
                if 0 <= x < 16 and sp[x, f * 32 + y][3] == 255 or color is spec.get("plume"):
                    op[x, f * 32 + y] = (*color, 255)

    if spec.get("beard"):
        paint(BEARD, pal["a"])
    if spec.get("plume"):
        paint(PLUME, spec["plume"])
    if spec.get("long_hair"):
        # solo sustituye pixeles de piel o ropa; nunca contornos ni sombra
        for f, pts in HAIR_SIDES.items():
            for x, y in pts:
                if CLASS.get(tuple(sp[x, f * 32 + y][:3])) in ("d", "e", "f", "g", "h", "i"):
                    op[x, f * 32 + y] = (*pal["c"], 255)
    out.save(os.path.join(DIR, name + ".png"))


for n, s in NPCS.items():
    build(n, s)
print("ok:", ", ".join(NPCS))
