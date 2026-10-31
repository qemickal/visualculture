/* ============================================================
   LAYOUT — especificación única del diseño del documento
   Todas las medidas en puntos (pt). Página Letter 612 x 792 pt.
   Rediseño 2026: cabecera a dos líneas alineada con el logo,
   columna de totales con DESCUENTO / POR PAGAR, bloque P.O. TRACK
   con estado, PAGOS + TÉRMINOS a dos columnas y pie de contacto.

   v4.0: el documento es monocromo. Los acentos se hacen con
   NEGRITA (peso), no con color, y el folio ya no lleva código de
   barras: se imprime como texto, grande y alineado a la derecha.
   ============================================================ */
window.LAYOUT = {
  pageW: 612,
  pageH: 792,

  /* ---------- Paleta: tinta, no color ----------
     Los nombres se conservan (los usan render.js y pdf.js), pero los
     valores son una escala de grises: lo que destaca lo hace por su
     PESO, no por su color. */
  brand:     [20, 27, 38],    // #141B26  titulares y etiquetas (negrita)
  brandHex:  '#141B26',
  steel:     [62, 72, 86],    // #3E4856  etiquetas secundarias
  steelHex:  '#3E4856',
  turq:      [20, 27, 38],    // #141B26  estado liquidado (negrita)
  turqHex:   '#141B26',
  grey:      [126, 136, 150], // #7E8896  subtítulos y notas
  greyHex:   '#7E8896',
  body:      [51, 58, 71],    // #333A47  cuerpo de texto
  bodyHex:   '#333A47',
  lineArt:   [222, 228, 235], // #DEE4EB  fondo de líneas
  lineArtHex:'#DEE4EB',
  rule:      [168, 176, 188], // #A8B0BC  reglas finas
  ruleHex:   '#A8B0BC',

  // márgenes laterales simétricos: 34pt a cada lado
  contentL: 34,
  contentR: 578,

  /* ---------- Marca de agua + fondo de líneas ---------- */
  // Lettering pálido anclado arriba a la derecha (se recorta con la hoja).
  // Se dibuja con el propio logo escalado y muy poca opacidad: el PNG
  // antiguo traía el texto del diseño anterior incrustado.
  watermark: { x: 330, y: -54, w: 430, h: 281, opacity: 0.055 },
  // string-art: envolvente de rectas, esquina inferior izquierda
  lineArtBox: { x: -30, y: 340, w: 672, h: 460 },

  /* ---------- Cabecera ----------
     El logo manda: el nombre de la empresa arranca justo a su derecha
     (misma sangría para las dos líneas) y el bloque queda centrado
     ópticamente contra el alto del logo. */
  logoBox:    { x: 34, y: 28, w: 76, h: 58 },
  brandLine1: { x: 126, y: 56, size: 19 },     // "MONO CROMAT & CO."
  // El subtítulo baja a su propia línea: ya no se encima al nombre.
  brandSlash: { x: 126, y: 72, size: 9.5 },    // "// estudio creativo"
  // Folio (arriba a la derecha), sin código de barras: rótulo chico
  // sobre el número en negrita. El prefijo ya identifica el documento
  // (PO = recibo, RQ = cotización).
  folioBox: { right: 578, labelY: 50, labelSize: 8, y: 70, size: 15 },

  /* ---------- Datos (dos columnas) ---------- */
  metaSize: 10.5,
  metaLeftX: 34, metaRightX: 300,
  metaYs: { fecha: 112, representante: 128, proyecto: 112, telefono: 128, email: 144 },

  /* ---------- Tabla de conceptos ---------- */
  headRuleY: 163, headRuleW: 0.9,
  tableHeaderY: 177, tableHeaderSize: 10.5,
  colDesc: 34, colQ: 352, colPrecio: 418, colSubtotal: 500,
  qtyAlignX: 370, priceAlignX: 462, subtotalAlignX: 578,
  itemsStartY: 196, rowH: 17, itemsMaxBottom: 380, itemSize: 10,
  itemsShiftBudget: 12,
  // características del concepto impresas bajo la descripción
  itemFeatsMax: 4,
  itemFeatDrop: 1.1,      // cuánto baja el cuerpo respecto al de la descripción
  // Sólo el bloque de totales acompaña a una tabla larga. Todo lo que va
  // debajo (P.O. TRACK, PAGOS, TÉRMINOS, pie) queda anclado, para que
  // nunca se monte sobre la regla del pie.
  totalsShiftMax: 12,

  /* ---------- Totales (columna derecha) ---------- */
  // interlineado de 12pt entre conceptos y 20pt de aire antes de POR PAGAR
  totalsLabelX: 400, totalsAlignX: 578, totalsSize: 10.5,
  totalsYs: { subtotal: 396, iva: 408, total: 420, descuento: 432, porPagar: 452 },
  porPagarSize: 11.5,

  /* ---------- P.O. TRACK ---------- */
  trackDashY: 472,
  trackTitle: { x: 34, y: 488, size: 17 },
  trackHeaderY: 504, trackSize: 9.5,
  // columnas repartidas en cuartos del ancho útil (34 → 560)
  trackFechaX: 34, trackAbonoX: 214, trackSaldoX: 370, trackEstadoX: 500,
  trackStartY: 519, trackRowH: 13, trackMax: 4,
  // la regla deja 10pt de aire bajo la última fila (519 + 3*13 = 558)
  trackRuleY: 568,

  /* ---------- Pagos (columna izquierda) ---------- */
  // ambas columnas arrancan a la misma altura (583) para que PAGOS y
  // TÉRMINOS queden a ras por arriba
  pagosTitle:  { x: 34, y: 588, size: 22 },
  pagosSubt:   { x: 34, y: 604, size: 9.5 },
  pagosLabelX: 34, pagosSize: 9.5,
  pagosYs: { cuenta: 620, clabe: 631, beneficiario: 642, banco: 653 },
  qrBox: { x: 34, y: 661, w: 42, h: 42, r: 7 },

  /* ---------- Términos (columna derecha) ---------- */
  termsTitle: { x: 300, y: 588, size: 9.5 },
  termsX: 300, termsY: 601, termsW: 278, termsSize: 6.6, termsLineH: 1.36,
  termsMaxLines: 14,
  // ninguna línea puede pisar la regla del pie (deja 8pt de aire)
  termsBottom: 704,

  /* ---------- Pie ---------- */
  // 26pt de margen arriba (logo) y ~26pt abajo tras la última línea
  footRuleY: 712, footRuleW: 2.2,
  footSize: 8,
  footYs: [726, 737],
  footColL: 34, footColM: 300, footColR: 578,
};

