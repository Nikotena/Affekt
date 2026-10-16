import { NPC_INFO } from './npcs.js';
import { DECOR, footprint } from './decor.js';

const T = 16;
const $ = (id) => document.getElementById(id);
const canvas = $('map');
const ctx = canvas.getContext('2d');

let map = newMap('village', 30, 20);
const images = new Map(); // url -> HTMLImageElement
let layer = 'tiles';
let tileLayer = 1; // 1..3 (la 3 se dibuja sobre jugador y NPCs en el juego)
const LAYERS = ['layer1', 'layer2', 'layer3'];
const L = () => map[LAYERS[tileLayer - 1]];
let tool = { tiles: 'brush', objects: 'collision' };
let gid = 0; // tile seleccionado
let zoom = 3;
let painting = null; // 'draw' | 'erase'

function newMap(name, w, h) {
  return { name, width: w, height: h, tileSize: T, tilesets: [], layer1: Array(w * h).fill(0), layer2: Array(w * h).fill(0), layer3: Array(w * h).fill(0),
    collision: Array(w * h).fill(0), exits: [], decor: [], collisionVersion: 2, spawns: [{ name: 'start', x: 1, y: 1 }], npcs: [] };
}
const say = (t, err) => { $('msg').textContent = t; $('msg').style.color = err ? '#e0605a' : '#6dd3a0'; };

// ---------- imágenes / tilesets ----------
function loadImage(url) {
  if (images.has(url)) return Promise.resolve(images.get(url));
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { images.set(url, img); res(img); };
    img.onerror = () => rej(new Error('no se pudo cargar ' + url));
    img.src = url + '?t=' + Date.now();
  });
}

async function addTileset(file) {
  const url = `/tilesets/${file}`;
  if (map.tilesets.some((t) => t.image === url)) return say('That tileset is already in the map');
  const img = await loadImage(url);
  const columns = Math.max(1, Math.floor(img.width / T));
  const count = columns * Math.floor(img.height / T);
  const first = map.tilesets.reduce((m, t) => Math.max(m, t.firstgid + t.tilecount), 1);
  map.tilesets.push({ name: file.replace(/\.png$/, ''), image: url, firstgid: first, columns, tilecount: count });
  buildPalette();
}

function tileSource(g) {
  const ts = map.tilesets.find((t) => g >= t.firstgid && g < t.firstgid + t.tilecount);
  if (!ts) return null;
  const i = g - ts.firstgid;
  return { img: images.get(ts.image), sx: (i % ts.columns) * T, sy: Math.floor(i / ts.columns) * T };
}

function buildPalette() {
  const pal = $('pal');
  pal.innerHTML = '';
  for (const ts of map.tilesets) {
    const img = images.get(ts.image);
    if (!img) continue;
    const c = document.createElement('canvas');
    const s = 2;
    c.width = img.width * s;
    c.height = img.height * s;
    c.title = ts.name;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#2a2438';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    if (gid >= ts.firstgid && gid < ts.firstgid + ts.tilecount) {
      const i = gid - ts.firstgid;
      g.strokeStyle = '#f2c46d';
      g.lineWidth = 2;
      g.strokeRect((i % ts.columns) * T * s + 1, Math.floor(i / ts.columns) * T * s + 1, T * s - 2, T * s - 2);
    }
    c.onclick = (e) => {
      const r = c.getBoundingClientRect();
      const col = Math.floor(((e.clientX - r.left) * (c.width / r.width)) / (T * s));
      const row = Math.floor(((e.clientY - r.top) * (c.height / r.height)) / (T * s));
      if (col >= ts.columns) return;
      const i = row * ts.columns + col;
      if (i < ts.tilecount) { gid = ts.firstgid + i; setTool('tiles', 'brush'); buildPalette(); }
    };
    pal.appendChild(c);
  }
}

