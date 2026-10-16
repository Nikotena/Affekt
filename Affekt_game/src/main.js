import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { getState, sendAction } from './api.js';
import { loadMap, SCALE } from './world.js';
import { updatePanel, setOnline } from './panel.js';
import { setupMusic } from './audio.js';
import { loadTextbox, makeBox, PixelText, BOX } from './pixelfont.js';
import { currentHour, lightAt, clockLabel } from './daylight.js';

const START_MAP = new URLSearchParams(location.search).get('map') ?? 'village';
const MOOD_COLOR = { friendly: 0x6dd3a0, neutral: 0xb9b2cf, tense: 0xf2c46d, hostile: 0xe0605a };
const FONT = { fontFamily: 'monospace', fontSize: 14, fill: 0xe8e2d4 };

const app = new Application();
await app.init({ width: 640, height: 480, background: 0x14111c, antialias: false });
document.getElementById('game').appendChild(app.canvas);
setupMusic(document.getElementById('game'));

const world = new Container(); // escalado x SCALE: mapa + entidades
world.scale.set(SCALE);
const labels = new Container(); // textos sin escalar
const ui = new Container();
ui.visible = false;
// Filtro de luz segun la hora local del jugador: solo en el pueblo (los interiores no cambian)
const daylight = new Graphics();
daylight.eventMode = 'none';
app.stage.addChild(world, daylight, labels, ui);
function updateDaylight() {
  const h = currentHour();
  const clock = document.getElementById('clock');
  if (clock) clock.textContent = `Local time ${clockLabel(h)}`;
  if (!current) return;
  const outdoors = current.map.name === 'village';
  daylight.visible = outdoors;
  if (!outdoors) return;
  const { color, alpha } = lightAt(h);
  daylight.clear().rect(0, 0, app.screen.width, app.screen.height).fill({ color, alpha });
}
setInterval(updateDaylight, 30000); // amanece y anochece mientras se juega

// Personaje del jugador (dibujado en píxeles de mapa, 16x16)
// Spritesheet 64x128: frames de 16x32, 4 por fila; filas = abajo, derecha, arriba, izquierda.
const FW = 16, FH = 32, FRAMES = 4;
const DIR_ROW = { down: 0, right: 1, up: 2, left: 3 };
const sheet = await Assets.load('/character/character.png');
sheet.source.scaleMode = 'nearest';
const walkFrames = Object.values(DIR_ROW).map((row) =>
  Array.from({ length: FRAMES }, (_, i) => new Texture({ source: sheet.source, frame: new Rectangle(i * FW, row * FH, FW, FH) })));
const player = new Container();
const playerSprite = new Sprite(walkFrames[0][0]);
playerSprite.y = 16 - FH; // los pies quedan en la base del tile; la cabeza sobresale
player.addChild(playerSprite);
let facing = 'down';
let walkTime = 0;
const hint = new Text({ text: 'E: talk', style: { ...FONT, fontSize: 12, fill: 0xf2c46d } });
hint.visible = false;

// Diálogo (caja y fuente de public/textbox/font.png)
await loadTextbox();
// fotogramas del spinner de espera (32x32, pixel art)
const spinFrames = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(async (i) => {
  const t = await Assets.load(`/loading/loading${i}.png`);
  t.source.scaleMode = 'nearest';
  return t;
}));
const spinner = new Sprite(spinFrames[0]);
spinner.visible = false;
const box = makeBox();
const nameText = new PixelText({ scale: 2, lineHeight: 11 });
const lineText = new PixelText({ scale: 2, lineHeight: 11 });
const menuText = new PixelText({ scale: 2, lineHeight: 11 });
const HINT = document.body.classList.contains('touch') ? 'Tap a phrase below or type your own' : 'Type your message and press Enter. Esc: leave';
let input = ''; // lo que el jugador está escribiendo para el NPC
ui.addChild(box, nameText, lineText, menuText, spinner);

let current = null; // mapa cargado
let npcSprites = {};
let talking = null;
let busy = false;
let loading = false;
let typing = { shown: 0 };
const keys = new Set();
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || new URLSearchParams(location.search).has('touch');
if (IS_TOUCH) document.body.classList.add('touch');
hint.text = IS_TOUCH ? 'Tap to talk' : 'E: talk';

// --- Mover tocando: busqueda de camino por casillas (BFS) y marcador de destino ---
let path = [];          // casillas por recorrer, en pixeles de mapa (esquina de la casilla)
let goalNpc = null;     // NPC al que se camina para hablarle al llegar
let stuck = 0;
const marker = new Graphics();
marker.visible = false;
const tileCorner = (tx, ty) => ({ x: tx * current.map.tileSize, y: ty * current.map.tileSize });
const hasExit = (tx, ty) => current.exitAt(tx, ty);