/* ================== Fondo string-art ==================
   La envolvente curva del diseño es un haz de rectas que unen dos
   segmentos rectos (string art). Se genera una sola vez y se dibuja
   igual en la vista previa (SVG) y en el PDF (jsPDF). */
window.lineArtSegments = function () {
  var B = window.LAYOUT.lineArtBox;
  var out = [];
  function fan(ax, ay, bx, by, cx, cy, dx, dy, n) {
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      out.push([
        ax + (bx - ax) * t, ay + (by - ay) * t,
        cx + (dx - cx) * t, cy + (dy - cy) * t
      ]);
    }
  }
  var L = B.x, R = B.x + B.w, T = B.y, Bo = B.y + B.h;
  // Haces contenidos en la mitad izquierda / borde inferior para que
  // la curva no cruce el bloque de términos ni el pie.
  // haz principal: envolvente que baja por la izquierda y se abre
  fan(L, T,       L, Bo,        L, Bo,      R - 90, Bo, 58);
  // haz secundario: densifica el interior de la curva
  fan(L, T + 70,  L + 55, Bo,   L + 25, Bo, R - 260, Bo, 42);
  // haz de cierre: rectas que insinúan la segunda curva
  fan(L, T + 165, L, Bo - 55,   L + 130, Bo, R - 40, Bo, 30);
  return out;
};
/* ================== Iconos SVG minimalistas ================== */
// Stroke-only, sin relleno, estilo Lucide/Feather
window.ICONS = (function() {
  var S = 'stroke="currentColor" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  function wrap(w, h, inner, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" width="' + w + '" height="' + h + '" viewBox="0 0 24 24" ' + S + '>' + inner + '</svg>';
  }
  return {
    docs: function(cls) {
      return wrap(18, 18, '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>', cls);
    },
    coin: function(cls) {
      return wrap(18, 18, '<circle cx="12" cy="12" r="9"/><path d="M15 9.2c-.5-1-1.5-1.5-3-1.5-1.7 0-3 .8-3 2.3 0 3 6 1.5 6 4.5 0 1.5-1.3 2.3-3 2.3-1.7 0-2.7-.7-3.2-1.8"/><line x1="12" y1="5.5" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="18.5"/>', cls);
    },
    clipboard: function(cls) {
      return wrap(18, 18, '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2h6V3"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="15" y2="14"/>', cls);
    },
    trash: function(cls) {
      return wrap(18, 18, '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 3h4a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>', cls);
    },
    user: function(cls) {
      return wrap(18, 18, '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', cls);
    },
    check: function(cls) {
      return wrap(18, 18, '<polyline points="20 6 9 17 4 12"/>', cls);
    },
    warning: function(cls) {
      return wrap(18, 18, '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', cls);
    },
    box: function(cls) {
      return wrap(18, 18, '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>', cls);
    }
  };
})();

