/* Auditoría de código huérfano — sin dependencias.
 *
 * Cruza el marcado (index.html + las plantillas dentro de js/*.js) con las
 * hojas de estilos (css/app.css y la capa css/imprenta.css) y con el
 * despachador de acciones de js/app.js. Sirve para que un rediseño no deje
 * selectores, ids ni acciones sueltas: cada hallazgo es un candidato a borrar.
 *
 *   A) clases declaradas en el CSS que ya nadie menciona;
 *   B) clases del CSS que no aparecen en ningún class="…" (pueden vivir
 *      en plantillas dinámicas: revisar antes de borrar);
 *   C) clases del marcado sin regla en el CSS ni uso como selector;
 *   D) selectores de js/*.js (#id, .clase) sin destino en el marcado;
 *   E) ids del HTML que ningún script ni atributo consulta;
 *   F) data-action sin `case` que lo atienda;
 *   G) `case` sin ningún data-action que lo dispare;
 *   H) funciones declaradas en js/app.js sin uso;
 *   I) iconos de window.ICONS que nadie pide;
 *   J) variables CSS (--token) declaradas y nunca usadas;
 *   K) claves de window.LAYOUT que ningún helper consulta.
 *
 * Uso: npm run audit
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(resolve(root, p), 'utf8');

const html = await read('index.html');
const cssFiles = ['css/app.css'];
const css = (await Promise.all(cssFiles.map(read))).join('\n');
const jsNames = ['layout', 'render', 'pdf', 'sync', 'app'];
const jsTexts = await Promise.all(jsNames.map((n) => read('js/' + n + '.js')));
const jsAll = jsTexts.join('\n');
const appJs = jsTexts[jsTexts.length - 1];
const blob = html + '\n' + jsAll;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokenRe = (t) => new RegExp('(?<![\\w-])' + esc(t) + '(?![\\w-])');
// Fuera todo lo que no declara clases: comentarios, url(...) y cadenas.
const cssClean = css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/url\((?:[^)]*)\)/g, '')
  .replace(/"[^"]*"|'[^']*'/g, '');

/* ---------- A/B: clases declaradas en la hoja ---------- */
const declared = new Set();
for (const m of cssClean.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) declared.add(m[1]);