function findPath(goal) {
  // goal: (tx, ty) -> true si la casilla sirve de destino. Devuelve las casillas hasta la mas cercana que lo cumpla.
  const T = current.map.tileSize, W = current.map.width, H = current.map.height;
  const sx = Math.min(W - 1, Math.max(0, Math.floor((player.x + 8) / T)));
  const sy = Math.min(H - 1, Math.max(0, Math.floor((player.y + 12) / T)));
  const key = (x, y) => y * W + x;
  const prev = new Map([[key(sx, sy), null]]);
  const queue = [[sx, sy]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    if ((x !== sx || y !== sy) && goal(x, y)) {
      const out = [];
      for (let k = key(x, y); k !== null; k = prev.get(k)) out.unshift(tileCorner(k % W, Math.floor(k / W)));
      return out.slice(1);
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || prev.has(key(nx, ny))) continue;
      const c = tileCorner(nx, ny);
      if (blocked(c.x, c.y)) continue;
      if (hasExit(nx, ny) && !goal(nx, ny)) continue; // no se cruza una puerta por el camino
      prev.set(key(nx, ny), key(x, y));
      queue.push([nx, ny]);
    }
  }
  return null;
}

function npcAt(wx, wy) {
  const T = current.map.tileSize;
  for (const { data } of Object.values(npcSprites)) {
    // el sprite mide 16x32: la casilla del NPC y la de arriba
    if (wx >= data.x * T - 2 && wx <= data.x * T + T + 2 && wy >= data.y * T - T && wy <= data.y * T + T) return data;
  }
  return null;
}

function onTap(e) {
  if (document.body.dataset.started !== '1' || !current || loading || talking || busy) return;
  const rect = app.canvas.getBoundingClientRect();
  const wx = ((e.clientX - rect.left) * (app.screen.width / rect.width)) / SCALE;
  const wy = ((e.clientY - rect.top) * (app.screen.height / rect.height)) / SCALE;
  const T = current.map.tileSize;
  const npc = npcAt(wx, wy);
  if (npc) {
    if (nearestNpc() === npc) { path = []; goalNpc = null; return openTalk(npc); }
    const p = findPath((x, y) => Math.hypot(x - npc.x, y - npc.y) <= 1.2);
    if (p) { path = p; goalNpc = npc; stuck = 0; }
    return;
  }
  const tx = Math.floor(wx / T), ty = Math.floor(wy / T);
  let p = findPath((x, y) => x === tx && y === ty);
  if (!p) { // casilla ocupada o inalcanzable: va a la libre mas cercana al punto tocado
    p = findPath((x, y) => Math.hypot(x - tx, y - ty) <= 1.5);
  }
  if (!p) return;
  path = p; goalNpc = null; stuck = 0;
  const end = p[p.length - 1];
  if (end) { marker.clear().circle(0, 0, 5).stroke({ color: 0xf2c46d, width: 2 }); marker.position.set(end.x + 8, end.y + 14); marker.visible = true; }
}
app.canvas.addEventListener('pointerdown', onTap);
app.canvas.style.touchAction = 'manipulation';
app.canvas.style.cursor = 'pointer';

function layoutUi() {
  const w = app.screen.width, h = app.screen.height;
  const k = Math.max(1, Math.min(3, Math.floor((w - 16) / BOX.w))); // escala de la caja
  const ts = k >= 3 ? 2 : 1; // escala del texto
  const pad = 12 * k;
  box.scale.set(k);
  box.position.set(Math.round((w - BOX.w * k) / 2), h - BOX.h * k - 8);
  const inner = BOX.w * k - pad * 2;
  const lh = 11 * ts;
  for (const t of [nameText, lineText, menuText]) { t.scale_ = ts; t.maxWidth = inner; }
  nameText.position.set(box.x + pad, box.y + pad - 2 * k);
  lineText.position.set(box.x + pad, box.y + pad + lh + 2 * k);
  spinner.scale.set(ts === 2 ? 1.25 : 1);
  spinner.position.set(box.x + pad, box.y + pad + lh);
  menuPos = { x: box.x + pad, bottom: box.y + BOX.h * k - pad - 2 * k, lh };
  renderInput();
  if (talking) refreshTexts();
}
let menuPos = { x: 0, bottom: 0, lh: 22 };
// Línea de entrada abajo de la caja; crece hacia arriba si el texto ocupa varias líneas.
function renderInput() {
  menuText.setText(input ? `> ${input}_` : HINT);
  menuText.position.set(menuPos.x, menuPos.bottom - menuText.lines * menuPos.lh);
  menuText.reveal(Infinity);
}
let nameStr = '', lineStr = '';
function refreshTexts() {
  nameText.setText(nameStr);
  lineText.setText(lineStr);
  lineText.reveal(typing.shown);
}

