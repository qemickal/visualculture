/* Generador de los iconos de la PWA a partir de la marca en SVG.
 *
 *   node scripts/icons.mjs [fuente.svg]
 *
 * Por defecto usa assets/img/marca-clerki.svg (la llama monocroma).
 * Desde la v13 el icono es la ficha Oxford con la llama en blanco: el
 * azul del texto de la app, así el icono del móvil y la interfaz se
 * reconocen de un vistazo.
 *
 *   icons/icon-192.png            icono "any"      (ficha Oxford)
 *   icons/icon-512.png            icono "any"      (ficha Oxford)
 *   icons/icon-180.png            apple-touch-icon (ficha Oxford opaca:
 *                                                   iOS no admite alfa)
 *   icons/icon-maskable-512.png   icono "maskable" (Oxford a sangre, llama
 *                                                   dentro de la zona segura)
 *
 * Después de regenerarlos hay que subir la versión de la caché en sw.js
 * (const CACHE = 'mc-pwa-vNN') o el móvil seguirá mostrando los iconos viejos.
 *
 * Requiere sharp:  npm install --save-dev sharp
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, process.argv[2] || 'assets/img/marca-clerki.svg');

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch (err) {
  console.error('Falta sharp. Instálalo con:  npm install --save-dev sharp');
  process.exit(1);
}

/* ---------- El logo: viewBox -> tamaño en píxeles ---------- */
const svgRaw = await readFile(source, 'utf8');
const viewBox = svgRaw.match(/viewBox="([^"]+)"/);
if (!viewBox) {
  console.error('El SVG de origen no tiene viewBox; no se puede dimensionar.');
  process.exit(1);
}
const [, , vw, vh] = viewBox[1].trim().split(/\s+/).map(Number);
const aspect = vw / vh;

/* Se fuerza width/height en el <svg> raíz para que librsvg lo dibuje
   al tamaño exacto que queremos. */
function sizedSvg(px) {
  const w = Math.round(px * aspect);
  const h = Math.round(px);
  const out = svgRaw.replace(
    /<svg([^>]*)>/,
    (_m, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${w}" height="${h}">`
  );
  return { buf: Buffer.from(out), w, h };
}

/* Renderiza el logo a un tamaño exacto: se dibuja con densidad alta
   (para que no pierda detalle al escalar) y luego se ajusta al píxel. */
async function renderLogo(px) {
  const { buf, w, h } = sizedSvg(px);
  return sharp(buf, { density: 600 }).resize(w, h, { fit: 'fill' }).png().toBuffer();
}

/* ---------- Fondos ----------
   La ficha Oxford de la marca. Es opaca a propósito: iOS pinta de negro
   cualquier apple-touch-icon con transparencia, y los lanzadores de
   Android ponen su propio disco detrás de un icono transparente. */
const FICHA = '#081C30';

function fondoFicha(size) {
  return sharp({
    create: { width: size, height: size, channels: 4, background: FICHA },
  }).png().toBuffer();
}

/* La llama del SVG viene en tinta. Sobre la ficha oscura se invierte a
   blanco: `negate` con `alpha:false` respeta el recorte del dibujo. */
async function llamaEnBlanco(px) {
  return sharp(await renderLogo(px)).negate({ alpha: false }).png().toBuffer();
}

/* ---------- Generadores ---------- */
async function iconoAny(size, altoRelativo) {
  const logo = await renderLogo(size * altoRelativo);
  const meta = await sharp(logo).metadata();
  // La llama se centra en el lienzo (su alto define el margen).
  const left = Math.round((size - meta.width) / 2);
  const top = Math.round((size - meta.height) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: logo, left, top }])
    .png()
    .toBuffer();
}

async function iconoSobreFondo(size, altoRelativo, fondo) {
  const logo = await llamaEnBlanco(size * altoRelativo);
  const meta = await sharp(logo).metadata();
  const left = Math.round((size - meta.width) / 2);
  const top = Math.round((size - meta.height) / 2);
  return sharp(await fondo(size))
    .composite([{ input: logo, left, top }])
    .png()
    .toBuffer();
}

/* La zona segura de un icono maskable es un círculo de diámetro 80% del
   lienzo (radio 40%). En vez de estimarlo con la caja del dibujo —que
   desperdicia espacio porque la llama no llena su rectángulo— se mide la
   forma real: se renderiza, se busca el píxel opaco más lejano del centro
   y se escala para que quepa dentro del círculo con un margen de seguridad.
   Así funciona con cualquier logo, sea alto, ancho o irregular. */
async function altoQueCabeEnZonaSegura(size) {
  const ref = await sharp(sizedSvg(size * 0.9).buf, { density: 300 })
    .resize(Math.round(size * 0.9 * aspect), Math.round(size * 0.9), { fit: 'fill' })
    .png().toBuffer();
  const meta = await sharp(ref).metadata();
  const { data } = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{
      input: ref,
      left: Math.round((size - meta.width) / 2),
      top: Math.round((size - meta.height) / 2),
    }])
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  let maxRadio = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * 4 + 3] < 128) continue;
      const r = Math.hypot(x - size / 2, y - size / 2);
      if (r > maxRadio) maxRadio = r;
    }
  }
  if (!maxRadio) return 0.8;
  const radioSeguro = size * 0.40 * 0.95;   // 5% de margen
  const factor = radioSeguro / maxRadio;    // el render de referencia usa 0.9
  return Math.min(0.9, 0.9 * factor);
}

const ALTO_MASKABLE = await altoQueCabeEnZonaSegura(512);

const salidas = [
  ['icons/icon-192.png', 192, await iconoSobreFondo(192, 0.52, fondoFicha)],
  ['icons/icon-512.png', 512, await iconoSobreFondo(512, 0.52, fondoFicha)],
  // iOS exige fondo opaco: la ficha Oxford lo es por definición.
  ['icons/icon-180.png', 180, await iconoSobreFondo(180, 0.54, fondoFicha)],
  // Maskable: la llama cabe dentro del círculo seguro del 80 %.
  ['icons/icon-maskable-512.png', 512, await iconoSobreFondo(512, ALTO_MASKABLE, fondoFicha)],
];

for (const [rel, size, buf] of salidas) {
  await writeFile(resolve(root, rel), buf);
  console.log(`${rel}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}

console.log('\nListo. Si cambiaste el logo, sube la versión de la caché en sw.js.');
