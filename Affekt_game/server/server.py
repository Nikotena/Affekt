#!/usr/bin/env python3
"""Puente HTTP entre el juego (PixiJS) y el motor Affekt.

    python server/server.py            # escucha en 127.0.0.1:8765

Modo publico (por defecto, BYOK = "bring your own key"): el servidor NO tiene claves de ningun modelo. Cada jugador pega
su clave de AMD Token Factory en la pantalla de inicio; viaja en la cabecera X-AMD-Key en cada peticion, se usa para
llamar a AMD con Gemma 4 (y MiMo de respaldo) y se descarta. No se guarda en disco, ni en la sesion, ni en los registros.
Sin clave, los NPC responden con lineas fijas segun su humor.

    POST /api/action {npc_id, text, hour}  ->  {line, mood, intent, provider, llm_used, price_guard, payload, npc, ...}
    POST /api/key/check                    ->  {ok, gemma, backup, reason}   (prueba la clave con una llamada minima)
    GET  /api/state                        ->  estado 4D y memoria de cada NPC
    GET  /api/session/export               ->  archivo JSON de la sesion (emociones y memoria; sin clave)
    POST /api/session/import               ->  restaura ese archivo (validado) en la sesion actual
    GET  /api/stats                        ->  cuantas lineas escribio cada proveedor desde el arranque
    GET  /healthz                          ->  {"ok": true}
    GET  /*                                ->  ../dist (juego compilado), si existe

Modo desarrollo: AFFEKT_BYOK=0 usa las claves del entorno o de Affekt_core/.env (AMD_API_KEY, OPENROUTER_API_KEY).
Variables: AFFEKT_HOST, PORT, AFFEKT_BYOK, AFFEKT_ALLOWED_ORIGIN, AFFEKT_TRUST_PROXY, AFFEKT_FORCE_STUB,
AFFEKT_AMD_MODEL, AFFEKT_AMD_BACKUP_MODEL, AFFEKT_PRIMARY_TIMEOUT, AFFEKT_SESSION_PER_MIN, AFFEKT_IP_PER_MIN, AFFEKT_MAX_TEXT.
"""
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sys
import threading
import time
from collections import OrderedDict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
for _name in ("core", "Affekt_core"):  # el repo publico lo llama core/, el de trabajo Affekt_core/
    CORE = os.path.abspath(os.path.join(HERE, "..", "..", _name))
    if os.path.isdir(CORE):
        break
sys.path.insert(0, CORE)

from AffektEngine import AffektEngine, create_engine  # noqa: E402
from modules.ApiBackend import AMDBackend, APIError, FailoverBackend, describe  # noqa: E402
from modules.LLMLayer import StubBackend, set_example_variants  # noqa: E402
from modules.SessionState import MAX_BYTES as MAX_IMPORT, StateError, export_state, import_state  # noqa: E402

NPC_IDS = [f"NPC_{i}" for i in range(5)]
# Atajos antiguos (menu de acciones): se traducen a una frase para el motor.
SHORTCUTS = {
    "greet": "Hello!",
    "ask": "Do you have any news about the quest?",
    "buy": "How much for a potion? I want to buy one.",
    "help": "Can I help you with something?",
    "attack": "I attack you!",
}


def _int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


# ---------------------------------------------------------------- configuracion
BYOK = os.environ.get("AFFEKT_BYOK", "1") != "0"
AMD_MODEL = os.environ.get("AFFEKT_AMD_MODEL", "Gemma-4-31B-IT")
AMD_BACKUP_MODEL = os.environ.get("AFFEKT_AMD_BACKUP_MODEL", "MiMo-V2.6-Flash")  # tambien en AMD; "none" lo quita
PRIMARY_TIMEOUT = float(os.environ.get("AFFEKT_PRIMARY_TIMEOUT", 15))
PROVIDER = os.environ.get("AFFEKT_PROVIDER", "amd").lower()                      # solo modo desarrollo
FALLBACK = os.environ.get("AFFEKT_FALLBACK", "1") != "0"                          # solo modo desarrollo
OPENROUTER_MODEL = os.environ.get("AFFEKT_OPENROUTER_MODEL", "google/gemma-4-31b-it")  # solo modo desarrollo

