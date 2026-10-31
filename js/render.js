/* ============================================================
   RENDER HTML — construye el documento como HTML (pt) para la
   vista previa en pantalla y la impresión. Usa LAYOUT.
   Rediseño 2026: cabecera alineada con el logo, totales con
   DESCUENTO y POR PAGAR, P.O. TRACK con estado, PAGOS + TÉRMINOS
   a dos columnas, fondo string-art y pie con datos de contacto.
   v4.0: documento monocromo (los acentos van en NEGRITA, no en
   color) y folio impreso como texto, sin código de barras.
   ============================================================ */
(function () {
  const ASC = 0.77; // fracción de la em box por encima de la línea base

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Texto de una línea. x = coordenada (izq para align left; derecha para align right)
  function txt(x, yBaseline, size, weight, str, opts = {}) {
    const top = (yBaseline - size * ASC).toFixed(2);
    const w = opts.w ? `width:${opts.w}pt;` : '';
    const overflow = opts.ellipsis ? 'overflow:hidden;text-overflow:ellipsis;' : '';
    const color = opts.color ? `color:${opts.color};` : '';
    const ls = opts.ls != null ? `letter-spacing:${opts.ls}pt;` : '';
    const it = opts.italic ? 'font-style:italic;' : '';
    let pos;
    if (opts.align === 'right') {
      pos = `left:auto;right:${(612 - x).toFixed(2)}pt;text-align:right;`;
    } else {
      pos = `left:${x.toFixed(2)}pt;text-align:left;`;
    }
    return `<div style="position:absolute;${pos}top:${top}pt;font-size:${size}pt;line-height:${size}pt;font-weight:${weight};white-space:nowrap;${w}${overflow}${color}${ls}${it}">${esc(str)}</div>`;
  }

  function imgAbs(src, x, y, w, h, extra = '') {
    return `<img src="${esc(src)}" style="position:absolute;left:${x.toFixed(2)}pt;top:${y.toFixed(2)}pt;width:${w.toFixed(2)}pt;height:${h.toFixed(2)}pt;${extra}" alt="">`;
  }

  function contain(box, natW, natH) {
    const s = Math.min(box.w / natW, box.h / natH);
    const w = natW * s, h = natH * s;
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  }

  // Regla sólida
  function rule(x, y, w, weight, color) {
    return `<div style="position:absolute;left:${x.toFixed(2)}pt;top:${y.toFixed(2)}pt;width:${w.toFixed(2)}pt;height:${weight}pt;background:${color};"></div>`;
  }

  // Línea punteada (perforado)
  function dash(x, y, w, weight, color) {
    return `<div style="position:absolute;left:${x.toFixed(2)}pt;top:${y.toFixed(2)}pt;width:${w.toFixed(2)}pt;border-top:${weight}pt dashed ${color};"></div>`;
  }

  // Fondo string-art (haz de rectas de la referencia)
  function lineArtSVG() {
    const L = window.LAYOUT;
    const B = L.lineArtBox;
    const segs = window.lineArtSegments();
    const lines = segs.map((s) =>
      `<line x1="${(s[0] - B.x).toFixed(1)}" y1="${(s[1] - B.y).toFixed(1)}" x2="${(s[2] - B.x).toFixed(1)}" y2="${(s[3] - B.y).toFixed(1)}"/>`
    ).join('');
    return `<svg style="position:absolute;left:${B.x}pt;top:${B.y}pt;width:${B.w}pt;height:${B.h}pt;" viewBox="0 0 ${B.w} ${B.h}" preserveAspectRatio="none" aria-hidden="true">
      <g stroke="${L.lineArtHex}" stroke-width="0.35" fill="none">${lines}</g>
    </svg>`;
  }

  // block de texto multi-línea (ancho fijo)
  function para(x, yBaseline, size, str, widthPt, lineH = 1.35, weight = 400, color) {
    const top = (yBaseline - size).toFixed(2);
    const c = color ? `color:${color};` : '';
    return `<div style="position:absolute;left:${x.toFixed(2)}pt;top:${top}pt;width:${widthPt}pt;font-size:${size}pt;line-height:${lineH};font-weight:${weight};word-wrap:break-word;white-space:normal;${c}">${esc(str)}</div>`;
  }

  // Mide un texto en pt (Archivo, peso w). Convierte pt->px para el canvas.
  let _ctx = null;
  function measurePt(str, sizePt, weight) {
    try {
      if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
      _ctx.font = (weight || 400) + ' ' + (sizePt * 96 / 72) + 'px "Archivo"';
      return _ctx.measureText(str).width * 72 / 96;
    } catch (e) {
      return str.length * sizePt * 0.58;
    }
  }

  /* Términos & condiciones: la referencia los muestra como pares
     "Título: texto". Se aceptan tanto el texto libre de ajustes como
     el formato "Clave: valor" por línea. */
  window.parseTerms = function (raw) {
    const src = String(raw == null ? '' : raw).trim();
    if (!src) return [];
    return src.split(/\n+/).map((ln) => {
      const m = ln.match(/^\s*([^:]{2,28}):\s*(.+)$/);
      return m ? { label: m[1].trim(), text: m[2].trim() } : { label: '', text: ln.trim() };
    }).filter((t) => t.label || t.text);
  };

  window.receiptHTML = function (doc, settings) {
    const L = window.LAYOUT;
    const s = settings || {};
    const isCot = doc.tipo === 'cotizacion';
    const BLUE = L.brandHex, STEEL = L.steelHex, TURQ = L.turqHex;
    const GREY = L.greyHex, BODY = L.bodyHex, RULE = L.ruleHex;

    const t = window.docTotals(doc, s);
    const table = window.layoutItems(doc);
    // Sólo el bloque de totales sigue a una tabla larga; de P.O. TRACK
    // hacia abajo todo queda anclado para no invadir el pie.
    const shift = Math.min(table.delta, L.totalsShiftMax);
    const itemSize = table.size;

    // posiciones del logo (contain dentro del recuadro)
    const lp = contain(L.logoBox, 500, 327);

    let h = '';
    h += `<div style="width:612pt;height:792pt;position:relative;background:#ffffff;color:${BLUE};font-family:'Archivo';font-weight:400;overflow:hidden;">`;

    /* ---------- Fondos ---------- */
    const wm = L.watermark;
    h += imgAbs('assets/img/logo-clerki.svg', wm.x, wm.y, wm.w, wm.h, `opacity:${wm.opacity};`);
    h += lineArtSVG();

    /* ---------- Cabecera ---------- */
    h += imgAbs('assets/img/logo-clerki.svg', lp.x, lp.y, lp.w, lp.h);

    // Nombre de la empresa y bajada, a la misma sangría, justo a la
    // derecha del logo: el bloque queda alineado con él.
    const empresa = (s.empresa || 'CLERKI').toUpperCase();
    h += txt(L.brandLine1.x, L.brandLine1.y, L.brandLine1.size, 700, empresa, { ls: -0.3 });
    h += txt(L.brandSlash.x, L.brandSlash.y, L.brandSlash.size, 500,
      '// ' + (s.empresaSub || 'estudio creativo').toLowerCase(), { color: GREY, ls: 0.3 });

    // Folio: rótulo chico sobre el número en negrita, a la derecha. Sin
    // código de barras; el prefijo (PO / RQ) ya identifica el documento.
    const FB = L.folioBox;
    const folio = doc.numero || 'MC';
    h += txt(FB.right, FB.labelY, FB.labelSize, 700, 'FOLIO',
      { align: 'right', color: GREY, ls: 1.2 });
    h += txt(FB.right, FB.y, FB.size, 700, folio,
      { align: 'right', color: BLUE, ls: 0.2 });

    /* ---------- Datos (dos columnas) ---------- */
    const MS = L.metaSize;
    function metaPair(x, y, label, value) {
      let out = txt(x, y, MS, 700, label, { color: STEEL });
      const wl = measurePt(label, MS, 700);
      if (value) out += txt(x + wl + 8, y, MS, 400, value, { color: BODY, ellipsis: true, w: 150 });
      return out;
    }
    h += metaPair(L.metaLeftX, L.metaYs.fecha, 'Fecha', window.fmtDate(doc.fecha));
    h += metaPair(L.metaLeftX, L.metaYs.representante, 'Representante', doc.representante);
    h += metaPair(L.metaRightX, L.metaYs.proyecto, 'Proyecto', doc.proyecto);
    h += metaPair(L.metaRightX, L.metaYs.telefono, 'Telefono', doc.telefono);
    h += metaPair(L.metaRightX, L.metaYs.email, 'Email', doc.email);
    if (isCot && doc.vigencia) {
      h += metaPair(L.metaLeftX, L.metaYs.email, 'Vigencia', window.fmtDate(doc.vigencia));
    }

    /* ---------- Tabla de conceptos ---------- */
    h += rule(L.contentL, L.headRuleY, L.contentR - L.contentL, L.headRuleW, RULE);
    h += txt(L.colDesc, L.tableHeaderY, L.tableHeaderSize, 700, 'ITEM', { color: BLUE });
    h += txt(L.colQ, L.tableHeaderY, L.tableHeaderSize, 700, 'Q', { color: BLUE });
    h += txt(L.colPrecio, L.tableHeaderY, L.tableHeaderSize, 700, '$ U', { color: BLUE });
    h += txt(L.colSubtotal, L.tableHeaderY, L.tableHeaderSize, 700, 'SUB TOTAL', { color: BLUE });

    let y = L.itemsStartY;
    const maxDescW = L.qtyAlignX - 10 - L.colDesc;
    const featSize = table.featSize || Math.max(6.4, itemSize - L.itemFeatDrop);
    table.rows.forEach((r) => {
      // si el concepto lleva unidad la descripción se queda más corta
      const descW = r.descW || maxDescW;
      r.lines.forEach((ln, li) => {
        h += txt(L.colDesc, y + li * table.lineH, itemSize, 400, ln, { ellipsis: true, w: descW, color: BODY });
      });
      // características del concepto: cuerpo menor, bajo la descripción
      if (r.featLines && r.featLines.length) {
        r.featLines.forEach((ln, li) => {
          h += txt(L.colDesc, y + (r.lines.length + li) * table.lineH, featSize, 400, ln,
            { ellipsis: true, w: descW, color: GREY });
        });
      }
      if (r.q) h += txt(L.qtyAlignX, y, itemSize, 400, r.qtyLabel, { align: 'right', w: 56, color: BODY });
      if (r.pu) h += txt(L.priceAlignX, y, itemSize, 400, window.fmtMoney(r.pu), { align: 'right', w: 92, color: BODY });
      h += txt(L.subtotalAlignX, y, itemSize, 500, window.fmtMoney(r.q * r.pu), { align: 'right', w: 92, color: BLUE });
      y += r.rowH;
    });

    /* ---------- Totales ---------- */
    const TY = L.totalsYs, TS = L.totalsSize;
    function totalRow(label, value, ty, weight, size, color) {
      let out = txt(L.totalsLabelX, ty + shift, size || TS, weight || 700, label, { color: color || BLUE });
      if (value != null) out += txt(L.totalsAlignX, ty + shift, size || TS, weight || 500, value, { align: 'right', w: 110, color: color || BODY });
      return out;
    }
    h += totalRow('SUBTOTAL', window.fmtMoney(t.subtotal), TY.subtotal);
    h += totalRow('I.V.A.', t.ivaRate > 0 ? window.fmtMoney(t.iva) : '—', TY.iva);
    h += totalRow('TOTAL', window.fmtMoney(t.subtotal + t.iva), TY.total);
    h += totalRow('DESCUENTO', t.descuento > 0 ? '-' + window.fmtMoney(t.descuento) : '—', TY.descuento);
    h += totalRow('POR PAGAR', window.fmtMoney(t.porPagar), TY.porPagar, 700, L.porPagarSize, BLUE);

    /* ---------- P.O. TRACK ---------- */
    h += dash(L.contentL, L.trackDashY, L.contentR - L.contentL, 1, RULE);
    h += txt(L.trackTitle.x, L.trackTitle.y, L.trackTitle.size, 700, 'P.O. TRACK', { color: GREY, ls: 0.5 });
    const TKS = L.trackSize;
    h += txt(L.trackFechaX, L.trackHeaderY, TKS, 700, 'FECHA', { color: BLUE });
    h += txt(L.trackAbonoX, L.trackHeaderY, TKS, 700, 'ABONO', { color: BLUE });
    h += txt(L.trackSaldoX, L.trackHeaderY, TKS, 700, 'SALDO', { color: BLUE });
    h += txt(L.trackEstadoX, L.trackHeaderY, TKS, 700, 'ESTADO', { color: BLUE });

    const abonos = (doc.abonos || [])
      .filter((a) => a.fecha || (Number(a.monto) || 0) !== 0)
      .slice(0, L.trackMax);
    let saldo = t.total;
    abonos.forEach((a, i) => {
      const yy = L.trackStartY + i * L.trackRowH;
      saldo -= (Number(a.monto) || 0);
      h += txt(L.trackFechaX, yy, TKS, 400, window.fmtDate(a.fecha) || '—', { color: BODY });
      h += txt(L.trackAbonoX, yy, TKS, 400, window.fmtMoney(a.monto), { color: BODY });
      h += txt(L.trackSaldoX, yy, TKS, 400, window.fmtMoney(saldo), { color: BODY });
      h += txt(L.trackEstadoX, yy, TKS, 700, window.abonoEstado(saldo, i), { color: saldo <= 0.005 ? TURQ : STEEL });
    });
    h += rule(L.contentL, L.trackRuleY, L.contentR - L.contentL, 0.9, RULE);

    /* ---------- Pagos (columna izquierda) ---------- */
    h += txt(L.pagosTitle.x, L.pagosTitle.y, L.pagosTitle.size, 700, 'PAGOS', { color: BLUE, ls: -0.3 });
    h += txt(L.pagosSubt.x, L.pagosSubt.y, L.pagosSubt.size, 700, 'TRANSFERENCIAS A', { color: BLUE, ls: 0.3 });
    const PS = L.pagosSize;
    const p = doc.pagos || {};
    function pagoRow(label, value, py, italic) {
      let out = txt(L.pagosLabelX, py, PS, 700, label, { color: BLUE });
      if (value) {
        const wl = measurePt(label, PS, 700);
        out += txt(L.pagosLabelX + wl + 5, py, PS, 400, value,
          { color: BODY, ellipsis: true, w: 190 - wl, italic: italic });
      }
      return out;
    }
    h += pagoRow('CUENTA', p.cuenta, L.pagosYs.cuenta);
    h += pagoRow('CLABE', p.clabe, L.pagosYs.clabe);
    h += pagoRow('BENEFICIARIO:', p.beneficiario, L.pagosYs.beneficiario);
    h += pagoRow('BANCO:', p.banco, L.pagosYs.banco, true);

    h += `<div style="position:absolute;left:${L.qrBox.x}pt;top:${(L.qrBox.y).toFixed(2)}pt;width:${L.qrBox.w}pt;height:${L.qrBox.h}pt;border:0.8pt solid ${RULE};border-radius:${L.qrBox.r}pt;"></div>`;
    if (s.qr) {
      h += imgAbs(s.qr, L.qrBox.x + 4, L.qrBox.y + 4, L.qrBox.w - 8, L.qrBox.h - 8);
    }

    /* ---------- Términos & condiciones (columna derecha) ---------- */
    h += txt(L.termsTitle.x, L.termsTitle.y, L.termsTitle.size, 700, 'TÉRMINOS & CONDICIONES', { color: BLUE, ls: 0.2 });
    const terms = window.parseTerms(doc.terminos || s.terminos || '');
    const TSZ = L.termsSize;
    const lineStep = TSZ * L.termsLineH;
    let ty = L.termsY;
    let used = 0;
    terms.forEach((item) => {
      if (used >= L.termsMaxLines || ty > L.termsBottom) return;
      const labelTxt = item.label ? item.label + ': ' : '';
      const wl = labelTxt ? measurePt(labelTxt, TSZ, 700) : 0;
      // primera línea: etiqueta en negrita + inicio del texto
      const words = String(item.text).split(/\s+/);
      const firstMax = L.termsW - wl;
      let line = '', rest = [];
      words.forEach((w) => {
        if (rest.length) { rest.push(w); return; }
        const test = line ? line + ' ' + w : w;
        if (measurePt(test, TSZ, 400) <= firstMax) line = test;
        else rest.push(w);
      });
      if (labelTxt) h += txt(L.termsX, ty, TSZ, 700, labelTxt.trim(), { color: BLUE });
      if (line) h += txt(L.termsX + wl, ty, TSZ, 400, line, { color: BODY });
      ty += lineStep; used++;
      // líneas siguientes al ancho completo
      let cur = '';
      rest.forEach((w) => {
        const test = cur ? cur + ' ' + w : w;
        if (measurePt(test, TSZ, 400) <= L.termsW) { cur = test; return; }
        if (used < L.termsMaxLines && ty <= L.termsBottom) { h += txt(L.termsX, ty, TSZ, 400, cur, { color: BODY }); ty += lineStep; used++; }
        cur = w;
      });
      if (cur && used < L.termsMaxLines && ty <= L.termsBottom) {
        h += txt(L.termsX, ty, TSZ, 400, cur, { color: BODY });
        ty += lineStep; used++;
      }
    });

    /* ---------- Pie ---------- */
    h += rule(L.contentL, L.footRuleY, L.contentR - L.contentL, L.footRuleW, BLUE);
    const FS = L.footSize, FY = L.footYs;
    h += txt(L.footColL, FY[0], FS, 700, (s.empresa || 'CLERKI').toUpperCase(), { color: BLUE });
    const wf = measurePt((s.empresa || 'CLERKI').toUpperCase(), FS, 700);
    h += txt(L.footColL + wf + 5, FY[0], FS, 400, (s.empresaSub || 'estudio creativo').toLowerCase(), { color: BODY, italic: true });
    h += txt(L.footColL, FY[1], FS, 400, (s.ciudad || 'Ciudad de México') + ', México', { color: BODY, italic: true });
    if (s.telefono) h += txt(L.footColM, FY[0], FS, 400, s.telefono, { color: BODY, italic: true });
    if (s.email) h += txt(L.footColM, FY[1], FS, 400, s.email, { color: BODY, italic: true });
    if (s.web) h += txt(L.footColR, FY[1], FS, 400, s.web, { align: 'right', color: BODY, italic: true });

    h += `</div>`;
    return h;
  };
})();
