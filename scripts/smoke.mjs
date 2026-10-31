/* Prueba de humo sin navegador — arnés de DOM con jsdom.
 *
 * Carga la interfaz real (index.html + js/*.js) sobre datos de ejemplo y
 * recorre lo que más duele si se rompe: que el panel pinte, que las vistas
 * naveguen, que la búsqueda global encuentre, que el editor recalcule y que
 * salir de un borrador vacío no deje basura en el archivo.
 *
 * No sustituye abrir la app en un navegador: jsdom no aplica CSS ni pinta.
 * Cubre la lógica, no el aspecto.
 *
 *   npm run smoke     (requiere `npm install`, jsdom es dependencia de desarrollo)
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => readFile(resolve(root, p), 'utf8');

const errores = [];
const fallos = [];
const virtualConsole = new VirtualConsole();
// jsdom no implementa canvas (lo usa render.js para medir textos) ni
// scrollIntoView: son ruido del entorno, no fallos de la app.
const ruido = /HTMLCanvasElement|Not implemented|Could not parse CSS|scrollIntoView/;
virtualConsole.on('jsdomError', (e) => {
  const m = String(e.stack || e.message);
  if (!ruido.test(m)) errores.push(m.split('\n')[0]);
});

const dom = new JSDOM(await leer('index.html'), {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(w) {
    w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
    w.cancelAnimationFrame = (id) => clearTimeout(id);
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.Element.prototype.scrollIntoView = function () {};
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.fetch = () => Promise.reject(new Error('sin red en la prueba'));
    w.confirm = () => true;
    w.prompt = () => null;
  },
});
const { window } = dom;
const doc = window.document;

// jsdom no persigue las rutas relativas de <script>: se inyectan a mano.
// demo-data.js ocupa el lugar de sync.js, igual que hace `npm run preview`.
for (const f of ['js/layout.js', 'js/render.js', 'js/pdf.js', 'scripts/demo-data.js', 'js/app.js']) {
  const s = doc.createElement('script');
  s.textContent = await leer(f);
  doc.body.appendChild(s);
}
const esperar = (ms = 40) => new Promise((r) => setTimeout(r, ms));
await esperar(250);

const q = (s) => doc.querySelector(s);
const todos = (s) => doc.querySelectorAll(s).length;
const click = (sel) => { const e = q(sel); if (!e) throw new Error('no existe ' + sel); e.click(); return esperar(); };
const tecla = (key, init = {}) => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...init }));

/* Cada comprobación anota «ok» o acumula un fallo. */
async function check(nombre, fn) {
  try {
    const detalle = await fn();
    if (detalle === false) fallos.push(nombre);
    else console.log('  ✓ ' + nombre + (typeof detalle === 'string' ? ' — ' + detalle : ''));
  } catch (e) {
    fallos.push(nombre + ' (' + e.message + ')');
    console.log('  ✗ ' + nombre + ' — ' + e.message);
  }
}

console.log('\nPanel de inicio');
await check('la vista de inicio es la de arranque', () => !q('#view-inicio').hidden && q('#view-list').hidden);
await check('el saldo por cobrar se calcula', () => q('#hero-balance-value').textContent.trim() !== '$0.00' && q('#hero-balance-value').textContent.trim());
await check('las tres cifras del mes están', () => todos('#stat-grid .fig') === 3);
await check('la dona de cobranza se dibuja', () => todos('#hero-chart-host .donut') === 1);
await check('«Tu siguiente paso» tiene contenido', () => todos('#todo-host .todo-row') > 0);

console.log('\nBúsqueda global');
await click('[data-action="open-cmdk"]');
await check('se abre con el botón de la barra', () => !q('#cmdk').hidden);
await check('ofrece acciones y recientes al abrir', () => todos('#cmdk-list .cmdk-item') > 0);
const campo = q('#cmdk-input');
const buscar = async (t) => { campo.value = t; campo.dispatchEvent(new window.Event('input', { bubbles: true })); await esperar(); };
await buscar('alba');
await check('encuentra en documentos, directorio y tareas', () => todos('#cmdk-list .cmdk-item') >= 3 && todos('#cmdk-list .cmdk-item') + ' resultados');
await buscar('cotizacion');
await check('busca sin acentos', () => todos('#cmdk-list .cmdk-item') > 0);
await buscar('zzzznada');
await check('avisa cuando no hay resultados', () => !!q('#cmdk-list .cmdk-empty'));
await buscar('');
tecla('ArrowDown');
await check('la selección sigue al teclado', () => !!q('#cmdk-list .cmdk-item[aria-selected="true"]'));
tecla('Escape');
await esperar();
await check('se cierra con Escape', () => q('#cmdk').hidden);

console.log('\nDocumentos');
await click('[data-action="go-docs"]');
const totalDocs = todos('#doc-list .row');
await check('lista los documentos', () => totalDocs > 0 && totalDocs + ' documentos');
await click('.chip[data-status="pendiente"]');
await check('el filtro por estado reduce la lista', () => todos('#doc-list .row') < totalDocs);
await click('.chip[data-status="todos"]');
await click('.chip[data-filter="cotizacion"]');
await check('el filtro por tipo reduce la lista', () => todos('#doc-list .row') < totalDocs);
await click('.chip[data-filter="todos"]');

console.log('\nEditor');
await click('#doc-list .row [data-action="edit"]');
await check('abre el documento elegido', () => !q('#view-editor').hidden && q('#editor-mode-label').textContent);
const proyecto = q('#f-proyecto');
proyecto.value = 'Proyecto de prueba';
proyecto.dispatchEvent(new window.Event('input', { bubbles: true }));
await esperar(80);
await check('recalcula los totales al escribir', () => q('#t-total').textContent.trim() !== '$0.00' && q('#t-total').textContent.trim());
await check('pinta la vista previa', () => q('#preview-inner').children.length > 0);
await click('[data-action="back"]');

console.log('\nBorradores vacíos');
await click('[data-action="go-docs"]');
const antes = todos('#doc-list .row');
await click('[data-action="new-recibo"]');
await check('«Nuevo recibo» abre el editor', () => !q('#view-editor').hidden);
await click('[data-action="go-home"]');
await click('[data-action="go-docs"]');
await check('un borrador sin tocar no se guarda', () => todos('#doc-list .row') === antes && antes + ' documentos');

console.log('\nResto de vistas');
for (const [vista, id] of [['Por cobrar', 'cxc'], ['Por pagar', 'cxp'], ['Directorio', 'clientes'], ['Catálogo', 'productos'], ['Tareas', 'tareas']]) {
  await check(vista + ' navega', async () => {
    await click('[data-action="go-' + id + '"]');
    return !q('#view-' + id).hidden;
  });
}

console.log('\n' + (fallos.length || errores.length ? 'FALLOS' : 'Todo correcto'));
if (fallos.length) console.log('  comprobaciones fallidas:\n   - ' + fallos.join('\n   - '));
if (errores.length) console.log('  errores de JavaScript:\n   - ' + errores.join('\n   - '));
console.log('');
process.exitCode = fallos.length || errores.length ? 1 : 0;