HOST = os.environ.get("AFFEKT_HOST", "127.0.0.1")           # en la nube: 0.0.0.0
PORT = _int("PORT", _int("AFFEKT_PORT", 8765))
DIST = os.path.abspath(os.path.join(HERE, "..", "dist"))
ALLOWED_ORIGIN = os.environ.get("AFFEKT_ALLOWED_ORIGIN", "")  # vacio = solo mismo origen (sin CORS)
TRUST_PROXY = os.environ.get("AFFEKT_TRUST_PROXY") == "1"     # solo si hay un proxy de confianza delante
FORCE_STUB = os.environ.get("AFFEKT_FORCE_STUB") == "1"       # interruptor de emergencia: cero llamadas a modelos
MAX_BODY = 4096
MAX_TEXT = _int("AFFEKT_MAX_TEXT", 200)                       # caracteres por mensaje (acota tokens de entrada)
SESSION_PER_MIN = _int("AFFEKT_SESSION_PER_MIN", 15)
SESSION_LLM_MAX = _int("AFFEKT_SESSION_LLM_MAX", 1000 if BYOK else 150)  # con clave propia el gasto es del jugador
IP_PER_MIN = _int("AFFEKT_IP_PER_MIN", 120)
KEY_CHECK_PER_MIN = _int("AFFEKT_KEY_CHECK_PER_MIN", 6)       # la prueba de clave no debe servir de comprobador masivo
DAILY_LLM_CAP = _int("AFFEKT_DAILY_LLM_CAP", 1500)            # solo modo desarrollo (claves del servidor)
MAX_SESSIONS = _int("AFFEKT_MAX_SESSIONS", 300)
SESSION_TTL = _int("AFFEKT_SESSION_TTL", 3600)
MAX_INFLIGHT_LLM = _int("AFFEKT_MAX_INFLIGHT", 20 if BYOK else 4)
FRAME_ANCESTORS = os.environ.get("AFFEKT_FRAME_ANCESTORS", "'none'")  # el juego se juega en su propia pagina, no incrustado
BLOCKED_STATIC = {"editor.html"}                              # el editor de mapas no se publica
KEY_RE = re.compile(r"^[A-Za-z0-9._~+/=:-]{8,200}$")          # forma de una clave: sin espacios ni saltos de linea

set_example_variants(5)
STUB = StubBackend()


# ---------------------------------------------------------------- modelo: claves del servidor (solo desarrollo)
def build_server_llm():
    """Cadena con las claves del entorno. Solo se usa con AFFEKT_BYOK=0 (desarrollo local y capturas)."""
    from modules.ApiBackend import OpenRouterBackend

    def amd(model):
        return lambda: AMDBackend(model=model, temperature=0.5, timeout=30.0, retries=2)

    def openrouter():
        return OpenRouterBackend(model=OPENROUTER_MODEL, disable_reasoning=False, temperature=0.5,
                                 timeout=30.0, retries=2, min_interval=3.2)

    amd_chain = [("amd", amd(AMD_MODEL))]
    if AMD_BACKUP_MODEL and AMD_BACKUP_MODEL.lower() != "none" and AMD_BACKUP_MODEL != AMD_MODEL:
        amd_chain.append(("amd-backup", amd(AMD_BACKUP_MODEL)))
    makers = amd_chain + [("openrouter", openrouter)]
    if PROVIDER == "openrouter":
        makers = [("openrouter", openrouter)] + amd_chain
    backends = []
    for name, make in makers:
        if backends and not FALLBACK:
            break
        try:
            backends.append(make())
        except APIError:
            print(f"[bridge] sin clave para {name}; se omite")
    if not backends:
        raise APIError("ninguna clave de LLM disponible")
    for b in backends[:-1]:
        b.timeout, b.retries = PRIMARY_TIMEOUT, 0
    llm = FailoverBackend(backends)
    llm.shots = 2
    print("[bridge] LLM del servidor: " + " -> ".join(describe(b) for b in backends), flush=True)
    return llm


