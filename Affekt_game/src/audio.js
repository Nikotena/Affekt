// Música de fondo (public/music.mp3): bajita, en bucle, con botón de silencio abajo a la izquierda.
const VOLUME = 0.15;
const KEY = 'affekt.muted';

const store = {
  get() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } },
  set(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* sin almacenamiento */ } },
};

export function setupMusic(container) {
  const audio = new Audio('/music.mp3');
  audio.loop = true;
  audio.volume = VOLUME;
  let muted = store.get();
  let started = false;

  const btn = document.createElement('button');
  btn.style.cssText = 'position:absolute;left:8px;bottom:8px;width:34px;height:34px;font-size:18px;cursor:pointer;' +
    'background:#382b26;color:#dfe4e0;border:1px solid rgba(184,194,185,.4);border-radius:8px;opacity:.9;padding:0;line-height:1;z-index:2';
  container.style.position = 'relative';
  container.appendChild(btn);

  const render = () => {
    btn.textContent = muted ? '🔇' : '🔊';
    btn.title = muted ? 'Unmute music (M)' : 'Mute music (M)';
    audio.muted = muted;
  };
  // los navegadores bloquean el audio hasta que haya una interacción del usuario
  const start = () => {
    if (started) return;
    audio.play().then(() => { started = true; }, () => { /* se reintenta en la siguiente interacción */ });
  };
  const toggle = () => { muted = !muted; store.set(muted); render(); start(); };

  btn.onclick = () => { toggle(); btn.blur(); };
  addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'm' && !e.repeat && document.body.dataset.typing !== '1') toggle(); else start(); });
  addEventListener('pointerdown', start);
  render();
}
