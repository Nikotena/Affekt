// Cliente del puente HTTP (server/server.py) hacia Affekt_core (Affekt).
// La sesion viaja en la cabecera X-Sid y no solo en una cookie: dentro de un iframe de otro dominio
// (la landing) algunos navegadores bloquean las cookies de terceros y cada peticion seria un jugador nuevo.
import { currentHour } from './daylight.js';

let sid = '';
try { sid = sessionStorage.getItem('affekt.sid') || ''; } catch { /* sin almacenamiento */ }

// La clave del jugador vive SOLO en esta variable (memoria de la pestana): no se guarda en ningun almacenamiento.
let userKey = '';
export const setKey = (k) => { userKey = (k || '').trim(); };
export const hasKey = () => userKey !== '';

// Sin tiempo limite, un servidor dormido o colgado dejaba al juego esperando para siempre.
const TIMEOUT_MS = 60000; // el servidor reintenta al LLM hasta ~30 s x 3; pasado este tiempo se avisa al jugador

async function call(path, body, ms = TIMEOUT_MS, withKey = false) {
  const headers = sid ? { 'X-Sid': sid } : {};
  if (withKey && userKey) headers['X-AMD-Key'] = userKey;
  if (body) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  let r;
  try {
    r = await fetch(path, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  const data = await r.json();
  if (data.sid && data.sid !== sid) {
    sid = data.sid;
    try { sessionStorage.setItem('affekt.sid', sid); } catch { /* sin almacenamiento */ }
  }
  if (!r.ok) throw new Error(data.error ?? r.statusText);
  return data;
}

export const getState = () => call('/api/state');
// la hora local del jugador viaja con cada accion: los NPC saludan segun la hora que es para el
export const sendAction = (npc_id, action) => call('/api/action', { npc_id, action, hour: currentHour() }, TIMEOUT_MS, true);
export const checkKey = () => call('/api/key/check', {}, 40000, true);
export const importSession = (data) => call('/api/session/import', data);

// Descarga la sesion (emociones y recuerdos; nunca la clave) como archivo JSON.
export async function exportSession() {
  const r = await fetch('/api/session/export', { headers: sid ? { 'X-Sid': sid } : {} });
  if (!r.ok) throw new Error('export failed');
  const blob = new Blob([JSON.stringify(await r.json(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'affekt-session.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