SERVER_LLM = None
if not BYOK:
    try:
        SERVER_LLM = build_server_llm()
    except Exception as e:  # noqa: BLE001
        print(f"[bridge] sin LLM ({type(e).__name__}); usando lineas fijas")
LLM_ON = SERVER_LLM is not None


def user_llm(key, sess):
    """Cadena de ESTA peticion con la clave del jugador: Gemma 4 y, si falla o esta saturada, MiMo (ambos en AMD).
    La clave vive solo en estos objetos, que se descartan al terminar la peticion."""
    backends = [AMDBackend(model=AMD_MODEL, api_key=key, temperature=0.5, timeout=PRIMARY_TIMEOUT, retries=0,
                           min_interval=0.0)]
    if AMD_BACKUP_MODEL and AMD_BACKUP_MODEL.lower() != "none" and AMD_BACKUP_MODEL != AMD_MODEL:
        backends.append(AMDBackend(model=AMD_BACKUP_MODEL, api_key=key, temperature=0.5, timeout=30.0, retries=1,
                                   min_interval=0.0))
    llm = FailoverBackend(backends, state=sess["llm_state"])  # solo recuerda que modelo fallo (sin claves)
    llm.shots = 2
    return llm


def check_key(key):
    """Prueba la clave con una llamada minima a cada modelo. Devuelve el resultado, nunca la clave."""
    out = {"ok": False, "gemma": False, "backup": False, "reason": None}
    probe = [{"role": "user", "content": "Say OK."}]
    results = {}

    def run(field, model):  # los dos modelos se prueban a la vez: la espera es la del mas lento, no la suma
        try:
            AMDBackend(model=model, api_key=key, timeout=15.0, retries=0, min_interval=0.0).complete(probe, max_tokens=8)
            results[field] = None
        except APIError as e:
            results[field] = str(e)
        except Exception as e:  # noqa: BLE001
            results[field] = type(e).__name__

    threads = [threading.Thread(target=run, args=(f, m), daemon=True)
               for f, m in (("gemma", AMD_MODEL), ("backup", AMD_BACKUP_MODEL)) if m and m.lower() != "none"]
    for t in threads:
        t.start()
    for t in threads:
        t.join(25)
    for field, err in results.items():
        if err is None:
            out[field] = True
        elif err.startswith(("HTTP 401", "HTTP 403")):
            out["reason"] = "AMD rejected this key (invalid, expired or without access to Token Factory)."
            return out
        elif out["reason"] is None:
            out["reason"] = ("AMD Token Factory did not answer in time." if "timed out" in err.lower() or "network" in err.lower()
                             else "A model is not available right now.")
    out["ok"] = out["gemma"] or out["backup"]
    if out["ok"]:
        out["reason"] = None if out["gemma"] else "Gemma 4 is not available now; MiMo (also on AMD) will answer."
    return out


# ---------------------------------------------------------------- estado, limites y estadisticas
_lock = threading.Lock()
_SECRET = secrets.token_bytes(32)  # firma los ids de sesion; cambia en cada arranque (las sesiones tambien se pierden)
_sessions = OrderedDict()   # sid -> {"engine", "lock", "hits", "llm_calls", "llm_state", "seen"}
_ip_hits = {}               # ip -> deque de tiempos
_key_hits = {}              # ip -> deque de tiempos (prueba de clave)
_budget = {"day": time.strftime("%Y-%m-%d"), "used": 0}
_inflight = [0]
_started = time.time()
_stats = {"requested": 0, "failed": 0, "by_provider": {}}  # lineas que el motor pidio al modelo y quien las escribio


