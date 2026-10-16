#!/usr/bin/env python3
"""Genera el tileset de ejemplo (public/tilesets/base.png) y el mapa public/maps/village.json.

    python tools/make_assets.py

Solo para arrancar: despues se edita todo desde /editor.html.
"""
import json
import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(__file__), "..", "public")
T = 16
COLS = 8


def png(path, w, h, px):
    raw = b"".join(b"\x00" + bytes(c for p in px[y * w:(y + 1) * w] for c in p) for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def tile(base, detail=None, fn=None):
    """16x16 de color `base`; `fn(x, y)` puede devolver otro color."""
    out = []
    for y in range(T):
        for x in range(T):
            c = fn(x, y) if fn else None
            out.append((c or base) + (255,))
    return out


G, G2 = (86, 150, 70), (74, 135, 60)
tiles = [
    tile(G, fn=lambda x, y: G2 if (x * 7 + y * 3) % 11 == 0 else None),                       # 1 hierba
    tile(G, fn=lambda x, y: (240, 220, 90) if (x, y) in ((4, 5), (11, 10)) else (G2 if (x + y) % 9 == 0 else None)),  # 2 flores
    tile((190, 160, 110), fn=lambda x, y: (170, 140, 95) if (x * 5 + y * 7) % 13 == 0 else None),     # 3 camino
    tile((60, 110, 200), fn=lambda x, y: (90, 140, 225) if (x + y * 2) % 8 < 2 else None),            # 4 agua
    tile(G, fn=lambda x, y: (40, 100, 45) if (x - 8) ** 2 + (y - 7) ** 2 < 36 else ((110, 70, 40) if 7 <= x <= 9 and y > 12 else None)),  # 5 arbol
    tile((200, 190, 170), fn=lambda x, y: (170, 160, 140) if y % 8 == 7 else None),                   # 6 pared
    tile((170, 60, 50), fn=lambda x, y: (140, 45, 40) if y % 5 == 4 else None),                       # 7 tejado
    tile((200, 190, 170), fn=lambda x, y: (110, 70, 40) if 3 <= x <= 12 and y >= 2 else None),        # 8 puerta
    tile((200, 190, 170), fn=lambda x, y: (140, 200, 235) if 4 <= x <= 11 and 3 <= y <= 10 else None),  # 9 ventana
    tile((120, 90, 60), fn=lambda x, y: (100, 72, 48) if x % 8 == 0 else None),                       # 10 suelo madera
    tile(G, fn=lambda x, y: (140, 100, 60) if y in (6, 7, 11, 12) or x in (1, 2) else None),          # 11 valla
    tile((140, 45, 40), fn=lambda x, y: (170, 60, 50) if y < 8 else None),                            # 12 tejado borde
]
tiles += [tile((0, 0, 0))] * 0
rows = (len(tiles) + COLS - 1) // COLS
sheet = [(0, 0, 0, 0)] * (COLS * T * rows * T)
for i, t in enumerate(tiles):
    ox, oy = (i % COLS) * T, (i // COLS) * T
    for y in range(T):
        for x in range(T):
            sheet[(oy + y) * COLS * T + ox + x] = t[y * T + x]

os.makedirs(os.path.join(ROOT, "tilesets"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "maps"), exist_ok=True)
png(os.path.join(ROOT, "tilesets", "base.png"), COLS * T, rows * T, sheet)

# ---- mapa: pueblo de 3 casas ------------------------------------------------
W, H = 30, 20
GRASS, FLOWER, PATH, WATER, TREE, WALL, ROOF, DOOR, WINDOW, FENCE = 1, 2, 3, 4, 5, 6, 7, 8, 9, 11
layer = [FLOWER if (x * 3 + y * 5) % 17 == 0 else GRASS for y in range(H) for x in range(W)]
coll = [0] * (W * H)


def put(x, y, gid, solid):
    layer[y * W + x] = gid
    coll[y * W + x] = 1 if solid else 0


for x in range(W):
    put(x, 0, TREE, True)
    put(x, H - 1, TREE, True)
for y in range(H):
    put(0, y, TREE, True)
    put(W - 1, y, TREE, True)
for x in range(1, W - 1):
    put(x, 11, PATH, False)
for hx in (4, 13, 22):
    for dx in range(5):
        put(hx + dx, 3, ROOF, True)
        put(hx + dx, 4, ROOF, True)
        put(hx + dx, 5, WINDOW if dx in (1, 3) else WALL, True)
        put(hx + dx, 6, DOOR if dx == 2 else WALL, dx != 2)
    for y in range(7, 11):
        put(hx + 2, y, PATH, False)
for x in range(21, 27):
    for y in range(14, 18):
        put(x, y, WATER, True)
for x in range(2, 8):
    put(x, 14, FENCE, True)

npcs = [("NPC_0", 8, 9), ("NPC_1", 17, 9), ("NPC_2", 25, 9), ("NPC_3", 10, 13), ("NPC_4", 18, 13)]
village = {
    "name": "village", "width": W, "height": H, "tileSize": T,
    "tilesets": [{"name": "base", "image": "/tilesets/base.png", "firstgid": 1, "columns": COLS, "tilecount": rows * COLS}],
    "layer1": layer, "collision": coll, "exits": [],
    "spawns": [{"name": "start", "x": 15, "y": 12}],
    "npcs": [{"id": i, "x": x, "y": y} for i, x, y in npcs],
}
with open(os.path.join(ROOT, "maps", "village.json"), "w") as f:
    json.dump(village, f)
print("ok")
