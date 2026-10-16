import { AnimatedSprite, Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { DECOR } from './decor.js';
import { NPC_INFO } from './npcs.js';

export const SCALE = 2;

// Un mapa cargado: capa 1 (tiles) como sprites + capa 2 (colisión, salidas, spawns, npcs) como datos.
export async function loadMap(name) {
  const map = await (await fetch(`/maps/${name}.json`)).json();
  const T = map.tileSize;
  // Colisión por cuartos de casilla: máscara de 4 bits (1 arriba-izq, 2 arriba-der, 4 abajo-izq, 8 abajo-der).
  // Los mapas antiguos (sin collisionVersion) usaban 1 = casilla completa.
  if (!map.collisionVersion) map.collision = map.collision.map((v) => (v ? 15 : 0));

  const frames = new Map(); // gid -> Texture
  for (const ts of map.tilesets) {
    const tex = await Assets.load(ts.image);
    tex.source.scaleMode = 'nearest';
    for (let i = 0; i < ts.tilecount; i++) {
      const frame = new Rectangle((i % ts.columns) * T, Math.floor(i / ts.columns) * T, T, T);
      frames.set(ts.firstgid + i, new Texture({ source: tex.source, frame }));
    }
  }

  // Capas 1 y 2 van debajo de jugador/NPCs; la 3 (`over`) se dibuja encima.
  const buildLayer = (data) => {
    const c = new Container();
    (data ?? []).forEach((gid, i) => {
      const tex = frames.get(gid);
      if (!tex) return;
      const s = new Sprite(tex);
      s.position.set((i % map.width) * T, Math.floor(i / map.width) * T);
      c.addChild(s);
    });
    return c;
  };
  const view = new Container();
  view.addChild(buildLayer(map.layer1), buildLayer(map.layer2));
  const over = buildLayer(map.layer3);

  // Decoración animada (va con la capa 3, encima de jugador y NPCs) + sus casillas con colisión
  const decorSolid = new Set();
  for (const d of map.decor ?? []) {
    const def = DECOR[d.type];
    if (!def) continue;
    const tex = await Assets.load(def.image);
    tex.source.scaleMode = 'nearest';
    const anim = new AnimatedSprite(Array.from({ length: def.frames }, (_, i) =>
      new Texture({ source: tex.source, frame: new Rectangle(i * def.frameW, 0, def.frameW, def.frameH) })));
    anim.animationSpeed = def.fps / 60;
    anim.position.set(d.x * T, d.y * T);
    anim.play();
    over.addChild(anim);
    for (const [dx, dy] of d.solid ?? []) decorSolid.add(`${d.x + dx},${d.y + dy}`);
  }

  const npcs = map.npcs.map((n) => ({ ...n, ...NPC_INFO[n.id] }));
  const spawn = (n) => map.spawns.find((s) => s.name === n) ?? map.spawns[0] ?? { x: 1, y: 1 };

  return {
    map,
    view,
    over,
    npcs,
    spawn,
    exitById: (id) => map.exits.find((e) => e.id === id),
    exitAt: (tx, ty) => map.exits.find((e) => e.x === tx && e.y === ty),
    // ¿es sólido el píxel (px, py) del mapa?
    solidAt(px, py) {
      const tx = Math.floor(px / T), ty = Math.floor(py / T);
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return true;
      if (decorSolid.has(`${tx},${ty}`) || npcs.some((n) => n.x === tx && n.y === ty)) return true;
      const mask = map.collision[ty * map.width + tx];
      if (!mask) return false;
      const right = px - tx * T >= T / 2 ? 1 : 0, bottom = py - ty * T >= T / 2 ? 1 : 0;
      return (mask & (1 << (bottom * 2 + right))) !== 0;
    },
  };
}
