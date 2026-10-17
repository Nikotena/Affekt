import { getState, setKey, hasKey, checkKey, exportSession, importSession } from './api.js';

// Pantalla de inicio, deteccion tactil y ajuste al marco (cuando el juego va dentro de un iframe de la landing).
// Mientras la pantalla de inicio esta visible, body.dataset.started !== '1' y el teclado no mueve al jugador.
const overlay = document.getElementById('start');
const button = document.getElementById('start-btn');
const wrap = document.getElementById('wrap');
const params = new URLSearchParams(location.search);
const embedded = window.top !== window || params.has('embed');
// Dentro de la landing solo se ve el juego: el panel tecnico (AFFEKT CORE) queda para la pagina de Render
if (embedded) document.documentElement.classList.add('embed');

// Se marca cuanto antes para que la pantalla de inicio ya muestre las instrucciones tactiles
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || params.has('touch')) {
  document.body.classList.add('touch');
}

function begin() {
  document.body.dataset.started = '1';
  overlay.hidden = true;
  tools.hidden = false;
  window.focus(); // dentro de un iframe, el foco del teclado debe quedar en el juego
}

// Modo con clave propia (BYOK): el servidor no tiene clave de modelo; el jugador pega la suya y queda solo en esta pestana.
const $ = (id) => document.getElementById(id);
const keybox = $('keybox'), keyInput = $('key'), keyMsg = $('keymsg');
const tools = $('tools'), toolMsg = $('toolmsg'), fileInput = $('load-file');
let needKey = false;

function say(el, text, cls = '') { el.textContent = text; el.className = cls; }
function flash(text) { toolMsg.textContent = text; clearTimeout(flash.t); flash.t = setTimeout(() => { toolMsg.textContent = ''; }, 5000); }

getState().then((s) => {
  needKey = !!s.byok;
  if (needKey) {
    keybox.hidden = false;
    button.disabled = true;
    say(keyMsg, 'The game needs your key to give the villagers a voice.');
  }
}).catch(() => { /* si el servidor duerme, START sigue disponible y main.js muestra el estado */ });

async function verifyKey() {
  setKey(keyInput.value);
  if (!hasKey()) { button.disabled = true; say(keyMsg, 'The game needs your key to give the villagers a voice.'); return; }
  button.disabled = true;
  say(keyMsg, 'Checking your key with AMD Token Factory...');
  try {
    const r = await checkKey();
    if (r.ok) {
      say(keyMsg, 'Key accepted. Gemma 4 is ready.', 'ok');
      button.disabled = false;
    } else {
      say(keyMsg, r.reason || 'This key did not work.', 'bad');
    }
  } catch (e) {
    say(keyMsg, /slow|too many/i.test(String(e.message)) ? 'Too many checks. Wait a minute and try again.' : 'Could not check the key. Try again.', 'bad');
  }
}
keyInput.addEventListener('change', verifyKey);
keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); verifyKey(); } });
keyInput.addEventListener('paste', () => setTimeout(verifyKey, 0));

function loadPicker() { fileInput.click(); }
$('load-btn').addEventListener('click', loadPicker);
$('load-btn2').addEventListener('click', loadPicker);
fileInput.addEventListener('change', async () => {
  const f = fileInput.files[0];
  fileInput.value = '';
  if (!f) return;
  if (f.size > 200000) { flash('That file is too big to be a saved session.'); return; }
  try {
    const r = await importSession(JSON.parse(await f.text()));
    document.dispatchEvent(new CustomEvent('session-loaded', { detail: r }));
    flash(`Session loaded: ${r.info.short_term + r.info.medium_term + r.info.long_term} memories restored.`);
  } catch (e) {
    flash('That is not a valid Affekt session file.');
  }
});
$('save-btn').addEventListener('click', () => exportSession().then(() => flash('Session saved (your key is not included).')).catch(() => flash('Could not save the session.')));

button.addEventListener('click', () => { if (!button.disabled) begin(); });
addEventListener('keydown', (e) => {
  if (document.body.dataset.started !== '1' && (e.key === 'Enter' || e.key === ' ') && document.activeElement !== keyInput && !button.disabled) {
    e.preventDefault();
    begin();
  }
});
if (!needKey) button.focus();

// Ventana ancha dentro de un iframe: se escala todo el juego (mapa y panel lado a lado) para que quepa entero.
// Pantalla estrecha (movil): sin escalar; el CSS pone el mapa a todo el ancho y el panel debajo, con texto legible.
const NARROW = 760;
function fit() {
  const s = wrap.style;
  if (innerWidth < NARROW || !embedded) {
    s.transform = s.marginLeft = s.marginTop = s.width = s.flexWrap = s.boxSizing = '';
    document.documentElement.style.overflow = innerWidth < NARROW ? '' : document.documentElement.style.overflow;
    return;
  }
  document.documentElement.style.overflow = 'hidden';
  s.flexWrap = 'nowrap';
  s.width = 'max-content';
  s.boxSizing = 'content-box';
  s.transform = '';
  s.transformOrigin = 'top left';
  const w = wrap.scrollWidth, h = wrap.scrollHeight;
  const k = Math.min(innerWidth / w, innerHeight / h, 1);
  s.transform = `scale(${k})`;
  s.marginLeft = `${Math.max(0, (innerWidth - w * k) / 2)}px`;
  s.marginTop = `${Math.max(0, (innerHeight - h * k) / 2)}px`;
}
addEventListener('resize', fit);
if (embedded) {
  // el canvas cambia de tamano al cargar cada mapa y el ResizeObserver no siempre avisa: se recalcula con frecuencia
  setInterval(fit, 400);
}
fit();