function setMoodDot(id, mood) {
  const s = npcSprites[id];
  if (s) s.dot.clear().circle(0, 0, 4).stroke({ color: 0x000000, width: 2 }).fill(MOOD_COLOR[mood] ?? MOOD_COLOR.neutral);
}

// Salidas por ID: dos salidas con el mismo ID (en mapas distintos) están conectadas.
const mapCache = {};
async function fetchMap(name) {
  mapCache[name] ??= fetch(`/maps/${name}.json`).then((r) => r.json());
  return mapCache[name];
}
async function findPartner(id, fromMap) {
  const { maps } = await (await fetch('/maps/index.json')).json();
  for (const name of maps) {
    if (name === fromMap) continue;
    const exit = (await fetchMap(name)).exits?.find((e) => e.id === id);
    if (exit) return { map: name, exit };
  }
  return null;
}
let exitArmed = false; // no se vuelve a disparar hasta que el jugador salga de la casilla de salida

async function takeExit(exit) {
  loading = true; // congela el movimiento mientras se busca la pareja
  try {
    if (exit.id) {
      const partner = await findPartner(exit.id, current.map.name);
      if (!partner) { console.warn(`Exit "${exit.id}" has no partner in another map`); loading = false; return; }
      await enterMap(partner.map, null, partner.exit);
    } else {
      await enterMap(exit.to, exit.spawn); // formato antiguo: mapa + spawn
    }
  } catch (e) {
    console.error(e);
    loading = false;
  }
}

async function enterMap(name, spawnName, arriveAt) {
  loading = true;
  const m = await loadMap(name);
  current = m;
  const T = m.map.tileSize;
  world.removeChildren();
  labels.removeChildren();
  world.addChild(m.view);

  app.renderer.resize(m.map.width * T * SCALE, m.map.height * T * SCALE);
  layoutUi();
  updateDaylight();

  npcSprites = {};
  for (const n of m.npcs) {
    const c = new Container();
    c.position.set(n.x * T, n.y * T);
    let body = null, top = 0;
    if (n.sprite) {
      const frames = await npcFrames(n.sprite);
      body = new Sprite(frames.down);
      body.y = 16 - FH; // pies en la base de la casilla, como el jugador
      top = body.y;
      c.addChild(body);
    } else {
      c.addChild(new Graphics().rect(3, 4, 10, 11).fill(n.color ?? 0x999999).rect(5, 1, 6, 5).fill(0xf0d2b0));
    }
    const dot = new Graphics(); // indicador de humor, junto al nombre
    world.addChild(c);
    const label = new Text({
      text: n.name ?? n.id,
      style: { ...FONT, fontSize: 13, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x000000, width: 4, join: 'round' } },
    });
    label.anchor.set(0.5, 1);
    // justo sobre la cabeza (en el sprite alto la cabeza empieza en la fila 7 del frame)
    const headTop = n.y * T + top + (body ? 7 : 1);
    label.position.set((n.x * T + 8) * SCALE, (headTop - 2) * SCALE);
    dot.position.set(label.x - label.width / 2 - 9, label.y - label.height / 2);
    labels.addChild(label, dot);
    npcSprites[n.id] = { dot, data: n, body, top, frames: body && await npcFrames(n.sprite) };
  }

  const sp = arriveAt ?? m.spawn(spawnName ?? 'start'); // por ID: se aparece sobre la salida pareja
  exitArmed = false;
  player.position.set(sp.x * T, sp.y * T);
  world.addChild(player);
  world.addChild(marker);
  marker.visible = false;
  path = [];
  goalNpc = null;
  world.addChild(m.over); // capa 3: tapa a jugador y NPCs
  labels.addChild(hint);

  try {
    const { npcs } = await getState();
    for (const id of Object.keys(npcs)) setMoodDot(id, npcs[id].mood);
    setOnline(true);
  } catch {
    setOnline(false);
  }
  loading = false;
}

