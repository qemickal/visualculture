/* Service Worker — caché offline.
 *
 * OJO: el HTML, el CSS y los JS se sirven «primero la red» (networkFirst).
 * Antes eran cache-first, así que al actualizar la hoja de estilos el
 * celular seguía mostrando la versión vieja (de ahí que un arreglo de
 * diseño «no se viera nunca»). Con esto: si hay internet se baja la
 * versión nueva y se refresca la caché; si no hay, se usa la caché.
 * Los demás assets (fuentes, logo, íconos) siguen cache-first.
 */
const CACHE = 'mc-pwa-v105';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/layout.js',
  './js/render.js',
  './js/pdf.js',
  './js/sync.js',
  './js/app.js',
  // El motor de PDF se guarda aquí para que «Enviar» funcione sin señal,
  // pero la app ya NO lo carga al arrancar: lo pide solo cuando hace falta.
  './assets/js/jspdf.umd.min.js',
  // Montserrat variable: la voz de la interfaz desde la v14.
  './assets/fonts/montserrat-latin-variable.woff2',
  // Archivo se queda para la vista previa del recibo (el PDF la incrusta).
  './assets/fonts/archivo-latin-400.woff2',
  './assets/fonts/archivo-latin-500.woff2',
  './assets/fonts/archivo-latin-700.woff2',
  // Fuentes del PDF: listas también para la primera exportación offline.
  './assets/fonts/Archivo-Light.ttf',
  './assets/fonts/Archivo-Regular.ttf',
  './assets/fonts/Archivo-Medium.ttf',
  './assets/fonts/Archivo-Bold.ttf',
  './assets/img/logo-clerki.svg',
  './assets/img/marca-clerki.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './manifest.webmanifest',
];

/* Lo que define la interfaz: siempre fresco cuando hay red. */
const SIEMPRE_FRESCO = /(\.html$|\.css$|\.js$|^\/$|\/index\.html$)/i;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function guardar(req, res) {
  if (!res || res.status !== 200 || res.type !== 'basic') return;
  const clone = res.clone();
  caches.open(CACHE).then((c) => c.put(req, clone));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   // externos: sin intervenir
  if (url.pathname.startsWith('/api/')) return;      // datos privados: sin caché ni respaldo HTML

  if (req.mode === 'navigate' || SIEMPRE_FRESCO.test(url.pathname)) {
    e.respondWith(
      fetch(req)
        .then((res) => { guardar(req, res); return res; })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => { guardar(req, res); return res; })
        .catch(() => caches.match('./index.html'));
    })
  );
});