def record_line(allowed, engine_asked, provider):
    """Cuenta quien escribio cada linea que el motor pidio al modelo (para /api/stats)."""
    if not (allowed and engine_asked):
        return
    with _lock:
        _stats["requested"] += 1
        if provider is None:
            _stats["failed"] += 1  # fallaron todos los modelos: linea fija
        else:
            _stats["by_provider"][provider] = _stats["by_provider"].get(provider, 0) + 1


def stats_snapshot():
    """Reparto de lineas por proveedor desde el ultimo arranque (en memoria: se reinicia con cada despliegue)."""
    with _lock:
        by, requested, failed = dict(_stats["by_provider"]), _stats["requested"], _stats["failed"]
    answered = sum(by.values())
    amd = sum(n for p, n in by.items() if p.startswith("AMD Token Factory"))
    gemma_amd = sum(n for p, n in by.items() if p.startswith("AMD Token Factory") and "Gemma" in p)
    pct = lambda a, b: round(100.0 * a / b, 1) if b else None
    return {
        "since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(_started)),
        "uptime_s": int(time.time() - _started),
        "lines_requested_from_models": requested,
        "answered_by_a_model": answered,
        "canned_after_all_failed": failed,
        "by_provider": by,
        "answered_on_amd": amd,
        "amd_share_pct": pct(amd, answered),
        "gemma_on_amd_share_pct": pct(gemma_amd, answered),
        "outside_amd": answered - amd,
    }


def _new_engine():
    e = AffektEngine(llm=STUB)
    e.initialize_modules()
    e.running = True
    return e


def get_session(sid):
    """Una sesion = un motor propio (memoria y humor de los NPC no se mezclan entre jugadores)."""
    now = time.time()
    with _lock:
        for k in [k for k, v in _sessions.items() if now - v["seen"] > SESSION_TTL]:
            _sessions.pop(k, None)
        s = _sessions.get(sid)
        if s is None:
            while len(_sessions) >= MAX_SESSIONS:
                _sessions.popitem(last=False)
            s = {"engine": _new_engine(), "lock": threading.Lock(), "hits": deque(), "llm_calls": 0,
                 "llm_state": {}, "seen": now}
            _sessions[sid] = s
        s["seen"] = now
        _sessions.move_to_end(sid)
        return s


def _rate_ok(q, limit, window=60.0):
    now = time.time()
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


def ip_ok(ip):
    with _lock:
        if len(_ip_hits) > 5000:
            _ip_hits.clear()
        return _rate_ok(_ip_hits.setdefault(ip, deque()), IP_PER_MIN)


def key_check_ok(ip):
    with _lock:
        if len(_key_hits) > 5000:
            _key_hits.clear()
        return _rate_ok(_key_hits.setdefault(ip, deque()), KEY_CHECK_PER_MIN)


def reserve_llm(sess, have_llm):
    """True si esta peticion puede llamar a un modelo; si no, el motor responde con lineas fijas."""
    if FORCE_STUB or not have_llm:
        return False
    with _lock:
        if sess["llm_calls"] >= SESSION_LLM_MAX or _inflight[0] >= MAX_INFLIGHT_LLM:
            return False
        if not BYOK:  # el tope diario protege las claves del servidor; con clave propia no hace falta
            today = time.strftime("%Y-%m-%d")
            if _budget["day"] != today:
                _budget.update(day=today, used=0)
            if _budget["used"] >= DAILY_LLM_CAP:
                return False
            _budget["used"] += 1
        sess["llm_calls"] += 1
        _inflight[0] += 1
        return True


def npc_state(eng, npc_id):
    s = eng.personality_for(npc_id).get_state()
    node = eng.graph.get_node(npc_id)
    s["name"] = node.properties.get("name", npc_id) if node else npc_id
    mem = [e["data"].get("description", "") for e in eng.memory.get_medium_term_context(npc_id)]
    s["memory"] = mem[-5:]
    return s


