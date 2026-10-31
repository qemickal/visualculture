/* ============================================================
   PDF ENGINE — genera el PDF real (para correo / compartir)
   usando jsPDF + fuentes Archivo incrustadas + el logo.
   Dibuja con las mismas coordenadas que la vista previa (LAYOUT).
   Rediseño 2026: cabecera alineada con el logo, totales con
   DESCUENTO y POR PAGAR, P.O. TRACK con estado, PAGOS + TÉRMINOS
   a dos columnas, fondo string-art y pie con datos de contacto.
   v4.0: documento monocromo (los acentos van en NEGRITA, no en
   color) y folio impreso como texto, sin código de barras.
   ============================================================ */
(function () {
  const L = () => window.LAYOUT;

  const FONT_URLS = {
    light:   'assets/fonts/Archivo-Light.ttf',
    regular: 'assets/fonts/Archivo-Regular.ttf',
    medium:  'assets/fonts/Archivo-Medium.ttf',
    bold:    'assets/fonts/Archivo-Bold.ttf',
  };
  const FONT_NAMES = { light: 'ArchivoLight', regular: 'ArchivoRegular', medium: 'ArchivoMedium', bold: 'ArchivoBold' };

  let fontB64Cache = null;

  async function toBase64(url) {
    const r = await fetch(url);
    const b = await r.blob();
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);       // dataURL
      fr.onerror = rej;
      fr.readAsDataURL(b);
    });
  }

  async function getFontB64() {
    if (fontB64Cache) return fontB64Cache;
    const out = {};
    for (const key of Object.keys(FONT_URLS)) {
      const dataUrl = await toBase64(FONT_URLS[key]);
      out[key] = dataUrl.split(',')[1];
    }
    fontB64Cache = out;
    return out;
  }

  // Cada instancia de jsPDF necesita sus propias fuentes registradas.
  async function ensureFonts(pdf) {
    const fonts = await getFontB64();
    for (const key of Object.keys(FONT_URLS)) {
      const vfsName = 'Archivo-' + key + '.ttf';
      pdf.addFileToVFS(vfsName, fonts[key]);
      pdf.addFont(vfsName, FONT_NAMES[key], 'normal');
    }
  }

  function fitText(pdf, str, maxW) {
    if (!str) return '';
    if (pdf.getTextWidth(str) <= maxW) return str;
    let s = str;
    while (s.length > 1 && pdf.getTextWidth(s + '…') > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function contain(img, box) {
    const s = Math.min(box.w / img.w, box.h / img.h);
    const w = img.w * s, h = img.h * s;
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  }

  // Línea punteada (perforado)
  function dashedLine(pdf, x1, y, x2, w, dashArr, color) {
    pdf.setDrawColor(...color);
    pdf.setLineWidth(w);
    pdf.setLineDashPattern(dashArr, 0);
    pdf.line(x1, y, x2, y);
    pdf.setLineDashPattern([], 0);
  }

  function solidLine(pdf, x1, y, x2, w, color) {
    pdf.setDrawColor(...color);
    pdf.setLineWidth(w);
    pdf.line(x1, y, x2, y);
  }

  // Fondo string-art: el mismo haz de rectas que la vista previa
  function drawLineArt(pdf) {
    const LAY = L();
    pdf.setDrawColor(...LAY.lineArt);
    pdf.setLineWidth(0.35);
    window.lineArtSegments().forEach((s) => pdf.line(s[0], s[1], s[2], s[3]));
  }

  async function build(doc, settings, images) {
    const LAY = L();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: [LAY.pageW, LAY.pageH], compress: true });
    await ensureFonts(pdf);

    const F = (w) => pdf.setFont(FONT_NAMES[w], 'normal');
    const BLUE = LAY.brand, STEEL = LAY.steel, TURQ = LAY.turq;
    const GREY = LAY.grey, BODY = LAY.body, RULE = LAY.rule;
    const C = (c) => pdf.setTextColor(...c);

    const s = settings || {};
    const isCot = doc.tipo === 'cotizacion';
    const t = window.docTotals(doc, s);
    const table = window.layoutItems(doc);
    // Sólo el bloque de totales sigue a una tabla larga; de P.O. TRACK
    // hacia abajo todo queda anclado para no invadir el pie.
    const shift = Math.min(table.delta, LAY.totalsShiftMax);
    const itemSize = table.size;

    /* ---------- Fondos ---------- */
    // marca de agua: el propio logo escalado, con opacidad vía GState
    if (images && images.blue) {
      const w = LAY.watermark;
      try {
        pdf.saveGraphicsState();
        if (pdf.GState) pdf.setGState(new pdf.GState({ opacity: w.opacity }));
        pdf.addImage(images.blue.dataUrl, 'PNG', w.x, w.y, w.w, w.h);
        pdf.restoreGraphicsState();
      } catch (e) { try { pdf.restoreGraphicsState(); } catch (e2) {} }
    }
    drawLineArt(pdf);

    /* ---------- Cabecera ---------- */
    if (images && images.blue) {
      const p = contain(images.blue, LAY.logoBox);
      pdf.addImage(images.blue.dataUrl, 'PNG', p.x, p.y, p.w, p.h);
    }

    // Nombre de la empresa y bajada, a la misma sangría, justo a la
    // derecha del logo: el bloque queda alineado con él.
    const empresa = (s.empresa || 'CLERKI').toUpperCase();
    F('bold'); pdf.setFontSize(LAY.brandLine1.size); C(BLUE);
    pdf.text(empresa, LAY.brandLine1.x, LAY.brandLine1.y);
    F('medium'); pdf.setFontSize(LAY.brandSlash.size); C(GREY);
    pdf.text('// ' + (s.empresaSub || 'estudio creativo').toLowerCase(),
      LAY.brandSlash.x, LAY.brandSlash.y);

    // Folio: rótulo chico sobre el número en negrita, a la derecha. Sin
    // código de barras; el prefijo (PO / RQ) ya identifica el documento.
    const FB = LAY.folioBox;
    const folio = doc.numero || 'MC';
    F('bold'); pdf.setFontSize(FB.labelSize); C(GREY);
    pdf.text('FOLIO', FB.right, FB.labelY, { align: 'right' });
    F('bold'); pdf.setFontSize(FB.size); C(BLUE);
    pdf.text(folio, FB.right, FB.y, { align: 'right' });

    /* ---------- Datos (dos columnas) ---------- */
    const MS = LAY.metaSize;
    function metaPair(x, y, label, value) {
      F('bold'); pdf.setFontSize(MS); C(STEEL);
      pdf.text(label, x, y);
      if (!value) return;
      const wl = pdf.getTextWidth(label);
      F('regular'); C(BODY);
      pdf.text(fitText(pdf, String(value), 150), x + wl + 8, y);
    }
    metaPair(LAY.metaLeftX, LAY.metaYs.fecha, 'Fecha', window.fmtDate(doc.fecha));
    metaPair(LAY.metaLeftX, LAY.metaYs.representante, 'Representante', doc.representante);
    metaPair(LAY.metaRightX, LAY.metaYs.proyecto, 'Proyecto', doc.proyecto);
    metaPair(LAY.metaRightX, LAY.metaYs.telefono, 'Telefono', doc.telefono);
    metaPair(LAY.metaRightX, LAY.metaYs.email, 'Email', doc.email);
    if (isCot && doc.vigencia) {
      metaPair(LAY.metaLeftX, LAY.metaYs.email, 'Vigencia', window.fmtDate(doc.vigencia));
    }

    /* ---------- Tabla de conceptos ---------- */
    solidLine(pdf, LAY.contentL, LAY.headRuleY, LAY.contentR, LAY.headRuleW, RULE);
    F('bold'); pdf.setFontSize(LAY.tableHeaderSize); C(BLUE);
    pdf.text('ITEM', LAY.colDesc, LAY.tableHeaderY);
    pdf.text('Q', LAY.colQ, LAY.tableHeaderY);
    pdf.text('$ U', LAY.colPrecio, LAY.tableHeaderY);
    pdf.text('SUB TOTAL', LAY.colSubtotal, LAY.tableHeaderY);

    let y = LAY.itemsStartY;
    const descMaxW = LAY.qtyAlignX - 10 - LAY.colDesc;
    const featSize = table.featSize || Math.max(6.4, itemSize - LAY.itemFeatDrop);
    table.rows.forEach((r) => {
      F('regular'); pdf.setFontSize(itemSize); C(BODY);
      r.lines.forEach((ln, li) => pdf.text(ln, LAY.colDesc, y + li * table.lineH));
      // características del concepto: cuerpo menor, bajo la descripción
      if (r.featLines && r.featLines.length) {
        F('regular'); pdf.setFontSize(featSize); C(GREY);
        r.featLines.forEach((ln, li) =>
          pdf.text(fitText(pdf, ln, r.descW || descMaxW), LAY.colDesc, y + (r.lines.length + li) * table.lineH));
        // se vuelve al cuerpo normal antes de las cifras
        F('regular'); pdf.setFontSize(itemSize); C(BODY);
      }
      if (r.q) pdf.text(fitText(pdf, r.qtyLabel || String(r.q), 52), LAY.qtyAlignX, y, { align: 'right' });
      if (r.pu) pdf.text(window.fmtMoney(r.pu), LAY.priceAlignX, y, { align: 'right' });
      F('medium'); C(BLUE);
      pdf.text(window.fmtMoney(r.q * r.pu), LAY.subtotalAlignX, y, { align: 'right' });
      y += r.rowH;
    });

    /* ---------- Totales ---------- */
    const TY = LAY.totalsYs, TS = LAY.totalsSize;
    function totalRow(label, value, ty, size, strong) {
      const sz = size || TS;
      F('bold'); pdf.setFontSize(sz); C(BLUE);
      pdf.text(label, LAY.totalsLabelX, ty + shift);
      if (value == null) return;
      if (strong) { F('bold'); C(BLUE); } else { F('medium'); C(BODY); }
      pdf.text(value, LAY.totalsAlignX, ty + shift, { align: 'right' });
    }
    totalRow('SUBTOTAL', window.fmtMoney(t.subtotal), TY.subtotal);
    totalRow('I.V.A.', t.ivaRate > 0 ? window.fmtMoney(t.iva) : '—', TY.iva);
    totalRow('TOTAL', window.fmtMoney(t.subtotal + t.iva), TY.total);
    totalRow('DESCUENTO', t.descuento > 0 ? '-' + window.fmtMoney(t.descuento) : '—', TY.descuento);
    totalRow('POR PAGAR', window.fmtMoney(t.porPagar), TY.porPagar, LAY.porPagarSize, true);

    /* ---------- P.O. TRACK ---------- */
    dashedLine(pdf, LAY.contentL, LAY.trackDashY, LAY.contentR, 1, [2.6, 2.6], RULE);
    F('bold'); pdf.setFontSize(LAY.trackTitle.size); C(GREY);
    pdf.text('P.O. TRACK', LAY.trackTitle.x, LAY.trackTitle.y);

    const TKS = LAY.trackSize;
    F('bold'); pdf.setFontSize(TKS); C(BLUE);
    pdf.text('FECHA', LAY.trackFechaX, LAY.trackHeaderY);
    pdf.text('ABONO', LAY.trackAbonoX, LAY.trackHeaderY);
    pdf.text('SALDO', LAY.trackSaldoX, LAY.trackHeaderY);
    pdf.text('ESTADO', LAY.trackEstadoX, LAY.trackHeaderY);

    const abonos = (doc.abonos || [])
      .filter((a) => a.fecha || (Number(a.monto) || 0) !== 0)
      .slice(0, LAY.trackMax);
    let saldo = t.total;
    abonos.forEach((a, i) => {
      const yy = LAY.trackStartY + i * LAY.trackRowH;
      saldo -= (Number(a.monto) || 0);
      F('regular'); pdf.setFontSize(TKS); C(BODY);
      pdf.text(window.fmtDate(a.fecha) || '—', LAY.trackFechaX, yy);
      pdf.text(window.fmtMoney(a.monto), LAY.trackAbonoX, yy);
      pdf.text(window.fmtMoney(saldo), LAY.trackSaldoX, yy);
      F('bold'); C(saldo <= 0.005 ? TURQ : STEEL);
      pdf.text(window.abonoEstado(saldo, i), LAY.trackEstadoX, yy);
    });
    solidLine(pdf, LAY.contentL, LAY.trackRuleY, LAY.contentR, 0.9, RULE);

    /* ---------- Pagos (columna izquierda) ---------- */
    F('bold'); pdf.setFontSize(LAY.pagosTitle.size); C(BLUE);
    pdf.text('PAGOS', LAY.pagosTitle.x, LAY.pagosTitle.y);
    F('bold'); pdf.setFontSize(LAY.pagosSubt.size);
    pdf.text('TRANSFERENCIAS A', LAY.pagosSubt.x, LAY.pagosSubt.y);

    const PS = LAY.pagosSize;
    const p = doc.pagos || {};
    function pagoRow(label, value, py) {
      F('bold'); pdf.setFontSize(PS); C(BLUE);
      pdf.text(label, LAY.pagosLabelX, py);
      if (!value) return;
      const wl = pdf.getTextWidth(label);
      F('regular'); C(BODY);
      pdf.text(fitText(pdf, String(value), 190 - wl), LAY.pagosLabelX + wl + 5, py);
    }
    pagoRow('CUENTA', p.cuenta, LAY.pagosYs.cuenta);
    pagoRow('CLABE', p.clabe, LAY.pagosYs.clabe);
    pagoRow('BENEFICIARIO:', p.beneficiario, LAY.pagosYs.beneficiario);
    pagoRow('BANCO:', p.banco, LAY.pagosYs.banco);

    pdf.setDrawColor(...RULE); pdf.setLineWidth(0.8);
    pdf.roundedRect(LAY.qrBox.x, LAY.qrBox.y, LAY.qrBox.w, LAY.qrBox.h, LAY.qrBox.r, LAY.qrBox.r, 'S');
    if (s.qr) {
      try { pdf.addImage(s.qr, 'PNG', LAY.qrBox.x + 4, LAY.qrBox.y + 4, LAY.qrBox.w - 8, LAY.qrBox.h - 8); } catch (e) {}
    }

    /* ---------- Términos & condiciones (columna derecha) ---------- */
    F('bold'); pdf.setFontSize(LAY.termsTitle.size); C(BLUE);
    pdf.text('TÉRMINOS & CONDICIONES', LAY.termsTitle.x, LAY.termsTitle.y);

    const terms = window.parseTerms(doc.terminos || s.terminos || '');
    const TSZ = LAY.termsSize;
    const lineStep = TSZ * LAY.termsLineH;
    let ty = LAY.termsY;
    let used = 0;
    terms.forEach((item) => {
      if (used >= LAY.termsMaxLines || ty > LAY.termsBottom) return;
      const labelTxt = item.label ? item.label + ':' : '';
      F('bold'); pdf.setFontSize(TSZ);
      const wl = labelTxt ? pdf.getTextWidth(labelTxt + ' ') : 0;
      F('regular'); pdf.setFontSize(TSZ);
      // primera línea: lo que quepa junto a la etiqueta
      const words = String(item.text).split(/\s+/);
      let line = '', rest = [];
      words.forEach((w) => {
        if (rest.length) { rest.push(w); return; }
        const test = line ? line + ' ' + w : w;
        if (pdf.getTextWidth(test) <= LAY.termsW - wl) line = test;
        else rest.push(w);
      });
      if (labelTxt) {
        F('bold'); C(BLUE);
        pdf.text(labelTxt, LAY.termsX, ty);
      }
      if (line) {
        F('regular'); C(BODY);
        pdf.text(line, LAY.termsX + wl, ty);
      }
      ty += lineStep; used++;
      // resto al ancho completo
      F('regular'); C(BODY);
      let cur = '';
      rest.forEach((w) => {
        const test = cur ? cur + ' ' + w : w;
        if (pdf.getTextWidth(test) <= LAY.termsW) { cur = test; return; }
        if (used < LAY.termsMaxLines && ty <= LAY.termsBottom) { pdf.text(cur, LAY.termsX, ty); ty += lineStep; used++; }
        cur = w;
      });
      if (cur && used < LAY.termsMaxLines && ty <= LAY.termsBottom) {
        pdf.text(cur, LAY.termsX, ty);
        ty += lineStep; used++;
      }
    });

    /* ---------- Pie ---------- */
    solidLine(pdf, LAY.contentL, LAY.footRuleY, LAY.contentR, LAY.footRuleW, BLUE);
    const FS = LAY.footSize, FY = LAY.footYs;
    F('bold'); pdf.setFontSize(FS); C(BLUE);
    pdf.text(empresa, LAY.footColL, FY[0]);
    const wf = pdf.getTextWidth(empresa);
    F('regular'); C(BODY);
    pdf.text((s.empresaSub || 'estudio creativo').toLowerCase(), LAY.footColL + wf + 5, FY[0]);
    pdf.text((s.ciudad || 'Ciudad de México') + ', México', LAY.footColL, FY[1]);
    if (s.telefono) pdf.text(s.telefono, LAY.footColM, FY[0]);
    if (s.email) pdf.text(s.email, LAY.footColM, FY[1]);
    if (s.web) pdf.text(s.web, LAY.footColR, FY[1], { align: 'right' });

    return pdf.output('blob');
  }

  window.PDFEngine = { build };
})();