/* ---------- C: clases realmente usadas ---------- */
const usedInAttr = new Set();
for (const m of html.matchAll(/\bclass="([^"]*)"/g)) {
  for (const t of m[1].split(/\s+/)) if (t) usedInAttr.add(t);
}
// Selectores de clase: usan el nombre sin depender de una regla.
// (El selector puede ser compuesto: '#x [data-y], .clase [z]'.)
const selectorOnly = new Set();
const selectorCalls = /(?:\$\$?|querySelector(?:All)?|closest|matches|classList\s*\.\s*(?:add|remove|toggle|contains))\(\s*['"`]([^'"`]*)['"`]/g;
for (const src of jsTexts) {
  for (const m of src.matchAll(selectorCalls)) {
    for (const c of m[1].matchAll(/\.([\w-]+)/g)) selectorOnly.add(c[1]);
  }
  // class="…" dentro de plantillas: sólo la parte literal del atributo
  for (const m of src.matchAll(/class=\\?["'`]([^"'`\\]*)/g)) {
    for (const t of m[1].split(/[\s"'`+]/)) {
      if (/^[a-z][\w-]*[\w]$/.test(t) && t !== 'false' && t !== 'true') usedInAttr.add(t);
    }
  }
}
// Clases que se arman por concatenación: 'fig tone-' + (o.tone || 'accent')
const compuestas = new Set();
for (const m of jsAll.matchAll(/['"`]([\w-]+(?:\s+[\w-]+)*)-['"`]\s*\+/g)) {
  for (const t of m[1].split(/\s+/)) compuestas.add(t);
}

const viva = (c) => usedInAttr.has(c) || selectorOnly.has(c) || compuestas.has(c.split('-')[0]) || tokenRe(c).test(blob);
const cssNeverReferenced = [...declared].filter((c) => !viva(c)).sort();
const cssNotInClassAttr = [...declared]
  .filter((c) => !viva(c) === false && !usedInAttr.has(c) && tokenRe(c).test(blob)).sort();
const attrWithoutRule = [...usedInAttr]
  .filter((c) => !declared.has(c) && !selectorOnly.has(c) && /^[a-z][\w-]*$/.test(c)).sort();

/* ---------- D/E: identificadores ---------- */
const idsHtml = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const idsGenerated = new Set([...jsAll.matchAll(/id=\\?["'`]([^"'`\\]+)/g)].map((m) => m[1]));
const idsQueried = new Set();
for (const m of jsAll.matchAll(/\$\(\s*['"`](#[^'"`]+)['"`]/g)) idsQueried.add(m[1]);
for (const m of jsAll.matchAll(/\$\$\(\s*['"`]([^'"`]+)['"`]/g)) idsQueried.add(m[1]);
for (const m of jsAll.matchAll(/getElementById\(\s*['"`]([^'"`]+)['"`]/g)) idsQueried.add('#' + m[1]);
for (const m of jsAll.matchAll(/querySelector(?:All)?\(\s*['"`]([^'"`]+)['"`]/g)) idsQueried.add(m[1]);
const idsInBlob = new Set([...idsHtml, ...idsGenerated]);
const queriedMissing = [...idsQueried]
  .filter((s) => /^#[A-Za-z][\w-]*$/.test(s) && !idsInBlob.has(s.slice(1))).sort();
// Un id sigue vivo si algún script lo consulta o algún atributo lo apunta
// (for, aria-labelledby, aria-controls, headers…).
const htmlIdsUnused = [...idsHtml].filter((id) => {
  const re = new RegExp('["\'`#]' + esc(id) + '(?![\\w-])');
  if (re.test(jsAll)) return false;
  const enlaces = [...html.matchAll(/aria-(?:labelledby|describedby|controls|owns)="([^"]*)"/g)]
    .concat([...html.matchAll(/\bfor="([^"]*)"/g)])
    .map((m) => m[1]);
  return !enlaces.some((v) => v.split(/\s+/).includes(id));
}).sort();

/* ---------- F/G: acciones ---------- */
const actionsMarkup = new Set([...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]));
for (const m of appJs.matchAll(/data-action=\\?["'`]([a-z][\w-]*)/g)) actionsMarkup.add(m[1]);
const actionsCode = new Set([...appJs.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]));
const actionsNoHandler = [...actionsMarkup].filter((a) => !actionsCode.has(a)).sort();
// Muchas acciones se disparan desde plantillas: `case 'x'` está vivo si el
// nombre aparece además como dato en alguna llamada (actBtn('x', …)).
const mentions = (name) => (blob.match(new RegExp('[\'"`]' + esc(name) + '[\'"`]', 'g')) || []).length;
const actionsNoTrigger = [...actionsCode].filter((a) => mentions(a) < 2).sort();

/* ---------- I: iconos que nadie pide ---------- */
const iconos = [...jsAll.matchAll(/^\s{4}([a-zA-Z]+): function\(cls\) \{$/gm)].map((m) => m[1]);
const iconosSinUso = iconos.filter((n) => (jsAll.match(new RegExp('ICONS\\.' + esc(n) + '\\(', 'g')) || []).length === 0).sort();

/* ---------- J: variables CSS declaradas y nunca usadas ---------- */
const declaradas = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
const tokensSinUso = [...declaradas].filter((v) => !new RegExp('var\\(' + esc(v) + '\\)').test(css)).sort();

/* ---------- K: claves de LAYOUT que ningún helper consulta ---------- */
const layoutSrc = jsTexts[jsNames.indexOf('layout')];
const restoJs = jsNames.filter((n) => n !== 'layout').map((n) => jsTexts[jsNames.indexOf(n)]).join('\n');
const layoutKeys = [...layoutSrc.matchAll(/^\s{2}([a-zA-Z][\w]*):/gm)].map((m) => m[1])
  .filter((k) => !['pageW', 'pageH'].includes(k));
const usadasEnLayout = new Set([...layoutSrc.matchAll(/L\.([a-zA-Z][\w]*)/g)].map((m) => m[1]));
// Los colores se consultan por su gemelo «…Hex» (L.brand → L.brandHex).
const layoutSinUso = [...new Set(layoutKeys)]
  .filter((k) => !usadasEnLayout.has(k) && !usadasEnLayout.has(k + 'Hex'))
  .filter((k) => !new RegExp('L\\.' + esc(k) + '(?:Hex)?(?![\\w])').test(restoJs))
  .filter((k) => !new RegExp('LAYOUT\\.' + esc(k) + '(?:Hex)?(?![\\w])').test(restoJs))
  .sort();

/* ---------- H: funciones ---------- */
const fns = [...appJs.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
const fnsUnused = fns
  .filter((n) => (appJs.match(new RegExp('(?<![\\w$])' + esc(n) + '(?![\\w$])', 'g')) || []).length <= 1)
  .sort();

const sections = [
  ['A · Clases en CSS sin ninguna referencia', cssNeverReferenced],
  ['C · Clases del marcado sin regla en CSS ni uso como selector', attrWithoutRule],
  ['D · Selectores de js/*.js sin destino en el marcado', queriedMissing],
  ['E · ids del HTML que nadie consulta', htmlIdsUnused],
  ['F · data-action sin `case` que lo atienda', actionsNoHandler],
  ['G · `case` sin ningún data-action que lo dispare', actionsNoTrigger],
  ['H · Funciones de js/app.js sin uso', fnsUnused],
  ['I · Iconos de window.ICONS que nadie pide', iconosSinUso],
  ['J · Variables CSS declaradas y nunca usadas', tokensSinUso],
  ['K · Claves de window.LAYOUT que ningún helper consulta', layoutSinUso],
];

let hallazgos = 0;
for (const [titulo, lista] of sections) {
  hallazgos += lista.length;
  console.log('\n' + titulo + ' (' + lista.length + ')');
  console.log(lista.length ? '  ' + lista.join(', ') : '  — sin hallazgos —');
}
// Informativo: estas clases no se escriben en el marcado porque las pone
// el script en tiempo de ejecución (estado, modales abiertos, sync…).
console.log('\nB · Clases que sólo activa el script (informativo, no se borran) (' + cssNotInClassAttr.length + ')');
console.log('  ' + cssNotInClassAttr.join(', '));
console.log('\nTotal de hallazgos: ' + hallazgos);
process.exitCode = hallazgos ? 1 : 0;