/* ================== Características de un concepto ==================
   Un concepto guarda sus características como arreglo de textos, pero
   también se acepta el formato heredado de un solo texto (separado por
   saltos de línea, comas, punto y coma o barras). */
window.itemCaracteristicas = function (it) {
  var c = (it && it.caracteristicas);
  if (!c) return [];
  var arr = Array.isArray(c) ? c : String(c).split(/[\r\n,;|]+/);
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var s = String(arr[i] == null ? '' : arr[i]).trim();
    if (s) out.push(s);
  }
  return out;
};

/* ================== Helpers de formato ================== */
window.fmtMoney = function (n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return sign + '$' + Math.abs(v).toLocaleString('es-MX', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
};

/* Dinero de un vistazo: en las cifras grandes del panel los centavos
   sobran y rompen la línea. Se redondea al peso y el importe exacto
   viaja en el atributo title del número. */
window.fmtMoneyShort = function (n) {
  const v = Number(n) || 0;
  if (Math.abs(v) < 1000) return window.fmtMoney(v);
  const sign = v < 0 ? '-' : '';
  return sign + '$' + Math.abs(Math.round(v)).toLocaleString('es-MX');
};

window.fmtDate = function (iso) {
  if (!iso) return '';
  // acepta yyyy-mm-dd y dd/mm/yyyy
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
};

window.todayISO = function () {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

window.uid = function () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
};

/* ================== Texto multi-línea ================== */
// Divide un texto en líneas que caben en maxW (ancho estimado por nº de caracteres)
window.wrapText = function (text, maxW, size) {
  const charW = size * 0.50;                  // ancho medio de Archivo (0.463 em) + margen
  const maxChars = Math.max(6, Math.floor(maxW / charW));
  const words = String(text == null ? '' : text).trim().split(/\s+/);
  if (!words.length || !words[0]) return [''];
  const lines = [];
  let cur = '';
  for (const w of words) {
    let word = w;
    while (word.length > maxChars) {          // romper palabras muy largas
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    const test = cur ? cur + ' ' + word : word;
    if (test.length > maxChars) { lines.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
};

/* ================== Layout de la tabla de conceptos ==================
   Calcula el alto de cada renglón según cuántas líneas ocupa la
   descripción, elige el tamaño de letra que cabe y devuelve el
   desplazamiento (delta) que debe aplicarse al bloque inferior. */
window.layoutItems = function (doc) {
  const L = window.LAYOUT;
  const items = (doc.items || []).filter((it) => it.desc && it.desc.trim());
  const maxDescW = L.qtyAlignX - 6 - L.colDesc;
  // cuando el concepto lleva unidad («500 pza») la columna Q se ensancha:
  // se reserva ese aire para que la descripción no lo alcance
  const qtySpace = L.qtyAlignX - L.colDesc;   // de la descripción al borde de Q
  const avail = L.itemsMaxBottom - L.itemsStartY;
  const budget = L.itemsShiftBudget;

  // Características del concepto: se imprimen en líneas propias, en un
  // cuerpo menor, bajo la descripción. Se limita la cantidad para que un
  // ítem muy detallado no se coma la tabla completa.
  function featLines(it, size, descW) {
    const lista = window.itemCaracteristicas(it);
    if (!lista.length) return [];
    const fsize = featSizeOf(size);
    const top = lista.slice(0, L.itemFeatsMax);
    let texto = top.map((c) => '· ' + c).join('   ');
    if (lista.length > L.itemFeatsMax) texto += '  · …';
    return window.wrapText(texto, descW, fsize);
  }
  function featSizeOf(size) { return Math.max(6.4, Math.round((size - L.itemFeatDrop) * 10) / 10); }
  // total de renglones que ocupa una fila (descripción + características)
  function nLines(r) { return r.lines.length + r.featLines.length; }

  function build(size) {
    const lineH = Math.round(size * 1.22 * 10) / 10;
    const baseRow = Math.max(L.rowH, size + 7);
    const rows = items.map((it) => {
      const q = Number(it.q) || 0;
      // la unidad viaja con la cantidad ("3 pza"); se recorta para no
      // invadir la columna de precio unitario
      const unidad = String((it && it.unidad) || '').trim().slice(0, 10);
      // estimación del ancho de «500 pza» (0.5 em por carácter, como wrapText)
      const qtyW = (String(q) + ' ' + unidad).length * size * 0.5;
      const descW = unidad
        ? Math.max(120, Math.min(maxDescW, qtySpace - qtyW - 8))
        : maxDescW;
      return {
        desc: String(it.desc || '').trim(),
        q: q,
        pu: Number(it.precioU) || 0,
        unidad: unidad,
        qtyLabel: unidad ? (String(q) + ' ' + unidad) : String(q),
        descW: descW,
        lines: window.wrapText(it.desc, descW, size),
        featLines: featLines(it, size, descW),
        rowH: 0,
      };
    });
    rows.forEach((r) => { r.rowH = baseRow + (nLines(r) - 1) * lineH; });
    const totalH = rows.reduce((a, r) => a + r.rowH, 0);
    const delta = Math.max(0, L.itemsStartY + totalH - L.itemsMaxBottom);
    return { rows, size, lineH, featSize: featSizeOf(size), delta, clipped: false };
  }

  let res = build(L.itemSize);
  for (const size of [9.2, 8.5, 8]) {
    if (res.delta <= budget) break;
    res = build(size);
  }

  if (res.delta > budget) {
    const { rows, lineH } = res;
    const target = avail + budget;
    rows.forEach((r) => { r.rowH = lineH * nLines(r); });
    let totalH = rows.reduce((a, r) => a + r.rowH, 0);
    if (totalH > target) {
      res.clipped = true;
      while (true) {
        const cur = rows.reduce((a, r) => a + lineH * nLines(r), 0);
        if (cur <= target) break;
        let removed = false;
        for (let i = rows.length - 1; i >= 0; i--) {
          // primero se recortan las características, luego la descripción
          if (rows[i].featLines.length) { rows[i].featLines.pop(); removed = true; break; }
          if (rows[i].lines.length > 1) { rows[i].lines.pop(); removed = true; break; }
        }
        if (!removed) break;
      }
      rows.forEach((r) => { r.rowH = lineH * nLines(r); });
      const last = rows[rows.length - 1];
      if (last) {
        if (last.featLines.length) last.featLines[last.featLines.length - 1] += '…';
        else if (last.lines.length) last.lines[last.lines.length - 1] += '…';
      }
      totalH = rows.reduce((a, r) => a + r.rowH, 0);
    }
    res.delta = Math.max(0, L.itemsStartY + totalH - L.itemsMaxBottom);
  }
  res.startY = L.itemsStartY;
  return res;
};

/* ================== Totales del documento ==================
   Fuente única de verdad para app, vista previa y PDF.
   subtotal → IVA → descuento → total → abonos → por pagar. */
window.docTotals = function (doc, settings) {
  var s = settings || {};
  var items = (doc.items || []).filter(function (it) { return it.desc && String(it.desc).trim(); });
  var subtotal = items.reduce(function (a, it) {
    return a + (Number(it.q) || 0) * (Number(it.precioU) || 0);
  }, 0);
  var ivaRate = (doc.conIva === false) ? 0 : (Number(doc.iva != null ? doc.iva : s.iva) || 0);
  var iva = subtotal * ivaRate / 100;
  var descuento = Math.max(0, Number(doc.descuento) || 0);
  var total = Math.max(0, subtotal + iva - descuento);
  var abonado = (doc.abonos || []).reduce(function (a, x) { return a + (Number(x.monto) || 0); }, 0);
  // si se abonó de más, el saldo se muestra en cero (no en negativo)
  var porPagar = Math.max(0, total - abonado);
  return {
    n: items.length,
    subtotal: subtotal,
    ivaRate: ivaRate,
    iva: iva,
    descuento: descuento,
    total: total,
    abonado: abonado,
    porPagar: porPagar,
    // saldado con tolerancia de medio centavo
    pagado: abonado > 0 && porPagar <= 0.005
  };
};

/* Estado de cada abono para la columna ESTADO de P.O. TRACK */
window.abonoEstado = function (saldoDespues, index) {
  if (saldoDespues <= 0.005) return 'LIQUIDADO';
  return index === 0 ? 'ANTICIPO' : 'PARCIAL';
};