// ---------- dibujo ----------
function render() {
  const z = T * zoom;
  canvas.width = map.width * z;
  canvas.height = map.height * z;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#1a1626';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  LAYERS.forEach((key, n) => {
    ctx.globalAlpha = layer === 'tiles' && n + 1 !== tileLayer ? 0.45 : 1;
    map[key].forEach((g, i) => {
      if (!g) return;
      const s = tileSource(g);
      if (s?.img) ctx.drawImage(s.img, s.sx, s.sy, T, T, (i % map.width) * z, Math.floor(i / map.width) * z, z, z);
    });
  });
  ctx.globalAlpha = layer === 'tiles' && tileLayer !== 3 ? 0.45 : 1;
  for (const d of map.decor) {
    const def = DECOR[d.type], img = images.get(def?.image);
    if (img) ctx.drawImage(img, 0, 0, def.frameW, def.frameH, d.x * z, d.y * z, def.frameW * zoom, def.frameH * zoom);
  }
  ctx.globalAlpha = 1;
  if (layer === 'objects' || (layer === 'tiles' && tileLayer === 3)) { // casillas sólidas de la decoración
    ctx.fillStyle = 'rgba(224,96,90,0.5)';
    for (const d of map.decor) for (const [dx, dy] of d.solid ?? []) ctx.fillRect((d.x + dx) * z, (d.y + dy) * z, z, z);
  }

  if (layer === 'objects') {
    ctx.fillStyle = 'rgba(224,96,90,0.45)';
    const h = z / 2;
    map.collision.forEach((m, i) => {
      if (!m) return;
      const x = (i % map.width) * z, y = Math.floor(i / map.width) * z;
      for (let q = 0; q < 4; q++) if (m & (1 << q)) ctx.fillRect(x + (q % 2) * h, y + Math.floor(q / 2) * h, h, h);
    });
    const mark = (x, y, color, text) => {
      ctx.fillStyle = color;
      ctx.fillRect(x * z + 2, y * z + 2, z - 4, z - 4);
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.max(9, z / 3)}px monospace`;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x * z + 4, y * z + z / 2);
    };
    map.exits.forEach((e) => mark(e.x, e.y, 'rgba(90,160,255,0.85)', e.id ? '⇄' + e.id : '→' + e.to));
    map.spawns.forEach((s) => mark(s.x, s.y, 'rgba(100,230,150,0.9)', s.name === 'start' ? '★' : s.name));
    map.npcs.forEach((n) => mark(n.x, n.y, 'rgba(255,170,60,0.9)', NPC_INFO[n.id]?.name ?? n.id));
  }

  if ($('grid').checked) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= map.width; x++) { ctx.moveTo(x * z + 0.5, 0); ctx.lineTo(x * z + 0.5, canvas.height); }
    for (let y = 0; y <= map.height; y++) { ctx.moveTo(0, y * z + 0.5); ctx.lineTo(canvas.width, y * z + 0.5); }
    ctx.stroke();
  }
}

// ---------- edición ----------
const at = (e) => {
  const r = canvas.getBoundingClientRect();
  return [Math.floor(((e.clientX - r.left) / r.width) * map.width), Math.floor(((e.clientY - r.top) / r.height) * map.height)];
};
const inside = (x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height;
const not = (x, y) => (o) => !(o.x === x && o.y === y);

function fill(x, y, to) {
  const arr = L();
  const from = arr[y * map.width + x];
  if (from === to) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (!inside(cx, cy) || arr[cy * map.width + cx] !== from) continue;
    arr[cy * map.width + cx] = to;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

function apply(x, y, erase, first) {
  if (!inside(x, y)) return;
  const i = y * map.width + x;
  const t = tool[layer];
  if (layer === 'tiles') {
    if (t === 'decor' && !erase) {
      if (!first) return;
      if (tileLayer !== 3) return say('Decor goes on layer 3', true);
      const type = $('decorType').value;
      const [, h] = footprint({ type });
      const solid = [...document.querySelectorAll('#decorSolid input:checked')].map((c) => c.dataset.c.split(',').map(Number));
      if (y - h + 1 < 0) return say('Too close to the top: the object does not fit', true);
      // el clic marca la casilla inferior izquierda (donde apoya el objeto)
      map.decor = map.decor.filter((d) => !(d.type === type && d.x === x && d.y === y - h + 1));
      map.decor.push({ type, x, y: y - h + 1, solid });
      return;
    }
    if (erase || t === 'erase') {
      map.decor = map.decor.filter((d) => {
        const [w, h] = footprint(d);
        return !(tileLayer === 3 && x >= d.x && x < d.x + w && y >= d.y && y < d.y + h);
      });
    }
    if (t === 'decor') return;
    if (t === 'fill') { if (first) fill(x, y, erase ? 0 : gid); }
    else L()[i] = erase || t === 'erase' ? 0 : gid;
    return;
  }
  if (t === 'collision') {
    const mask = Number($('colShape').value);
    map.collision[i] = erase ? 0 : $('colMerge').checked ? map.collision[i] | mask : mask;
    return;
  }
  if (!first) return;
  if (t === 'eraseobj' || erase) {
    map.exits = map.exits.filter(not(x, y));
    map.npcs = map.npcs.filter(not(x, y));
    map.spawns = map.spawns.filter(not(x, y));
  } else if (t === 'exit') {
    const id = $('exId').value.trim();
    if (!id) return say('Enter an exit ID', true);
    map.exits = map.exits.filter(not(x, y));
    if (map.exits.some((e) => e.id === id)) return say(`"${id}" already exists in this map: each ID only once per map`, true);
    map.exits.push({ x, y, id });
    partnersOf(id).then((p) => say(p.length ? `"${id}" connects to: ${p.join(', ')}` : `"${id}" has no partner yet: place it in another map`));
  } else if (t === 'spawn') {
    const name = $('spName').value.trim() || 'start';
    map.spawns = map.spawns.filter((s) => s.name !== name && !(s.x === x && s.y === y));
    map.spawns.push({ name, x, y });
  } else if (t === 'npc') {
    const id = $('npcId').value;
    map.npcs = map.npcs.filter((n) => n.id !== id && !(n.x === x && n.y === y));
    map.npcs.push({ id, x, y });
  }
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  painting = e.button === 2 ? 'erase' : 'draw';
  const [x, y] = at(e);
  if (layer === 'tiles' && painting === 'draw' && tool.tiles === 'brush' && !gid) say('Pick a tile from the tileset', true);
  apply(x, y, painting === 'erase', true);
  render();
});
canvas.addEventListener('mousemove', (e) => {
  if (!painting) return;
  const [x, y] = at(e);
  apply(x, y, painting === 'erase', false);
  render();
});
addEventListener('mouseup', () => { painting = null; });

// ---------- UI ----------
function setTool(l, t) {
  layer = l;
  tool[l] = t;
  $('tilesTools').hidden = l !== 'tiles';
  $('objTools').hidden = l !== 'objects';
  document.querySelectorAll('.layer').forEach((b) => b.classList.toggle('on', b.dataset.layer === l && (l !== 'tiles' || Number(b.dataset.n) === tileLayer)));
  document.querySelectorAll('.tool[data-tool]').forEach((b) => {
    const inTiles = $('tilesTools').contains(b);
    if (inTiles === (l === 'tiles')) b.classList.toggle('on', b.dataset.tool === t);
  });
  render();
}
document.querySelectorAll('.layer').forEach((b) => (b.onclick = () => {
  if (b.dataset.n) tileLayer = Number(b.dataset.n);
  setTool(b.dataset.layer, tool[b.dataset.layer]);
}));
document.querySelectorAll('.tool[data-tool]').forEach((b) => (b.onclick = () => {
  setTool($('tilesTools').contains(b) ? 'tiles' : 'objects', b.dataset.tool);
}));
function buildDecorUi() {
  for (const [id, def] of Object.entries(DECOR)) $('decorType').add(new Option(def.label, id));
  const sel = $('decorType');
  const draw = () => {
    const def = DECOR[sel.value];
    const w = Math.ceil(def.frameW / T), h = Math.ceil(def.frameH / T);
    const box = $('decorSolid');
    box.style.gridTemplateColumns = `repeat(${w}, 22px)`;
    box.innerHTML = '';
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.dataset.c = `${dx},${dy}`;
      c.checked = def.solid.some(([a, b]) => a === dx && b === dy);
      box.appendChild(c);
    }
  };
  sel.onchange = draw;
  draw();
}
buildDecorUi();

$('zoom').oninput = (e) => { zoom = Number(e.target.value); render(); };
$('grid').onchange = render;

for (const [id, info] of Object.entries(NPC_INFO)) {
  $('npcId').add(new Option(`${info.name} (${id})`, id));
}

$('resize').onclick = () => {
  const w = Number($('w').value), h = Number($('h').value);
  const rs = (arr) => {
    const out = Array(w * h).fill(0);
    for (let y = 0; y < Math.min(h, map.height); y++) for (let x = 0; x < Math.min(w, map.width); x++) out[y * w + x] = arr[y * map.width + x];
    return out;
  };
  for (const k of LAYERS) map[k] = rs(map[k]);
  map.collision = rs(map.collision);
  map.width = w;
  map.height = h;
  const ok = (o) => o.x < w && o.y < h;
  map.decor = map.decor.filter(ok);
  map.exits = map.exits.filter(ok); map.spawns = map.spawns.filter(ok); map.npcs = map.npcs.filter(ok);
  render();
};

$('new').onclick = () => {
  if (!confirm('Discard the current map and start an empty one?')) return;
  const keep = map.tilesets;
  map = newMap($('name').value.trim() || 'map', Number($('w').value), Number($('h').value));
  map.tilesets = keep;
  buildPalette();
  render();
};

async function refreshLists() {
  const maps = await (await fetch('/editor-api/maps')).json();
  const ml = $('maplist');
  ml.innerHTML = '';
  maps.forEach((m) => ml.add(new Option(m, m)));
  const tss = await (await fetch('/editor-api/tilesets')).json();
  const tl = $('tslist');
  tl.innerHTML = '';
  tss.forEach((t) => tl.add(new Option(t, t)));
}

// mapas guardados (distintos del actual) que tienen una salida con ese ID
async function partnersOf(id) {
  const maps = await (await fetch('/editor-api/maps')).json();
  const found = [];
  for (const m of maps) {
    if (m === map.name) continue;
    const data = await (await fetch(`/maps/${m}.json?t=${Date.now()}`)).json();
    if (data.exits?.some((e) => e.id === id)) found.push(m);
  }
  return found;
}

async function openMap(name) {
  map = await (await fetch(`/maps/${name}.json?t=${Date.now()}`)).json();
  for (const k of LAYERS) map[k] ??= Array(map.width * map.height).fill(0);
  map.decor ??= [];
  if (!map.collisionVersion) { map.collision = map.collision.map((v) => (v ? 15 : 0)); map.collisionVersion = 2; } // 1 antiguo = casilla completa
  for (const def of Object.values(DECOR)) await loadImage(def.image);
  for (const ts of map.tilesets) await loadImage(ts.image);
  $('name').value = map.name = name;
  $('w').value = map.width;
  $('h').value = map.height;
  gid = 0;
  buildPalette();
  render();
}

$('load').onclick = () => $('maplist').value && openMap($('maplist').value).then(() => say('Map opened'), (e) => say(e.message, true));
$('addts').onclick = () => $('tslist').value && addTileset($('tslist').value).then(render, (e) => say(e.message, true));

$('upload').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = await fetch(`/editor-api/tileset/${encodeURIComponent(f.name)}`, { method: 'POST', body: await f.arrayBuffer() });
  const { name } = await r.json();
  images.delete(`/tilesets/${name}`);
  await refreshLists();
  await addTileset(name);
  e.target.value = '';
  render();
  say('Tileset uploaded: ' + name);
};

$('save').onclick = async () => {
  map.name = $('name').value.trim() || 'map';
  if (!map.spawns.some((s) => s.name === 'start')) say('Warning: no "start" spawn (player position)', true);
  const orphans = [];
  for (const e of map.exits) if (e.id && !(await partnersOf(e.id)).length) orphans.push(e.id);
  const r = await fetch(`/editor-api/map/${encodeURIComponent(map.name)}`, { method: 'POST', body: JSON.stringify(map) });
  if (r.ok) {
    if (map.spawns.some((s) => s.name === 'start')) say(`Saved: public/maps/${map.name}.json` + (orphans.length ? ` · no partner yet: ${orphans.join(', ')}` : ''));
    await refreshLists();
  }
  else say('Error saving', true);
};

await refreshLists();
try { await openMap('village'); } catch { render(); }