def act(sess, npc_id, text, hour=None, key=None):
    """El jugador le dice `text` (texto libre, en ingles) a un NPC; responde el motor Affekt."""
    if not isinstance(text, str) or not isinstance(npc_id, str):
        raise ValueError("bad input")
    text = text.strip()[:MAX_TEXT]
    if npc_id not in NPC_IDS or not text:
        raise ValueError("empty NPC id or text")
    eng = sess["engine"]
    with sess["lock"]:
        # hora local del jugador (la manda el navegador): los NPC saludan segun sea de manana, tarde o noche
        if isinstance(hour, (int, float)) and not isinstance(hour, bool) and 0 <= hour < 24:
            eng.set_time_of_day(hour)
        llm = (user_llm(key, sess) if key else None) if BYOK else SERVER_LLM
        use_llm = reserve_llm(sess, llm is not None)
        eng.llm = llm if use_llm else STUB
        if use_llm:
            llm.clear_last()
        try:
            res = eng.process_action(npc_id, SHORTCUTS.get(text, text))
        finally:
            eng.llm = STUB  # la clave no se queda colgada del motor de la sesion
            if use_llm:
                with _lock:
                    _inflight[0] -= 1
        # quien redacto la linea (None = linea fija: sin clave, modelos caidos o tope de uso)
        provider = llm.last_provider() if use_llm else None
        record_line(use_llm, bool(res.get("llm_used")), provider)  # res["llm_used"] aun es lo que decidio el motor
        res["provider"] = provider
        res["llm_used"] = provider is not None
        res["line"] = res.pop("response")  # linea del NPC: la redacta el modelo o, si falla, una linea fija segun su humor
        res["npc"] = npc_state(eng, npc_id)
        return res