// Los NPC no caminan: solo giran hacia el jugador al hablarles. PNG de 16x128: un frame por dirección.
const npcFrameCache = {};
async function npcFrames(url) {
  if (!npcFrameCache[url]) {
    const tex = await Assets.load(url);
    tex.source.scaleMode = 'nearest';
    const f = (row) => new Texture({ source: tex.source, frame: new Rectangle(0, row * FH, FW, FH) });
    npcFrameCache[url] = { down: f(0), right: f(1), up: f(2), left: f(3) };
  }
  return npcFrameCache[url];
}

function faceNpcTowardPlayer(npc) {
  const s = npcSprites[npc.id];
  if (!s?.body) return;
  const dx = player.x - npc.x * current.map.tileSize;
  const dy = player.y - npc.y * current.map.tileSize;
  const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  s.body.texture = s.frames[dir];
}

function nearestNpc() {
  const T = current.map.tileSize;
  let best = null, bestD = T * 1.7;
  for (const { data } of Object.values(npcSprites)) {
    const d = Math.hypot(data.x * T - player.x, data.y * T - player.y);
    if (d < bestD) { best = data; bestD = d; }
  }
  return best;
}

// Animacion de espera (public/loading/loading1-7.png) mientras el NPC "piensa" la respuesta
let thinking = false;
function setThinking(on) {
  thinking = on;
  spinner.visible = on;
  if (on) { typing = { shown: 0 }; lineStr = ''; lineText.setText(''); }
  document.dispatchEvent(new CustomEvent('npc-thinking', { detail: { on, name: nameStr.split(' - ')[0] } }));
}

function say(text, quiet = false) {
  thinking = false;
  spinner.visible = false;
  typing = { shown: 0 };
  lineStr = text;
  lineText.setText(text);
  lineText.reveal(0);
  // la barra de chat tactil repite la linea: en un telefono el mapa puede quedar fuera de pantalla
  if (!quiet) document.dispatchEvent(new CustomEvent('npc-line', { detail: { name: nameStr.split(' - ')[0], text } }));
}

function openTalk(npc) {
  talking = npc;
  path = [];
  goalNpc = null;
  marker.visible = false;
  document.dispatchEvent(new CustomEvent('talk-state', { detail: { open: true } })); // barra de chat tactil
  document.body.dataset.typing = '1'; // el atajo M (silenciar) no debe saltar mientras se escribe
  input = '';
  renderInput();
  faceNpcTowardPlayer(npc);
  ui.visible = true;
  nameStr = `${npc.name} - ${npc.role}`;
  nameText.setText(nameStr);
  // antes decia "..." y parecia que algo cargaba para siempre: ahora se ve que el NPC espera a que hables
  if (!busy) say(`(${npc.name} is listening.)`, true);
  getState().then((s) => { updatePanel(s.npcs[npc.id]); setOnline(true); }).catch(() => setOnline(false));
}

function closeTalk() {
  talking = null;
  document.body.dataset.typing = '0';
  ui.visible = false;
  document.dispatchEvent(new CustomEvent('talk-state', { detail: { open: false } }));
}
// la barra de chat tactil (src/chatbar.js) envia y cierra por eventos
document.addEventListener('chat-send', (e) => act(String(e.detail ?? '')));
document.addEventListener('chat-typing', (e) => { if (talking && !busy) { input = String(e.detail ?? '').slice(0, 140); renderInput(); } });
document.addEventListener('chat-leave', () => { if (talking) closeTalk(); });

async function act(text) {
  if (!talking || busy || !text.trim()) return;
  busy = true;
  document.body.dataset.busy = '1';
  input = '';
  renderInput();
  const npc = talking; // el jugador puede cambiar de personaje mientras llega la respuesta
  setThinking(true); // el LLM puede tardar unos segundos
  try {
    const res = await sendAction(npc.id, text.trim());
    setMoodDot(npc.id, res.mood);
    if (talking === npc) say(res.line); else setThinking(false);
    updatePanel(res.npc, res.payload, res);
    setOnline(true);
  } catch (err) {
    const msg = String(err?.message ?? '');
    if (err?.name === 'AbortError' || /timeout|timed out/i.test(msg)) {
      say('(They seem lost in thought... Try asking again in a moment.)'); // sin respuesta tras el tiempo limite
    } else if (/slow down|too many/i.test(msg)) {
      say('(Easy there! Give them a moment to answer, then try again.)'); // limite de peticiones: el servidor sigue en linea
    } else if (/offline|failed to fetch|networkerror|load failed/i.test(msg) || err instanceof TypeError) {
      say('(Cannot reach the game server. Check your connection and try again.)');
      setOnline(false);
    } else {
      say('(Something went wrong on the server. Try again in a moment.)');
    }
  } finally {
    if (thinking) setThinking(false);
    busy = false;
    document.body.dataset.busy = '0';
  }
}

