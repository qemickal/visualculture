/* Servidor local sin dependencias. No sustituye las Functions de Vercel.
 * npm run dev: interfaz real, con puerta de cuenta.
 * npm run preview: demo aislada con datos de ejemplo, sin backend ni SW.
 * En la demo, ?auth=1 permite inspeccionar también la pantalla de acceso.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo');
const port = Number(process.env.PORT || 3000);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://dev.invalid');
    const path = decodeURIComponent(url.pathname);
    res.setHeader('Cache-Control', 'no-store');
    if (path.startsWith('/api/')) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'SERVIDOR', message: 'El servidor local no incluye Postgres. Usa npm run preview para explorar la demo o Vercel para la cuenta real.' }));
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    const isHTML = path === '/' || path === '/index.html';
    const isDemoScript = demo && path === '/__preview/demo.js';
    // `/docs/` sólo lleva páginas de apoyo (capturas y pruebas de diseño); el
    // servidor de desarrollo también las deja ver para no abrir otro proceso.
    const allowed = isHTML || isDemoScript || /^(\/css\/|\/js\/|\/assets\/|\/icons\/|\/docs\/|\/sw\.js$|\/manifest\.webmanifest$)/.test(path);
    if (!allowed) { res.writeHead(404); res.end('No encontrado'); return; }
    const file = resolve(root, isHTML ? 'index.html' : isDemoScript ? 'scripts/demo-data.js' : '.' + path);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    let body = await readFile(file);
    if (isHTML && demo && !url.searchParams.has('auth')) {
      body = Buffer.from(body.toString().replace('<script src="js/sync.js"></script>', '<script src="/__preview/demo.js"></script>'));
    }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end('No se pudo abrir el archivo');
  }
});
server.listen(port, '0.0.0.0', () => {
  console.log(`In-Voice · ${demo ? 'Vista previa con datos de ejemplo' : 'Interfaz real'} · http://0.0.0.0:${port}`);
  if (demo) console.log('La demo guarda sus cambios en un espacio local separado y no llama a ninguna API. Acceso: /?auth=1');
});