SEC_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "frame-ancestors " + FRAME_ANCESTORS + "; default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
                               "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'; worker-src 'self' blob:; connect-src 'self'",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "Affekt"
    sys_version = ""

    def _ip(self):
        if TRUST_PROXY:
            fwd = self.headers.get("X-Forwarded-For", "")
            if fwd:
                return fwd.split(",")[-1].strip()  # ultimo salto: el que anade nuestro proxy
        return self.client_address[0]

    def _headers(self, extra=None):
        for k, v in SEC_HEADERS.items():
            self.send_header(k, v)
        if ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
            self.send_header("Vary", "Origin")
        for k, v in (extra or {}).items():
            self.send_header(k, v)

    def _send(self, code, obj, extra=None):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._headers(extra)
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def _mac(token):
        return hmac.new(_SECRET, token.encode(), hashlib.sha256).hexdigest()[:16]

    def _valid_sid(self, v):
        return (len(v) == 48 and all(c in "0123456789abcdef" for c in v)
                and hmac.compare_digest(v[32:], self._mac(v[:32])))

    def _sid(self):
        """(sid, cabecera Set-Cookie | None). El id lo emite y firma el servidor: uno inventado no sirve.
        Llega por la cabecera X-Sid o por cookie."""
        v = self.headers.get("X-Sid", "").strip()
        if self._valid_sid(v):
            return v, None
        for part in self.headers.get("Cookie", "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == "sid" and self._valid_sid(v):
                return v, None
        token = secrets.token_hex(16)
        sid = token + self._mac(token)
        flags = "Path=/; HttpOnly; Max-Age=86400" + ("; SameSite=None; Secure; Partitioned" if TRUST_PROXY else "; SameSite=Lax")
        return sid, {"Set-Cookie": f"sid={sid}; {flags}"}

    def _key(self):
        """Clave del jugador (cabecera X-AMD-Key) o None. Una clave con forma rara se rechaza: no se reenvia a ningun sitio."""
        v = self.headers.get("X-AMD-Key", "").strip()
        if not v:
            return None
        if not KEY_RE.match(v):
            raise ValueError("bad key")
        return v

    def do_OPTIONS(self):
        self.send_response(204)
        if ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Sid, X-AMD-Key")
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self._headers()
        self.end_headers()

    def _static(self):
        if not os.path.isdir(DIST):
            return self._send(404, {"error": "not found"})
        rel = self.path.split("?", 1)[0].split("#", 1)[0].lstrip("/") or "index.html"
        full = os.path.abspath(os.path.join(DIST, rel))
        name = os.path.basename(full)
        if (not full.startswith(DIST + os.sep) or name in BLOCKED_STATIC
                or name.startswith(".") or not os.path.isfile(full)):
            return self._send(404, {"error": "not found"})
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(full)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        # el HTML siempre se revalida (apunta a los .js con hash de cada version); los assets con hash, no cambian
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if rel.startswith("assets/") else "no-cache")
        self._headers()
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/healthz":
            return self._send(200, {"ok": True})
        if path == "/api/stats":  # sin datos de jugadores ni claves: solo cuentas por proveedor
            if not ip_ok(self._ip()):
                return self._send(429, {"error": "too many requests"})
            return self._send(200, stats_snapshot())
        if path in ("/api/state", "/api/session/export"):
            if not ip_ok(self._ip()):
                return self._send(429, {"error": "too many requests"})
            sid, cookie = self._sid()
            sess = get_session(sid)
            eng = sess["engine"]
            if path == "/api/state":
                return self._send(200, {"npcs": {i: npc_state(eng, i) for i in NPC_IDS},
                                        "graph_nodes": len(eng.graph.nodes), "byok": BYOK,
                                        "llm": LLM_ON and not FORCE_STUB, "sid": sid}, cookie)
            with sess["lock"]:
                state = export_state(eng)
            extra = dict(cookie or {})
            extra["Content-Disposition"] = 'attachment; filename="affekt-session.json"'
            return self._send(200, state, extra)
        if path.startswith("/api/"):
            return self._send(404, {"error": "not found"})
        self._static()

    def do_POST(self):
        try:
            path = self.path.split("?", 1)[0]
            if path not in ("/api/action", "/api/key/check", "/api/session/import"):
                return self._send(404, {"error": "not found"})
            ip = self._ip()
            if not ip_ok(ip):
                return self._send(429, {"error": "too many requests"})
            n = int(self.headers.get("Content-Length", 0))
            if n < 0 or n > (MAX_IMPORT if path == "/api/session/import" else MAX_BODY):
                return self._send(413, {"error": "payload too large"})
            raw = self.rfile.read(n) if n else b""
            sid, cookie = self._sid()

            if path == "/api/key/check":
                key = self._key()
                if key is None:
                    raise ValueError("no key")
                if not key_check_ok(ip):
                    return self._send(429, {"error": "too many key checks, wait a minute"}, cookie)
                return self._send(200, check_key(key), cookie)

            data = json.loads(raw or b"{}")
            sess = get_session(sid)
            if path == "/api/session/import":
                try:
                    with sess["lock"]:
                        info = import_state(sess["engine"], data)
                        npcs = {i: npc_state(sess["engine"], i) for i in NPC_IDS}
                except StateError as e:
                    return self._send(400, {"error": "invalid session file", "detail": str(e)[:160]}, cookie)
                return self._send(200, {"ok": True, "info": info, "npcs": npcs, "sid": sid}, cookie)

            if not isinstance(data, dict):
                raise ValueError("bad input")
            with _lock:
                ok = _rate_ok(sess["hits"], SESSION_PER_MIN)
            if not ok:
                return self._send(429, {"error": "slow down", "sid": sid}, cookie)
            res = act(sess, data.get("npc_id"), data.get("text") or data.get("action"), data.get("hour"), self._key())
            res["sid"] = sid
            self._send(200, res, cookie)
        except ValueError:  # incluye JSON invalido y clave con forma rara
            self._send(400, {"error": "bad request"})
        except Exception as e:  # noqa: BLE001
            print(f"[bridge] error: {type(e).__name__}")  # sin detalles al cliente ni al log (rutas, claves)
            self._send(500, {"error": "server error"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Affekt bridge on http://{HOST}:{PORT}  mode={'BYOK (player brings an AMD Token Factory key)' if BYOK else 'server keys (dev)'}  "
          f"dist={'yes' if os.path.isdir(DIST) else 'no'}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