addEventListener('keydown', (e) => {
  if (document.body.dataset.started !== '1') return; // pantalla de inicio visible
  if (e.target instanceof HTMLInputElement) return; // escribe en la barra de chat tactil: no es un atajo del juego
  const k = e.key.toLowerCase();
  if (talking) {
    // modo conversación: el teclado escribe el mensaje (el movimiento está desactivado)
    if (k === 'escape') closeTalk();
    else if (k === 'enter') act(input);
    else if (k === 'backspace') { input = input.slice(0, -1); renderInput(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !busy && input.length < 140) { input += e.key; renderInput(); }
    if (k === ' ' || k === 'backspace') e.preventDefault();
    return;
  }
  keys.add(k);
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { path = []; goalNpc = null; marker.visible = false; } // el teclado manda sobre el camino
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (k === 'e' && current) {
    const n = nearestNpc();
    if (n) openTalk(n);
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

// Hitbox de los pies: 10x5 px en la parte baja del sprite de 16x16
function blocked(px, py) {
  for (const ox of [3, 7, 8, 12]) {
    for (const oy of [10, 15]) if (current.solidAt(px + ox, py + oy)) return true;
  }
  return false;
}

const SPEED = 1.3;
app.ticker.add((t) => {
  if (!current || loading) return;
  const T = current.map.tileSize;
  if (!talking) {
    let dx = 0, dy = 0;
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if (keys.has('d') || keys.has('arrowright')) dx += 1;
    if (keys.has('w') || keys.has('arrowup')) dy -= 1;
    if (keys.has('s') || keys.has('arrowdown')) dy += 1;
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }
    const step = SPEED * t.deltaTime;
    if (!dx && !dy && path.length) { // camino tocado: avanza hacia la siguiente casilla
      const wp = path[0];
      const vx = wp.x - player.x, vy = wp.y - player.y, d = Math.hypot(vx, vy);
      if (d <= step) { player.x = wp.x; player.y = wp.y; path.shift(); }
      else { dx = vx / d; dy = vy / d; }
    }
    const px = player.x, py = player.y;
    if (dx && !blocked(player.x + dx * step, player.y)) player.x += dx * step;
    if (dy && !blocked(player.x, player.y + dy * step)) player.y += dy * step;
    const moving = player.x !== px || player.y !== py;
    if (path.length && !moving) { if (++stuck > 20) { path = []; goalNpc = null; marker.visible = false; } } else stuck = 0;
    if (!path.length) {
      marker.visible = false;
      if (goalNpc) { // llego junto al NPC tocado: empieza la conversacion
        const n = goalNpc;
        goalNpc = null;
        if (nearestNpc() === n) openTalk(n);
      }
    }
    if (moving) {
      // el eje dominante decide hacia dónde mira
      facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      walkTime += t.deltaTime;
      playerSprite.texture = walkFrames[DIR_ROW[facing]][Math.floor(walkTime / 8) % FRAMES];
    } else {
      walkTime = 0;
      playerSprite.texture = walkFrames[DIR_ROW[facing]][0]; // quieto: primer frame de la dirección actual
    }

    const exit = current.exitAt(Math.floor((player.x + 8) / T), Math.floor((player.y + 12) / T));
    if (!exit) exitArmed = true;
    else if (exitArmed) { exitArmed = false; takeExit(exit); return; }
  }
  const near = !talking && nearestNpc();
  hint.visible = !!near;
  if (near) hint.position.set(player.x * SCALE - 8, player.y * SCALE - 40);

  if (thinking) spinner.texture = spinFrames[Math.floor(performance.now() / 110) % spinFrames.length]; // ~9 fps
  if (typing.shown < lineText.length) {
    typing.shown = Math.min(lineText.length, typing.shown + 1.2 * t.deltaTime);
    lineText.reveal(Math.floor(typing.shown));
  }
});

await enterMap(START_MAP);

if (import.meta.env.DEV) window.__game = { openTalk, say, get npcs() { return current.npcs; }, get current() { return current; }, player }; // para depurar

// Tras cargar una sesion guardada: los puntos de humor y el panel reflejan el estado restaurado
document.addEventListener('session-loaded', (e) => {
  const npcs = e.detail?.npcs ?? {};
  for (const id of Object.keys(npcs)) setMoodDot(id, npcs[id].mood);
  if (talking && npcs[talking.id]) updatePanel(npcs[talking.id]);
});
