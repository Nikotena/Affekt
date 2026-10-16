import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { resolve } from 'node:path';

const PUBLIC = path.resolve('public');
const safe = (n) => String(n).replace(/[^\w.-]/g, '_');

// public/maps/index.json: lista de mapas, para que el juego encuentre la pareja de cada salida por ID.
function writeMapIndex() {
  const dir = path.join(PUBLIC, 'maps');
  if (!fs.existsSync(dir)) return;
  const maps = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => f.slice(0, -5)).sort();
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ maps }));
}

// API solo para desarrollo: el editor de mapas guarda mapas y tilesets en /public.
function editorApi() {
  return {
    name: 'affekt-editor-api',
    buildStart: writeMapIndex,
    configureServer(server) {
      writeMapIndex();
      server.middlewares.use('/editor-api', (req, res) => {
        const url = new URL(req.url, 'http://x');
        const parts = url.pathname.split('/').filter(Boolean); // [kind, name?]
        const json = (o, code = 200) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(o));
        };
        const list = (dir, ext) => {
          const d = path.join(PUBLIC, dir);
          return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(ext)) : [];
        };
        if (req.method === 'GET' && parts[0] === 'maps') return json(list('maps', '.json').filter((f) => f !== 'index.json').map((f) => f.slice(0, -5)));
        if (req.method === 'GET' && parts[0] === 'tilesets') return json(list('tilesets', '.png'));
        if (req.method === 'POST' && (parts[0] === 'map' || parts[0] === 'tileset') && parts[1]) {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            const isMap = parts[0] === 'map';
            const dir = path.join(PUBLIC, isMap ? 'maps' : 'tilesets');
            fs.mkdirSync(dir, { recursive: true });
            const name = safe(parts[1]).replace(/\.(json|png)$/, '') + (isMap ? '.json' : '.png');
            fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
            if (isMap) writeMapIndex();
            json({ ok: true, name });
          });
          return;
        }
        json({ error: 'not found' }, 404);
      });
    },
  };
}

// El juego habla con Affekt_core (Affekt) a través de server/server.py (puerto 8765).
export default defineConfig({
  plugins: [editorApi()],
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: resolve('index.html'), editor: resolve('editor.html') } },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8765' },
  },
});
