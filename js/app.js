/* ============================================================
   APP — PWA de Recibos y Cotizaciones (CLERKI)
   ============================================================ */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------------- Storage ---------------- */
  const _memStore = {};
  function storeGet(k, d) {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch (e) { return k in _memStore ? _memStore[k] : d; }
  }
  function storeSet(k, v) {
    _memStore[k] = v;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* almacenamiento no disponible */ }
    // notificar al sincronizador (colecciones que viajan)
    if (k === 'mc_docs' || k === 'mc_settings' || k === 'mc_clientes' || k === 'mc_cxp' || k === 'mc_productos' || k === 'mc_tareas') {
      if (window.SYNC) window.SYNC.localChanged();
    }
  }

  /* ---------------- Ajustes ---------------- */
  const DEFAULT_SETTINGS = {
    empresa: 'CLERKI',
    empresaSub: 'Recibos & Cotizaciones',
    email: '',
    telefono: '',
    web: '',
    ciudad: '',
    iva: 16,
    pagos: { cuenta: '', clabe: '', beneficiario: '', banco: '' },
    condiciones: 'Entrega de 7 a 10 días hábiles después de confirmar el pago.',
    // Formato "Título: texto" por línea (el PDF resalta el título en negrita)
    terminos: [
      'Propiedad intelectual: Los derechos de diseño se ceden al cliente únicamente tras el pago total.',
      'Aprobación: Su visto bueno es final. No se aceptan cambios ni devoluciones tras autorizar la impresión o publicación.',
      'Presupuestos: Válidos por 15 días. Trabajos extra se cotizan por separado.',
      'Entregas: Los tiempos son estimados y no nos hacemos responsables por retrasos externos (proveedores o envíos).',
      'Pagos: Requiere 50% de anticipo para iniciar producción y 50% restante contra entrega.',
      'Garantía: Reportar cualquier defecto dentro de los 5 días hábiles posteriores a la entrega.',
      'Archivos: Se guardan en nuestro sistema por 30 días después de la entrega.',
      'Uso: El material es para el uso especifico acordado; prohibida su edición o reventa sin autorización.'
    ].join('\n'),
    qr: ''
  };

  let settings = Object.assign({}, DEFAULT_SETTINGS, storeGet('mc_settings', {}));
  settings.pagos = Object.assign({}, DEFAULT_SETTINGS.pagos, settings.pagos || {});

  let docs = storeGet('mc_docs', []);
  let clientes = storeGet('mc_clientes', []);
  let cuentasXPagar = storeGet('mc_cxp', []);
  let productos = storeGet('mc_productos', []);  // catálogo: productos y servicios
  let tareas = storeGet('mc_tareas', []); // tareas con deadline y documento asociado
  let editing = null;   // copia de trabajo
  let editingCxp = null; // copia de trabajo para cuenta por pagar
  let editingCliente = null; // referencia al contacto en edición (null = nuevo)
  let editingProducto = null; // referencia al ítem del catálogo en edición (null = nuevo)
  let editingTarea = null; // tarea en edición (null = nueva)
  let selectedClientId = null;
  let images = null;    // dataURLs pre-cargados para el PDF
  let listFilter = 'todos';   // 'todos' | 'recibo' | 'cotizacion'
  let listStatus = 'todos';   // 'todos' | 'pendiente' | 'parcial' | 'pagado'
  let listEstado = 'activos'; // 'activos' | 'cerrados' | id de estado
  let listQuery = '';
  let cliFilter = 'todos';  // 'todos' | 'cliente' | 'prospecto'
  let cliQuery = '';
  let cliModalTipo = 'cliente'; // tipo seleccionado en el modal de contacto
  let prodFilter = 'todos'; // 'todos' | 'producto' | 'servicio'
  let prodQuery = '';
  let prodModalTipo = 'producto'; // tipo seleccionado en el modal del catálogo
  let tareaFilter = 'todas'; // 'todas' | 'pendiente' | 'hecha' | 'vencida'
  let tareaArea = 'todas'; // 'todas' | 'general' | 'contabilidad' | 'ventas' | 'cobranza'
  let tareaQuery = '';
  let mainView = 'inicio';  // 'inicio' | 'docs' | 'cxc' | 'cxp' | 'clientes' | 'productos' | 'tareas'
  let previousView = 'inicio'; // vista antes de entrar al editor
  let cxpFilter = 'todas';
  let cxpQuery = '';
  let cxcQuery = '';
  let navReturnFocus = null;
  /* El panel de filtros se pliega en pantalla angosta: con todas las
     opciones abiertas empujaba la lista fuera de la primera pantalla. */
  let filtersCollapsed = !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);

  /* ---------------- Utilidades ---------------- */
  // fuente única de verdad (layout.js): subtotal → IVA → descuento → por pagar
  function computeTotals(doc) {
    return window.docTotals(doc, settings);
  }
  function nextNumero(tipo) {
    var prefijo = tipo === 'cotizacion' ? 'RQ' : 'PO';
    var now = new Date();
    var yy = String(now.getFullYear()).slice(-2);
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    var hh = String(now.getHours()).padStart(2, '0');
    var mi = String(now.getMinutes()).padStart(2, '0');
    return prefijo + yy + mm + dd + hh + mi;
  }
  /* ---------------- Estados de workflow ---------------- */
  const DOC_ESTADOS = [
    { id: 'cotizado',     label: 'Cotizado',     tone: 'ghost' },
    { id: 'aprobado',     label: 'Aprobado',     tone: 'accent' },
    { id: 'produccion',   label: 'En producción', tone: 'warn' },
    { id: 'enviado',      label: 'Enviado',      tone: 'accent' },
    { id: 'entregado',    label: 'Entregado',    tone: 'ok' },
    { id: 'pagado',       label: 'Pagado',       tone: 'ok' },
    { id: 'devuelto',     label: 'Devuelto',     tone: 'danger' },
    { id: 'cerrado',      label: 'Cerrado',      tone: 'muted' }
  ];
  const DOC_ESTADOS_MAP = DOC_ESTADOS.reduce(function (m, e) { m[e.id] = e; return m; }, {});

  function docEstado(doc) {
    const e = doc && doc.estado;
    return DOC_ESTADOS_MAP[e] || DOC_ESTADOS_MAP.cotizado;
  }

  function blankDoc(tipo) {
    return {
      id: window.uid(), tipo, numero: nextNumero(tipo),
      fecha: window.todayISO(), vigencia: '',
      proyecto: '', representante: '', telefono: '', email: '',
      items: [{ desc: '', q: 1, precioU: 0, unidad: '', caracteristicas: [] }],
      conIva: true, iva: settings.iva, descuento: 0,
      pagos: { cuenta: settings.pagos.cuenta, clabe: settings.pagos.clabe, beneficiario: settings.pagos.beneficiario, banco: settings.pagos.banco },
      abonos: [], condiciones: settings.condiciones, terminos: settings.terminos,
      entregaFecha: '', entregaForma: '',
      estado: 'cotizado',
      createdAt: Date.now(), updatedAt: Date.now()
    };
  }

  // Migración suave: documentos antiguos sin estado reciben uno por defecto.
  (function migrateEstados() {
    let changed = false;
    docs.forEach(function (d) {
      if (!d.estado || !DOC_ESTADOS_MAP[d.estado]) {
        const t = d.items ? window.docTotals(d, settings) : { pagado: false, total: 0 };
        d.estado = t.pagado && t.total > 0 ? 'pagado' : 'cotizado';
        changed = true;
      }
    });
    if (changed) storeSet('mc_docs', docs);
  })();
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------------- Marcado compartido de las listas ----------------
     Las seis listas (documentos, por cobrar, por pagar, directorio,
     catálogo y tareas) usan la misma anatomía de fila: identidad a la
     izquierda, cifra a la derecha, estado y acciones al pie. Así la
     información se lee de un vistazo y las acciones quedan siempre en
     el mismo lugar. */
  const ICO = {
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    cash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
    open: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>'
  };
  /* Botón de fila. `visible` es la etiqueta de texto; si se omite, el
     botón queda sólo con icono (nombre accesible por aria-label). */
  function actBtn(action, id, aria, icon, visible, kind) {
    const cls = 'btn small ' + (kind || 'outline') + (visible ? '' : ' icon-only');
    const idAttr = id ? ' data-id="' + esc(id) + '"' : '';
    const label = visible ? '<span class="btn-label">' + esc(visible) + '</span>' : '';
    return '<button type="button" class="' + cls + '" data-action="' + action + '"' + idAttr
      + ' aria-label="' + esc(aria) + '" title="' + esc(aria) + '">' + icon + label + '</button>';
  }
  function trashBtn(action, id, aria) {
    return actBtn(action, id, aria, window.ICONS.trash(), '', 'danger');
  }
  /* Separador de metadatos: no se lee, sólo ordena la línea. */
  const SEP = '<span class="row-sep" aria-hidden="true">·</span>';
  /* El plegado del panel es visual: el estado vive aquí y se refleja en
     los seis paneles a la vez (todos los botones dicen lo mismo). */
  function applyFiltersState() {
    $$('.page-side').forEach(function (side) {
      side.classList.toggle('is-collapsed', filtersCollapsed);
    });
    $$('.side-toggle').forEach(function (btn) {
      btn.setAttribute('aria-expanded', filtersCollapsed ? 'false' : 'true');
    });
  }

  /* Grupos de filtros: son conmutadores, así que el estado activo tiene
     que oírse (aria-pressed), no sólo verse. */
  function paintChips(sel, attr, activo) {
    $$(sel).forEach(function (c) {
      const on = c.dataset[attr] === activo;
      c.classList.toggle('active', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* Cuenta de resultados de cada lista (aviso visible y para lectores). */
  function setCount(id, n, singular, plural, extra) {
    const el = $('#' + id);
    if (!el) return;
    el.innerHTML = n
      ? '<b>' + n + '</b> ' + (n === 1 ? singular : plural) + (extra ? ' · ' + esc(extra) : '')
      : 'Ningún resultado';
  }
  /* Características de productos, servicios y conceptos: se guardan como
     arreglo, pero se acepta texto suelto (líneas, comas, punto y coma). */
  function splitCaract(v) {
    if (v == null) return [];
    return window.itemCaracteristicas({ caracteristicas: v });
  }
  function joinCaractLines(v) { return splitCaract(v).join('\n'); }   // textarea del catálogo
  function joinCaractInline(v) { return splitCaract(v).join(', '); }  // campo del concepto
  function fileName(doc) {
    const tipo = doc.tipo === 'cotizacion' ? 'Cotizacion' : 'Recibo';
    return `${tipo}-${doc.numero || 'sin-numero'}-${(settings.empresa || 'doc').replace(/[^a-z0-9]+/gi, '-')}.pdf`.replace(/--+/g, '-');
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  /* ---------------- Pre-carga de imágenes ---------------- */
  async function toDataURL(url, w, h) {
    const r = await fetch(url);
    const b = await r.blob();
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(b);
    });
    return { dataUrl, w, h };
  }
  async function preloadImages() {
    try {
      // la marca de agua se dibuja con el propio logo escalado (LAYOUT.watermark)
      const blue = await toDataURL('assets/img/logo-clerki.svg', 500, 327);
      images = { blue };
    } catch (e) { /* sin imágenes, el PDF saldrá sin logo */ }
  }

  /* ================= PANEL DE INICIO (entrada) ================= */
  function showHome() {
    switchMainView('inicio');
  }

  function renderList() {
    const wrap = $('#doc-list');
    const filtered = docs.filter((d) => {
      const okTipo = listFilter === 'todos' || d.tipo === listFilter;
      if (!okTipo) return false;
      // Filtro de archivo: por defecto se OCULTAN los cerrados.
      const est = docEstado(d);
      if (listEstado === 'activos' && est.id === 'cerrado') return false;
      if (listEstado === 'cerrados' && est.id !== 'cerrado') return false;
      if (listEstado !== 'activos' && listEstado !== 'cerrados' && est.id !== listEstado) return false;
      if (listStatus !== 'todos') {
        const t = computeTotals(d);
        if (listStatus === 'pagado' && !t.pagado) return false;
        if (listStatus === 'parcial' && (t.pagado || t.abonado <= 0)) return false;
        if (listStatus === 'pendiente' && (t.pagado || t.abonado > 0)) return false;
      }
      const q = listQuery.trim().toLowerCase();
      const okQ = !q || [d.numero, d.proyecto, d.representante, d.email, (est ? est.label : '')].join(' ').toLowerCase().includes(q);
      return okQ;
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    paintChips('.chip[data-filter]', 'filter', listFilter);
    paintChips('.chip[data-status]', 'status', listStatus);
    paintChips('.chip[data-estado]', 'estado', listEstado);
    const STATUS_NOTA = { pendiente: 'pendientes', parcial: 'con pago parcial', pagado: 'liquidados' };
    const ESTADO_NOTA = { activos: '', cerrados: 'archivo' };
    const extraEstado = ESTADO_NOTA.hasOwnProperty(listEstado)
      ? ESTADO_NOTA[listEstado]
      : (DOC_ESTADOS_MAP[listEstado] ? DOC_ESTADOS_MAP[listEstado].label.toLowerCase() : '');
    setCount('docs-count', filtered.length, 'documento', 'documentos',
      (listFilter === 'todos' ? '' : (listFilter === 'recibo' ? 'recibos' : 'cotizaciones'))
      + (extraEstado ? ' · ' + extraEstado : '')
      + (listStatus === 'todos' ? '' : ' · ' + STATUS_NOTA[listStatus]));

    if (!filtered.length) {
      wrap.innerHTML = `
        <div class="empty">
          <span class="empty-icon">${window.ICONS.docs('ic-lg')}</span>
          <h3>${docs.length ? 'No hay documentos que coincidan' : 'Aún no hay documentos'}</h3>
          <p>${docs.length ? 'Prueba con otra búsqueda o filtro.' : 'Crea tu primer recibo o cotización y guárdalo en este dispositivo.'}</p>
          <div class="empty-actions">
            <button class="btn primary" data-action="new-recibo"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Nuevo recibo</button>
            <button class="btn outline" data-action="new-cotizacion"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Nueva cotización</button>
          </div>
        </div>`;
      return;
    }

    const rows = filtered.map((d) => {
      const t = computeTotals(d);
      const esCot = d.tipo === 'cotizacion';
      const est = docEstado(d);
      const esCerrado = est.id === 'cerrado';
      const nombre = d.numero || (esCot ? 'Cotización' : 'Recibo');
      const nota = t.abonado > 0.005
        ? window.fmtMoney(t.total) + ' · abonado ' + window.fmtMoney(t.abonado)
        : t.n + ' concepto' + (t.n !== 1 ? 's' : '');
      const datos = [
        d.representante ? '<span>' + esc(d.representante) + '</span>' : '',
        d.email && !d.representante ? '<span>' + esc(d.email) + '</span>' : '',
        /* Fecha corta en la lista: el año completo vive en el editor y en
           el título del nodo. Así el nombre del cliente no se recorta. */
        d.fecha ? '<span title="' + window.fmtDate(d.fecha) + '">' + diaCorto(d.fecha) + '</span>' : '',
        /* La vigencia de la cotización viaja con los datos, no debajo
           de los botones, que es donde antes quedaba descolgada. */
        esCot && d.vigencia
          ? '<span class="row-note">Vigente hasta ' + window.fmtDate(d.vigencia) + '</span>'
          : '',
        nota ? '<span class="row-note">' + esc(nota) + '</span>' : ''
      ].filter(Boolean).join(SEP);
      const pagoPill = t.pagado
        ? '<span class="pill mini ok">Pagado</span>'
        : (t.abonado > 0.005 ? '<span class="pill mini warn">Pago parcial</span>' : '');
      const cerrarBtn = esCerrado
        ? actBtn('reabrir', d.id, 'Reabrir ' + nombre, ICO.open, 'Reabrir')
        : actBtn('cerrar', d.id, 'Mover ' + nombre + ' a cerrados',
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 4v4"/><path d="M16 4v4"/></svg>',
            'Cerrar', 'muted');
      /* La cifra va en el mismo renglón que el proyecto (la identidad a
         la izquierda, el importe a la derecha) y el tipo, el estado y el
         cobro viajan en la línea de datos, no en filas propias: antes la
         tarjeta medía el doble en el celular. */
      const tags = '<span class="row-tags">'
        + '<span class="pill mini estado-pill ' + est.tone + '">' + esc(est.label) + '</span>'
        + pagoPill + '</span>';
      const folio = d.numero ? esc(d.numero) : (esCot ? 'Cotización' : 'Recibo');
      /* Tres renglones: folio y estado, proyecto e importe, cliente y
         acciones. El folio ya no se repite en la línea de metadatos y el
         tipo de documento viaja como etiqueta junto al folio. */
      return `
      <li class="row row-doc${esCerrado ? ' is-closed' : ''}">
        <p class="row-folio">
          <span class="row-folio-num">${folio}</span>
          <span class="ord-kind">${esCot ? 'Cotización' : 'Recibo'}</span>
        </p>
        <strong class="row-amount">${window.fmtMoney(t.total)}</strong>
        <p class="row-title" title="${esc(d.proyecto || 'Sin proyecto')}"><span class="row-title-text">${esc(d.proyecto || 'Sin proyecto')}</span></p>
        <p class="row-meta">${tags}${datos}</p>
        <div class="row-actions">
          ${actBtn('edit', d.id, 'Editar ' + nombre, ICO.edit, 'Editar')}
          ${actBtn('cambiar-estado', d.id, 'Cambiar estado',
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
            '', 'outline')}
          ${cerrarBtn}
          ${actBtn('duplicate', d.id, 'Duplicar ' + nombre, ICO.copy)}
          ${trashBtn('delete-list', d.id, 'Eliminar ' + nombre)}
        </div>
      </li>`;
    }).join('');

    wrap.innerHTML = '<ul class="rows">' + rows + '</ul>';
  }

  /* ================= NAVEGACIÓN PRINCIPAL + MENÚ ================= */
  const MAIN_VIEW_IDS = ['inicio', 'docs', 'cxc', 'cxp', 'clientes', 'productos', 'tareas'];

  function writeAppHistory(view, replace, extra) {
    if (!window.history || typeof window.history.pushState !== 'function') return;
    const state = Object.assign({ inVoiceApp: true, view: view }, extra || {});
    try {
      if (replace) window.history.replaceState(state, '', window.location.href);
      else window.history.pushState(state, '', window.location.href);
    } catch (e) { /* historial no disponible en este contexto */ }
  }

  function resetAppHistory() {
    if (!window.history || typeof window.history.replaceState !== 'function') return;
    try {
      window.history.replaceState({ inVoiceApp: true, view: 'inicio' }, '', window.location.href);
    } catch (e) { /* historial no disponible en este contexto */ }
  }

  function refreshMobileNav() {
    const menuOpen = document.body.classList.contains('nav-open');
    $$('#mobile-nav [data-nav-view], .desktop-nav [data-nav-view]').forEach(function (item) {
      const active = item.dataset.navView === mainView || (item.dataset.navView === 'menu' && menuOpen);
      item.classList.toggle('active', active);
      if (active && item.dataset.navView !== 'menu') item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
  }

  function switchMainView(view, navigation) {
    const options = navigation || {};
    if (!options.fromPopstate && (mainView !== view || options.replaceHistory)) {
      writeAppHistory(view, !!options.replaceHistory);
    }
    mainView = view;
    $('#view-inicio').hidden = view !== 'inicio';
    $('#view-list').hidden = view !== 'docs';
    $('#view-cxc').hidden = view !== 'cxc';
    $('#view-cxp').hidden = view !== 'cxp';
    $('#view-clientes').hidden = view !== 'clientes';
    $('#view-productos').hidden = view !== 'productos';
    $('#view-tareas').hidden = view !== 'tareas';
    $('#view-editor').hidden = true;
    $('#topbar').classList.remove('hidden');
    document.body.classList.remove('in-editor');
    closeNavPop();
    refreshMobileNav();
    closeCmdk();
    if (view === 'inicio') renderInicio();
    if (view === 'docs') renderList();
    if (view === 'cxc') renderCxC();
    if (view === 'cxp') renderCxP();
    if (view === 'clientes') renderClientes();
    if (view === 'productos') renderProductos();
    if (view === 'tareas') renderTareas();
    window.scrollTo(0, 0);
  }

  /* ---------- Menú a pantalla completa ----------
     «Más» vive en la cabecera de escritorio y en la barra móvil.
     El menú se cierra al elegir sección, con ✕ o con Esc. */
  function navPopEl() { return $('#nav-pop'); }

  function setBackgroundInert() {
    const pop = cmdkEl();
    const locked = document.body.classList.contains('nav-open') || !!$('.modal.open')
      || !!(pop && !pop.hidden);
    // #shell cubre barra superior, riel y contenido de una sola vez
    ['#shell', '#mobile-nav'].forEach(function (id) {
      const el = $(id);
      if (el) el.inert = locked;
    });
  }

  function openNavPop() {
    const pop = navPopEl();
    if (!pop || !pop.hidden) return;
    navReturnFocus = document.activeElement;
    pop.hidden = false;
    document.body.classList.add('nav-open');
    setBackgroundInert();
    $$('[data-action="toggle-menu"]').forEach(function (b) {
      b.setAttribute('aria-expanded', 'true');
    });
    refreshMobileNav();
    const close = pop.querySelector('.nav-pop-close');
    if (close && typeof close.focus === 'function') close.focus({ preventScroll: true });
  }

  function closeNavPop() {
    const pop = navPopEl();
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    document.body.classList.remove('nav-open');
    setBackgroundInert();
    const returnFocus = navReturnFocus && navReturnFocus.isConnected && navReturnFocus.getClientRects().length
      ? navReturnFocus
      : $$('[data-action="toggle-menu"]').find(function (el) { return !el.closest('#nav-pop') && el.getClientRects().length; });
    if (returnFocus) returnFocus.focus({ preventScroll: true });
    navReturnFocus = null;
    $$('[data-action="toggle-menu"]').forEach(function (b) {
      b.setAttribute('aria-expanded', 'false');
    });
    refreshMobileNav();
  }

  function toggleNavPop() {
    const pop = navPopEl();
    if (pop && pop.hidden) openNavPop(); else closeNavPop();
  }

  /* ================= PANEL DE INICIO ================= */
  /* Cuentas por pagar: cuántas siguen pendientes y por cuánto. */
  function cxpStats() {
    var pendientes = 0, total = 0;
    cuentasXPagar.forEach(function (x) {
      var ab = (x.abonos || []).reduce(function (s, a) { return s + (Number(a.monto) || 0); }, 0);
      var saldo = (Number(x.monto) || 0) - ab;
      if (saldo > 0.005) { pendientes++; total += saldo; }
    });
    return { pendientes: pendientes, total: total };
  }
  const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function monthKeyOf(iso) { return String(iso || '').slice(0, 7); }
  function daysBetween(isoA, isoB) {
    const a = new Date(isoA + 'T00:00:00'), b = new Date(isoB + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.round((a - b) / 86400000);
  }
  /* Las cifras se pintan de una vez: sin conteo animado (v4.0). */
  function paintFigure(el, to, money) {
    if (!el) return;
    const val = Number(to) || 0;
    el.textContent = money ? window.fmtMoney(val) : String(Math.round(val));
  }

  /* Cifra grande: sin centavos (se lee de un golpe) y con el importe
     exacto en el title, para quien necesite el detalle. */
  function pintarCifraCorta(el, to) {
    if (!el) return;
    const val = Number(to) || 0;
    el.textContent = window.fmtMoneyShort(val);
    el.title = window.fmtMoney(val);
  }

  /* Movimiento de un mes concreto: lo facturado y lo cobrado (abonos). */
  function monthTotals(offset) {
    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0');
    let facturado = 0, cobrado = 0;
    docs.forEach(function (d) {
      if (monthKeyOf(d.fecha) === key) facturado += computeTotals(d).total;
      (d.abonos || []).forEach(function (a) {
        if (monthKeyOf(a.fecha || d.fecha) === key) cobrado += (Number(a.monto) || 0);
      });
    });
    return { facturado: facturado, cobrado: cobrado };
  }

  /* Cobranza en una sola barra: de todo lo facturado que sigue abierto,
     cuánto se ha abonado y cuánto falta por cobrar. Un documento
     liquidado o CERRADO sale de la barra y deja de contar en el 100%. */
  function cobranzaStats() {
    let total = 0, pagado = 0, abiertos = 0, saldados = 0;
    docs.forEach(function (d) {
      if (docEstado(d).id === 'cerrado') { saldados++; return; }
      const t = computeTotals(d);
      if (t.total <= 0) return;
      const abonos = (d.abonos || []).reduce(function (s, a) { return s + (Number(a.monto) || 0); }, 0);
      if (t.total - abonos <= 0.005) { saldados++; return; }
      total += t.total;
      pagado += abonos;
      abiertos++;
    });
    const porCobrar = Math.max(0, total - pagado);
    return {
      total: total, pagado: pagado, porCobrar: porCobrar,
      abiertos: abiertos, saldados: saldados,
      pct: total > 0 ? (pagado / total) * 100 : 0
    };
  }

  function cobranzaItems(hoy) {
    const open = [];
    const paid = [];
    docs.forEach(function (d) {
      if (docEstado(d).id === 'cerrado') return; // cerrados fuera del dashboard
      const t = computeTotals(d);
      if (t.total <= 0) return;
      const item = {
        id: d.id, tipo: d.tipo, numero: d.numero || '',
        cliente: d.representante || 'Sin cliente',
        proyecto: d.proyecto || '',
        saldo: t.porPagar, total: t.total, pagado: !!t.pagado,
        vigencia: d.vigencia || '', fecha: d.fecha || '',
        estado: docEstado(d).id, entrega: d.entregaFecha || '',
        updatedAt: d.updatedAt || d.createdAt || 0
      };
      if (t.porPagar > 0.005) open.push(item);
      else if (t.pagado) paid.push(item);
    });
    function dueRank(it) {
      if (it.vigencia && it.vigencia <= hoy) return 0;
      if (it.fecha && daysBetween(hoy, it.fecha) >= 30) return 1;
      return 2;
    }
    open.sort(function (a, b) {
      const r = dueRank(a) - dueRank(b);
      return r !== 0 ? r : b.saldo - a.saldo;
    });
    paid.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return { open: open, paid: paid.slice(0, 3) };
  }

  function cobDueMeta(it, hoy) {
    if (it.pagado) return { text: 'Pagado', tone: 'ok' };
    if (it.vigencia) {
      if (it.vigencia === hoy) return { text: 'Vence hoy', tone: 'danger' };
      if (it.vigencia < hoy) {
        const n = Math.abs(daysBetween(hoy, it.vigencia));
        return { text: 'Vencida · ' + n + 'd', tone: 'danger' };
      }
      const n = daysBetween(it.vigencia, hoy);
      if (n <= 7) return { text: 'Vence en ' + n + ' día' + (n !== 1 ? 's' : ''), tone: 'warn' };
      return { text: 'Vence ' + window.fmtDate(it.vigencia), tone: '' };
    }
    const antig = it.fecha ? daysBetween(hoy, it.fecha) : 0;
    if (antig >= 30) return { text: antig + ' días', tone: 'warn' };
    return { text: 'Pendiente', tone: '' };
  }

  /* Fecha corta para la fila y la ficha del saludo: «22 may». */
  /* «29 oct»: la fecha que cabe en un renglón de lista. */
  function diaCorto(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return Number(m[3]) + ' ' + MESES_CORTOS[Number(m[2]) - 1];
  }
  window.diaCorto = diaCorto;

  /* Una fila del inicio, con la anatomía de la referencia: folio y
     proyecto a la izquierda, estado en píldora de pizarra y fecha de
     entrega a la derecha, la cifra en el mismo renglón que el cliente
     y las acciones al pie. La barra de color del canto dice el estado
     sin repetir la palabra. */
  function cobDocRow(it, hoy) {
    const due = cobDueMeta(it, hoy);
    const est = DOC_ESTADOS_MAP[it.estado] || DOC_ESTADOS_MAP.cotizado;
    const kind = it.tipo === 'cotizacion' ? 'Cotización' : 'Recibo';
    const entrega = it.entrega ? 'Entrega: ' + diaCorto(it.entrega) : due.text;
    const titulo = it.proyecto || it.cliente;
    const actions = it.pagado
      ? ''
      : '<button type="button" class="btn outline small cob-act" data-action="cob-pay" data-id="' + esc(it.id) + '" title="Registrar cobro" aria-label="Registrar cobro: ' + esc(it.cliente) + '">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>'
        + '<span class="btn-label">Cobrar</span></button>'
        + '<button type="button" class="cob-check" data-action="cob-settle" data-id="' + esc(it.id) + '" title="Marcar pagado" aria-label="Marcar pagado: ' + esc(it.cliente) + '">'
        + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
        + '</button>';
    const abrir = '<button type="button" class="cob-go" data-action="edit" data-id="' + esc(it.id) + '" title="Abrir documento" aria-label="Abrir documento: ' + esc(it.cliente) + '">'
      + '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg></button>';
    return '<article class="cob-doc tone-' + est.tone + (it.pagado ? ' is-paid' : '') + '">'
      + '<div class="cob-doc-folio"><span>' + esc(it.numero || kind) + '</span>'
      + '<span class="ord-kind">' + esc(kind) + '</span></div>'
      + '<span class="pill estado-pill ' + est.tone + '">' + esc(est.label) + '</span>'
      + '<p class="cob-doc-title" title="' + esc(titulo) + '">' + esc(titulo) + '</p>'
      + '<span class="cob-doc-amt">' + window.fmtMoney(it.pagado ? it.total : it.saldo) + '</span>'
      + '<p class="cob-doc-meta"><span class="cob-doc-client">' + esc(it.cliente) + '</span>'
      + '<span class="cob-doc-sep" aria-hidden="true">·</span>'
      + '<span class="' + (due.tone ? 'is-' + due.tone : '') + '">' + esc(entrega) + '</span></p>'
      + '<div class="cob-doc-side">' + actions + abrir + '</div>'
      + '</article>';
  }

  /* La dona de cobranza vive dentro de la tarjeta de saldo: un anillo
     SVG sin dependencias, con el porcentaje abonado al centro. */
  function cobranzaChartHTML(c) {
    const hasData = !!(c.abiertos || c.saldados);
    const pct = hasData ? Math.min(100, Math.max(0, c.pct)) : 0;
    const r = 52;
    const circ = 2 * Math.PI * r;
    const paid = (pct / 100) * circ;
    const label = hasData
      ? 'Abonado ' + Math.round(pct) + ' por ciento, por cobrar ' + Math.round(100 - pct) + ' por ciento'
      : 'Sin cobros registrados';
    return '<div class="donut' + (!hasData ? ' is-empty' : '') + '" role="img" aria-label="' + label + '">'
      + '<svg viewBox="0 0 120 120" aria-hidden="true">'
      + '<circle class="donut-track" cx="60" cy="60" r="' + r + '"></circle>'
      + '<circle class="donut-paid" cx="60" cy="60" r="' + r + '" stroke-dasharray="' + paid.toFixed(1) + ' ' + circ.toFixed(1) + '" transform="rotate(-90 60 60)"></circle>'
      + '</svg>'
      + '<span class="donut-center"><b>' + (hasData ? Math.round(pct) + '%' : '—') + '</b><small>' + (hasData ? 'abonado' : 'sin cobros') + '</small></span>'
      + '</div>';
  }

  function cobranzaDocsHTML(c, hoy) {
    if (!c.abiertos && !c.saldados) {
      return '<div class="cob-empty"><span class="panel-empty-icon" aria-hidden="true">' + window.ICONS.docs('ic-lg') + '</span>'
        + '<strong>Tu próximo proyecto empieza aquí</strong><p>Crea un recibo y lleva cada pago con claridad.</p>'
        + '<button type="button" class="btn small primary" data-action="new-recibo">Crear primer recibo</button></div>';
    }
    const items = cobranzaItems(hoy);
    const rows = items.open.map(function (it) { return cobDocRow(it, hoy); })
      .concat(items.paid.map(function (it) { return cobDocRow(it, hoy); }))
      .join('');
    if (!c.abiertos) {
      return (rows ? '<div class="cob-docs">' + rows + '</div>' : '')
        + '<p class="cob-foot">' + c.saldados + ' documento' + (c.saldados !== 1 ? 's' : '') + ' ya liquidado' + (c.saldados !== 1 ? 's' : '') + '</p>';
    }
    return (rows ? '<div class="cob-docs">' + rows + '</div>' : '')
      + '<p class="cob-foot">' + window.fmtMoney(c.total) + ' abierto en ' + c.abiertos
      + ' documento' + (c.abiertos !== 1 ? 's' : '')
      + (c.saldados ? ' · ' + c.saldados + ' ya liquidado' + (c.saldados !== 1 ? 's' : '') : '') + '</p>';
  }

  function abonarDocumento(id, monto) {
    const d = docs.find(function (x) { return x.id === id; });
    if (!d) return false;
    const t = computeTotals(d);
    const m = Number(monto);
    if (!(m > 0) || t.porPagar <= 0.005) return false;
    if (!d.abonos) d.abonos = [];
    d.abonos.push({ fecha: window.todayISO(), monto: Math.min(m, t.porPagar) });
    d.updatedAt = Date.now();
    // Si con este abono queda totalmente pagado y no está cerrado/devuelto, se marca como Pagado.
    const t2 = computeTotals(d);
    if (t2.pagado && d.estado !== 'cerrado' && d.estado !== 'devuelto') {
      d.estado = 'pagado';
    }
    storeSet('mc_docs', docs);
    if (editing && editing.id === d.id) editing.abonos = d.abonos.slice();
    return true;
  }

  function liquidarDocumento(id) {
    const d = docs.find(function (x) { return x.id === id; });
    if (!d) return false;
    return abonarDocumento(id, computeTotals(d).porPagar);
  }

  function homeDoneMap() { return storeGet('mc_home_done', {}); }
  function markHomeTaskDone(id) {
    const m = homeDoneMap();
    m[id] = Date.now();
    storeSet('mc_home_done', m);
  }

  function homeTasks(hoy, cxcData, mes) {
    const done = homeDoneMap();
    const tasks = [];
    function add(t) { if (!done[t.id]) tasks.push(t); }

    const cxpOpen = [];
    cuentasXPagar.forEach(function (c) {
      const ab = (c.abonos || []).reduce(function (s, a) { return s + (Number(a.monto) || 0); }, 0);
      const saldo = (Number(c.monto) || 0) - ab;
      if (saldo <= 0.005) return;
      cxpOpen.push({ c: c, saldo: saldo });
    });
    const cxpVencidas = cxpOpen.filter(function (x) { return x.c.vencimiento && x.c.vencimiento < hoy; });
    const cxpHoy = cxpOpen.filter(function (x) { return x.c.vencimiento === hoy; });
    if (cxpVencidas.length) {
      add({
        id: 'cxp-overdue', area: 'contabilidad',
        title: cxpVencidas.length === 1
          ? 'Pagar a ' + (cxpVencidas[0].c.proveedor || 'proveedor')
          : 'Pagar ' + cxpVencidas.length + ' cuentas vencidas',
        meta: cxpVencidas.length + ' pendiente' + (cxpVencidas.length !== 1 ? 's' : '') + ' · prioridad alta',
        prio: 'high', go: 'go-cxp'
      });
    } else if (cxpHoy.length) {
      add({
        id: 'cxp-today', area: 'contabilidad',
        title: cxpHoy.length === 1
          ? 'Pagar hoy a ' + (cxpHoy[0].c.proveedor || 'proveedor')
          : 'Pagar ' + cxpHoy.length + ' vencimientos de hoy',
        meta: cxpHoy.length + ' pendiente' + (cxpHoy.length !== 1 ? 's' : '') + ' · prioridad alta',
        prio: 'high', go: 'go-cxp'
      });
    } else if (cxpOpen.length) {
      add({
        id: 'cxp-open', area: 'contabilidad',
        title: 'Revisar cuentas por pagar',
        meta: cxpOpen.length + ' pendiente' + (cxpOpen.length !== 1 ? 's' : ''),
        prio: 'mid', go: 'go-cxp'
      });
    }
    const cobMes = mes.cobrado;
    if (cobMes > 0) {
      add({
        id: 'bank-' + String(hoy).slice(0, 7), area: 'contabilidad',
        title: 'Conciliar banco',
        meta: '1 pendiente · cobros de ' + window.fmtMoney(cobMes),
        prio: cobMes > 0 ? 'high' : 'mid', go: 'go-docs'
      });
    }

    const quotesVencidas = [];
    const quotesHoy = [];
    docs.forEach(function (d) {
      if (docEstado(d).id === 'cerrado') return;
      if (d.tipo !== 'cotizacion' || !d.vigencia) return;
      const t = computeTotals(d);
      if (t.pagado || t.total <= 0) return;
      if (d.vigencia === hoy) quotesHoy.push(d);
      else if (d.vigencia < hoy) quotesVencidas.push(d);
    });
    if (quotesHoy.length) {
      add({
        id: 'quote-today', area: 'ventas',
        title: quotesHoy.length === 1
          ? 'Seguir cotización ' + (quotesHoy[0].numero || '') + ' a ' + (quotesHoy[0].representante || 'cliente')
          : 'Seguir ' + quotesHoy.length + ' cotizaciones que vencen hoy',
        meta: quotesHoy.length + ' pendiente' + (quotesHoy.length !== 1 ? 's' : ''),
        prio: 'high', go: quotesHoy.length === 1 ? 'edit' : 'go-docs', idGo: quotesHoy[0] && quotesHoy[0].id
      });
    }
    if (quotesVencidas.length) {
      add({
        id: 'quote-expired', area: 'ventas',
        title: quotesVencidas.length === 1
          ? 'Renovar cotización a ' + (quotesVencidas[0].representante || 'cliente')
          : 'Renovar ' + quotesVencidas.length + ' cotizaciones vencidas',
        meta: quotesVencidas.length + ' pendiente' + (quotesVencidas.length !== 1 ? 's' : ''),
        prio: 'mid', go: quotesVencidas.length === 1 ? 'edit' : 'go-docs',
        idGo: quotesVencidas[0] && quotesVencidas[0].id
      });
    }
    const prospects = clientes.filter(function (c) {
      return c.tipo === 'prospecto' && c.estado !== 'ganado' && c.estado !== 'perdido';
    });
    if (prospects.length) {
      add({
        id: 'prospects', area: 'ventas',
        title: prospects.length === 1
          ? 'Emitir cotización a ' + (prospects[0].nombre || prospects[0].empresa || 'prospecto')
          : 'Dar seguimiento a ' + prospects.length + ' prospectos',
        meta: prospects.length + ' pendiente' + (prospects.length !== 1 ? 's' : ''),
        prio: 'mid', go: prospects.length === 1 ? 'new-cotizacion' : 'go-clientes'
      });
    } else if (clientes.length && !quotesHoy.length && !quotesVencidas.length && mes.facturado <= 0) {
      add({
        id: 'emit-quote', area: 'ventas',
        title: 'Emitir cotización',
        meta: '1 pendiente',
        prio: 'low', go: 'new-cotizacion'
      });
    }

    if (cxcData.length) {
      add({
        id: 'cxc-remind', area: 'cobranza',
        title: cxcData.length === 1
          ? 'Enviar recordatorio a ' + cxcData[0].cliente
          : 'Enviar recordatorio a ' + cxcData.length + ' clientes',
        meta: cxcData.length + ' pendiente' + (cxcData.length !== 1 ? 's' : ''),
        prio: cxcData.length >= 3 ? 'high' : 'mid', go: 'go-cxc'
      });
    }
    const viejos = [];
    docs.forEach(function (d) {
      if (docEstado(d).id === 'cerrado') return;
      const t = computeTotals(d);
      if (t.total <= 0 || t.porPagar <= 0.005 || !d.fecha) return;
      const antig = daysBetween(hoy, d.fecha);
      if (antig >= 30) viejos.push({ d: d, antig: antig, saldo: t.porPagar });
    });
    if (viejos.length) {
      viejos.sort(function (a, b) { return b.antig - a.antig; });
      add({
        id: 'cxc-old', area: 'cobranza',
        title: viejos.length === 1
          ? 'Cobrar saldo de ' + viejos[0].antig + ' días a ' + (viejos[0].d.representante || 'cliente')
          : 'Cobrar ' + viejos.length + ' saldos de más de 30 días',
        meta: viejos.length + ' pendiente' + (viejos.length !== 1 ? 's' : '') + ' · prioridad alta',
        prio: 'high', go: viejos.length === 1 ? 'edit' : 'go-cxc', idGo: viejos[0] && viejos[0].d.id
      });
    }

    // Tareas creadas por el usuario (mc_tareas) → también en el To-Do
    (tareas || []).forEach(function (t) {
      if (t.done) return;
      var isOver = t.deadline && t.deadline < hoy;
      var isToday = t.deadline && t.deadline === hoy;
      var metaParts = [];
      if (t.area) metaParts.push(t.area);
      if (t.prioridad) {
        metaParts.push(t.prioridad === 'high' ? 'prioridad alta' : t.prioridad === 'low' ? 'prioridad baja' : 'prioridad media');
      }
      if (t.deadline) {
        if (isOver) {
          var d = Math.abs(daysBetween(hoy, t.deadline));
          metaParts.push('vencida · ' + d + 'd');
        } else if (isToday) {
          metaParts.push('vence hoy');
        } else {
          var dd = daysBetween(t.deadline, hoy);
          if (dd <= 7) metaParts.push('vence en ' + dd + ' día' + (dd !== 1 ? 's' : ''));
          else metaParts.push('vence ' + window.fmtDate(t.deadline));
        }
      }
      if (t.docId) {
        var dd = docs.find(function (x) { return x.id === t.docId; });
        if (dd) metaParts.push((dd.tipo === 'cotizacion' ? 'COT ' : 'REC ') + (dd.numero || ''));
      }
      var prio = t.prioridad || 'mid';
      if (isOver) prio = 'high';
      else if (isToday) prio = prio === 'low' ? 'mid' : prio;
      tasks.push({
        id: 'tarea-' + t.id,
        area: t.area || 'general',
        title: t.titulo || 'Sin título',
        meta: metaParts.join(' · ') || (t.descripcion || '').slice(0, 80),
        prio: prio,
        go: 'edit-tarea',
        idGo: t.id
      });
    });

    return tasks;
  }

  /* En Inicio se ve el siguiente paso, no el archivo entero: tres tareas
     como máximo y un enlace a la vista completa. */
  function tareasHTML(tasks) {
    if (!tasks.length) {
      return '<div class="todo-empty"><span class="panel-empty-icon" aria-hidden="true">' + window.ICONS.check('ic-lg') + '</span>'
        + '<strong>Un poco de espacio para crear</strong><p>Todo en orden. Agrega tu siguiente tarea cuando quieras.</p>'
        + '<button type="button" class="btn small outline" data-action="new-tarea">Nueva tarea</button></div>';
    }
    const top = tasks.slice(0, 3);
    const rows = top.map(function (t) {
      return '<div class="todo-row">'
        + '<button type="button" class="todo-check" data-action="todo-done" data-tid="' + esc(t.id) + '" aria-label="Marcar hecha: ' + esc(t.title) + '" title="Marcar hecha"></button>'
        + '<div class="todo-body">'
        + '<span class="todo-title"><span class="todo-prio ' + t.prio + '" title="Prioridad"></span>' + esc(t.title) + '</span>'
        + '<span class="todo-meta">' + esc(t.meta || '') + '</span>'
        + '</div>'
        + '<button type="button" class="btn outline small todo-go" data-action="todo-go" data-go="' + esc(t.go || '') + '" data-id="' + esc(t.idGo || '') + '" aria-label="Ver: ' + esc(t.title) + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button>'
        + '</div>';
    }).join('');
    return '<div class="todo-rows">' + rows + '</div>'
      + (tasks.length > 3
        ? '<p class="todo-more">+' + (tasks.length - 3) + ' tarea' + (tasks.length - 3 !== 1 ? 's' : '') + ' más en Tareas</p>'
        : '');
  }

  /* Cifras del mes: una lectura compacta por renglón, en el panel de
     apoyo. Icono + etiqueta a la izquierda, número a la derecha y el
     detalle (variación o acción) debajo. */
  function statCardHtml(o) {
    return '<div class="fig tone-' + (o.tone || 'accent') + '">'
      + '<span class="fig-ico">' + o.icon + '</span>'
      + '<span class="fig-label">' + o.label + '</span>'
      + '<span class="fig-value" data-count="' + o.value + '" data-money="' + (o.money ? 1 : 0) + '">'
      + (o.money ? window.fmtMoney(0) : '0') + '</span>'
      + '<span class="fig-foot">' + (o.foot || '') + '</span>'
      + '</div>';
  }

  function renderInicio() {
    const host = $('#stat-grid');
    if (!host) return;

    const cxcData = getCxCData();
    const cxcTotal = cxcData.reduce(function (s, c) { return s + c.saldoTotal; }, 0);
    const cxp = cxpStats();
    const mes = monthTotals(0);
    const mesPrev = monthTotals(1);
    const factMes = mes.facturado, factPrev = mesPrev.facturado;
    const cobMes = mes.cobrado, cobPrev = mesPrev.cobrado;

    /* ---------- Saludo y ficha de fecha ---------- */
    const now = new Date();
    const hoy = window.todayISO();
    $('#hero-kicker').textContent = now.getDate() + ' ' + MESES_CORTOS[now.getMonth()] + ' ' + now.getFullYear();
    const h = now.getHours();
    $('#hero-title').textContent = h < 12 ? 'Buenos días' : (h < 19 ? 'Buenas tardes' : 'Buenas noches');

    const saldados = docs.filter(function (d) { return computeTotals(d).pagado; }).length;

    const vencidasCxp = cuentasXPagar.filter(function (c) {
      const ab = (c.abonos || []).reduce(function (s, a) { return s + (Number(a.monto) || 0); }, 0);
      return c.vencimiento && c.vencimiento < hoy && ((Number(c.monto) || 0) - ab) > 0.005;
    }).length;

    /* ---------- Las cuatro cifras del panel ----------
       Dos cuentan el trabajo (documentos activos, por entregar) y dos
       el dinero (lo vendido del mes y lo que falta cobrar). */
    const cerradosCount = docs.filter(function (d) { return docEstado(d).id === 'cerrado'; }).length;
    const activosCount = docs.length - cerradosCount;
    paintFigure($('#kpi-activos'), activosCount, false);
    $('#kpi-activos').removeAttribute('title');

    const porEntregar = docs.filter(function (d) {
      const est = docEstado(d).id;
      return est === 'aprobado' || est === 'produccion' || est === 'enviado';
    });
    const atrasadas = porEntregar.filter(function (d) { return d.entregaFecha && d.entregaFecha < hoy; });
    paintFigure($('#kpi-entregar'), porEntregar.length, false);
    const notaEnt = $('#kpi-entregar-nota');
    if (notaEnt) {
      let nota = 'Nada en producción';
      if (atrasadas.length) {
        nota = atrasadas.length + ' atrasada' + (atrasadas.length !== 1 ? 's' : '');
      } else if (porEntregar.length) {
        const proxima = porEntregar.map(function (d) { return d.entregaFecha; })
          .filter(Boolean).sort()[0];
        nota = proxima ? 'Entrega ' + diaCorto(proxima) : porEntregar.length + ' en curso';
      }
      notaEnt.textContent = nota;
      notaEnt.parentElement.classList.toggle('is-alert', !!atrasadas.length);
    }

    pintarCifraCorta($('#kpi-ventas'), factMes);
    const notaVentas = $('#kpi-ventas-nota');
    if (notaVentas) {
      const nota = MESES_LARGOS[now.getMonth()];
      if (factPrev > 0 && factMes > 0) {
        const pct = Math.round(((factMes - factPrev) / factPrev) * 100);
        notaVentas.textContent = nota + ' · ' + (pct > 0 ? '+' : '') + pct + '%';
        notaVentas.title = 'Facturado de ' + nota + ' frente al mes pasado';
      } else {
        notaVentas.textContent = 'Ver reporte';
        notaVentas.removeAttribute('title');
      }
    }

    pintarCifraCorta($('#hero-balance-value'), cxcTotal);
    const notaCobro = $('#kpi-cobro-nota');
    if (notaCobro) {
      notaCobro.textContent = cxcData.length
        ? cxcData.length + ' cliente' + (cxcData.length !== 1 ? 's' : '') + ' con saldo'
        : 'Todo al día';
    }

    /* ---------- Indicadores ---------- */
    function delta(actual, anterior) {
      if (anterior <= 0 && actual <= 0) {
        return '<span class="stat-delta flat"><span class="stat-dot"></span>=</span>';
      }
      if (anterior <= 0) {
        return '<span class="stat-delta up"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>nuevo</span>';
      }
      const pct = ((actual - anterior) / anterior) * 100;
      if (Math.abs(pct) < 1) return '<span class="stat-delta flat"><span class="stat-dot"></span>=</span>';
      const up = pct > 0;
      const arrow = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">'
        + (up ? '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'
              : '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>')
        + '</svg>';
      return '<span class="stat-delta ' + (up ? 'up' : 'down') + '">' + arrow + Math.abs(Math.round(pct)) + '%</span>'
        + '<span>vs. mes pasado</span>';
    }
    function cta(action, label) {
      return '<button type="button" class="stat-cta" data-action="' + action + '">' + label + '</button>';
    }

    const ICONO = {
      cobrar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>',
      pagar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
      factura: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="13" y2="18"/></svg>',
      cobrado: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
    };

    host.innerHTML =
      statCardHtml({
        i: 0, tone: 'warn', icon: ICONO.pagar, label: 'Por pagar',
        value: cxp.total, money: true,
        foot: (cxp.total <= 0
          ? delta(0, 0) + ' ' + cta('new-cxp', 'Registrar gasto')
          : '<span>' + cxp.pendientes + ' pendiente' + (cxp.pendientes !== 1 ? 's' : '') + '</span>'
            + (vencidasCxp
              ? ' · <span class="stat-delta down"><span class="stat-dot"></span>' + vencidasCxp + ' vencida' + (vencidasCxp !== 1 ? 's' : '') + '</span>'
              : ' · <span class="stat-delta up"><span class="stat-dot"></span>al día</span>'))
      }) +
      statCardHtml({
        i: 1, tone: 'accent', icon: ICONO.factura, label: 'Facturado',
        value: factMes, money: true,
        foot: (factMes <= 0
          ? delta(factMes, factPrev) + ' ' + cta('new-recibo', docs.length ? 'Nuevo recibo' : 'Crear primer recibo')
          : '<span>' + MESES_LARGOS[now.getMonth()] + '</span> · ' + delta(factMes, factPrev))
      }) +
      statCardHtml({
        i: 2, tone: 'ok', icon: ICONO.cobrado, label: 'Cobrado',
        value: cobMes, money: true,
        foot: (cobMes <= 0
          ? delta(cobMes, cobPrev) + ' ' + cta('new-recibo', 'Registrar recibo')
          : '<span>' + MESES_LARGOS[now.getMonth()] + '</span> · ' + delta(cobMes, cobPrev)
            + (saldados ? ' · <span>' + saldados + ' saldado' + (saldados !== 1 ? 's' : '') + '</span>' : ''))
      });

    $$('#stat-grid .fig-value').forEach(function (el) {
      paintFigure(el, Number(el.dataset.count) || 0, el.dataset.money === '1');
    });
    const figsNote = $('#figs-note');
    if (figsNote) figsNote.textContent = MESES_LARGOS[now.getMonth()] + ' ' + now.getFullYear();

    /* ---------- Cobranza: dona en la tarjeta de saldo + lista de documentos ---------- */
    const cob = cobranzaStats();
    $('#hero-chart-host').innerHTML = cobranzaChartHTML(cob);
    $('#chart-host').innerHTML = cobranzaDocsHTML(cob, hoy);
    $('#cob-note').textContent = cob.abiertos
      ? cob.abiertos + ' abierto' + (cob.abiertos !== 1 ? 's' : '')
      : (cob.saldados ? 'Liquidados' : '');
    const archivoBtn = $('#cob-archivo');
    if (archivoBtn) {
      archivoBtn.hidden = !cerradosCount;
      archivoBtn.textContent = cerradosCount
        ? cerradosCount + ' en archivo'
        : '';
      archivoBtn.title = 'Ver los documentos cerrados';
    }

    /* ---------- Siguiente paso ---------- */
    const tasks = homeTasks(hoy, cxcData, mes);
    const todoHost = $('#todo-host');
    if (todoHost) todoHost.innerHTML = tareasHTML(tasks);
    const todoNote = $('#todo-note');
    if (todoNote) {
      todoNote.textContent = tasks.length
        ? 'Tienes ' + tasks.length + ' tarea' + (tasks.length !== 1 ? 's' : '') + ' pendiente' + (tasks.length !== 1 ? 's' : '')
        : 'Todo en orden por ahora.';
    }

  }

  /* ================= CUENTAS POR COBRAR ================= */
  function getCxCData() {
    // Agrupa saldos pendientes de los documentos por cliente
    var byClient = {};
    docs.forEach(function(d) {
      if (docEstado(d).id === 'cerrado') return; // documentos cerrados no se cobran
      var t = computeTotals(d);
      if (t.total <= 0) return;
      var abonosTotal = (d.abonos || []).reduce(function(s, a) { return s + (Number(a.monto) || 0); }, 0);
      var saldo = t.total - abonosTotal;
      if (saldo <= 0.005) return; // sin saldo pendiente
      var key = (d.representante || d.email || 'Sin cliente').trim();
      if (!key) key = 'Sin cliente';
      if (!byClient[key]) {
        byClient[key] = {
          cliente: key,
          email: d.email || '',
          saldoTotal: 0,
          docs: []
        };
      }
      byClient[key].saldoTotal += saldo;
      byClient[key].docs.push({
        id: d.id,
        tipo: d.tipo,
        numero: d.numero,
        proyecto: d.proyecto || '',
        fecha: d.fecha,
        total: t.total,
        abonado: abonosTotal,
        saldo: saldo
      });
    });
    return Object.keys(byClient).map(function(k) { return byClient[k]; })
      .sort(function(a, b) { return b.saldoTotal - a.saldoTotal; });
  }

  function renderCxC() {
    var data = getCxCData();
    var totalGeneral = data.reduce(function(s, c) { return s + c.saldoTotal; }, 0);
    $('#cxc-total').textContent = window.fmtMoney(totalGeneral);
    $('#cxc-clientes').textContent = String(data.length);

    var q = cxcQuery.trim().toLowerCase();
    var filtered = data.filter(function(c) {
      if (!q) return true;
      var text = (c.cliente + ' ' + c.email + ' ' + c.docs.map(function(d) { return d.numero + ' ' + d.proyecto; }).join(' ')).toLowerCase();
      return text.indexOf(q) >= 0;
    });

    setCount('cxc-count', filtered.length, 'cliente con saldo', 'clientes con saldo');

    var wrap = $('#cxc-list');
    if (!filtered.length) {
      wrap.innerHTML = '<div class="empty"><span class="empty-icon">' + window.ICONS.coin('ic-lg') + '</span>'
        + '<h3>' + (data.length ? 'No hay coincidencias' : 'No hay cuentas por cobrar') + '</h3>'
        + '<p>' + (data.length ? 'Prueba con otra búsqueda.' : 'Los saldos pendientes de tus recibos y cotizaciones aparecerán aquí automáticamente.') + '</p></div>';
      return;
    }

    var rows = filtered.map(function(c) {
      var origen = c.docs.reduce(function(s, d) { return s + d.total; }, 0);
      var abonado = c.docs.reduce(function(s, d) { return s + d.abonado; }, 0);
      var pct = origen > 0 ? Math.min(100, (abonado / origen) * 100) : 0;

      var docsHtml = c.docs.map(function(d) {
        var badge = d.tipo === 'cotizacion'
          ? '<span class="pill mini ghost">COT</span>'
          : '<span class="pill mini solid">REC</span>';
        return '<div class="row-doc-item">'
          + '<span>' + badge + ' ' + esc(d.numero)
          + (d.proyecto ? ' <span class="muted">— ' + esc(d.proyecto) + '</span>' : '') + '</span>'
          + '<span><strong>' + window.fmtMoney(d.saldo) + '</strong> <span class="muted">de ' + window.fmtMoney(d.total) + '</span></span>'
          + '</div>';
      }).join('');

      var meta = [
        c.email ? '<span>' + esc(c.email) + '</span>' : '',
        '<span>' + c.docs.length + ' documento' + (c.docs.length !== 1 ? 's' : '') + '</span>'
      ].filter(Boolean).join(SEP);

      return '<li class="row row-cxc" data-cliente="' + esc(c.cliente) + '">'
        + '<div class="row-main">'
        + '<p class="row-title">' + esc(c.cliente) + '</p>'
        + '<p class="row-meta">' + meta + '</p>'
        + '</div>'
        + '<div class="row-figure">'
        + '<strong>' + window.fmtMoney(c.saldoTotal) + '</strong>'
        + '<span class="row-figure-note">de ' + window.fmtMoney(origen) + ' · ' + Math.round(pct) + '% abonado</span>'
        + '</div>'
        + '<div class="row-progress"><span class="row-progress-bar" style="width:' + pct.toFixed(1) + '%"></span></div>'
        + '<div class="row-docs">' + docsHtml + '</div>'
        + '<div class="row-status"><span class="pill mini warn">Saldo pendiente</span></div>'
        + '<div class="row-actions">'
        + '<button type="button" class="btn small outline" data-action="view-cxc-doc" data-docid="' + esc(c.docs[0].id) + '" aria-label="Ver documento de ' + esc(c.cliente) + '" title="Ver documento">'
        + ICO.open + '<span class="btn-label">Ver documento</span></button>'
        + (c.docs.length === 1
          ? '<button type="button" class="btn small outline" data-action="cob-pay" data-id="' + esc(c.docs[0].id) + '" aria-label="Registrar cobro de ' + esc(c.cliente) + '" title="Registrar cobro">'
            + ICO.cash + '<span class="btn-label">Cobrar</span></button>'
            + '<button type="button" class="btn small outline" data-action="cob-settle" data-id="' + esc(c.docs[0].id) + '" aria-label="Marcar pagado a ' + esc(c.cliente) + '" title="Marcar pagado">'
            + window.ICONS.check() + '<span class="btn-label">Liquidar</span></button>'
          : '')
        + '</div>'
        + '</li>';
    }).join('');

    wrap.innerHTML = '<ul class="rows">' + rows + '</ul>';
  }

  /* ================= CUENTAS POR PAGAR ================= */
  function renderCxP() {
    var totalPendiente = 0, totalPagadas = 0, totalPendientes = 0;
    cuentasXPagar.forEach(function(c) {
      var abonosTotal = (c.abonos || []).reduce(function(s, a) { return s + (Number(a.monto) || 0); }, 0);
      var saldo = c.monto - abonosTotal;
      if (saldo <= 0.005) totalPagadas++; else totalPendientes++;
      totalPendiente += saldo;
    });

    $('#cxp-total').textContent = window.fmtMoney(totalPendiente);
    $('#cxp-pagadas').textContent = String(totalPagadas);
    $('#cxp-pendientes').textContent = String(totalPendientes);

    paintChips('.chip[data-cxp-filter]', 'cxpFilter', cxpFilter);

    var q = cxpQuery.trim().toLowerCase();
    var filtered = cuentasXPagar.filter(function(c) {
      var okFilter = true;
      if (cxpFilter !== 'todas') {
        var abonosTotal = (c.abonos || []).reduce(function(s, a) { return s + (Number(a.monto) || 0); }, 0);
        var saldo = c.monto - abonosTotal;
        if (cxpFilter === 'pagada' && saldo > 0.005) okFilter = false;
        if (cxpFilter === 'pendiente' && (saldo <= 0.005 || abonosTotal > 0)) okFilter = false;
        if (cxpFilter === 'parcial' && (saldo <= 0.005 || abonosTotal <= 0)) okFilter = false;
      }
      var okQ = true;
      if (q) {
        var text = ((c.proveedor || '') + ' ' + (c.concepto || '') + ' ' + (c.folio || '')).toLowerCase();
        okQ = text.indexOf(q) >= 0;
      }
      return okFilter && okQ;
    }).sort(function(a, b) {
      // Primero vencidas, luego por fecha de vencimiento
      var now = window.todayISO();
      var aVenc = (a.vencimiento && a.vencimiento < now && (a.monto - (a.abonos || []).reduce(function(s, x) { return s + (Number(x.monto) || 0); }, 0)) > 0.005) ? 0 : 1;
      var bVenc = (b.vencimiento && b.vencimiento < now && (b.monto - (b.abonos || []).reduce(function(s, x) { return s + (Number(x.monto) || 0); }, 0)) > 0.005) ? 0 : 1;
      if (aVenc !== bVenc) return aVenc - bVenc;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    setCount('cxp-count', filtered.length, 'cuenta', 'cuentas',
      cxpFilter === 'todas' ? '' : ({ pendiente: 'pendientes', pagada: 'pagadas', parcial: 'con pago parcial' })[cxpFilter]);

    var wrap = $('#cxp-list');
    if (!filtered.length) {
      wrap.innerHTML = '<div class="empty"><span class="empty-icon">' + window.ICONS.clipboard('ic-lg') + '</span>'
        + '<h3>' + (cuentasXPagar.length ? 'No hay coincidencias' : 'No hay cuentas por pagar') + '</h3>'
        + '<p>' + (cuentasXPagar.length ? 'Prueba con otra búsqueda o filtro.' : 'Registra tus gastos y facturas pendientes de pago.') + '</p>'
        + '<div class="empty-actions"><button class="btn primary" data-action="new-cxp"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Nueva cuenta por pagar</button></div></div>';
      return;
    }

    var catLabels = {
      material: 'Material', servicio: 'Servicio', renta: 'Renta',
      servicios: 'Servicios', nomina: 'Nómina', impuestos: 'Impuestos', otro: 'Otro'
    };

    var rows = filtered.map(function(c) {
      var abonosTotal = (c.abonos || []).reduce(function(s, a) { return s + (Number(a.monto) || 0); }, 0);
      var saldo = c.monto - abonosTotal;
      var status, statusClass, statusPill;
      if (saldo <= 0.005) { status = 'Pagada'; statusClass = 'is-paid'; statusPill = 'ok'; }
      else if (abonosTotal > 0) { status = 'Pago parcial'; statusClass = 'is-partial'; statusPill = 'warn'; }
      else { status = 'Pendiente'; statusClass = 'is-open'; statusPill = 'ghost'; }

      var pct = c.monto > 0 ? Math.min(100, (abonosTotal / c.monto) * 100) : 0;
      var vencida = c.vencimiento && c.vencimiento < window.todayISO() && saldo > 0.005;
      var nombre = c.proveedor || c.folio || 'esta cuenta';

      /* El vencimiento es el dato que se mira; la emisión sólo se necesita
         para el registro, así que viaja como fecha corta y con tooltip. */
      var emision = c.fechaEmision || c.fecha;
      var meta = [
        '<span class="pill mini">' + esc(catLabels[c.categoria] || c.categoria || 'Otro') + '</span>',
        c.folio ? '<span>' + esc(c.folio) + '</span>' : '',
        emision ? '<span class="row-meta-soft" title="Emitida el ' + window.fmtDate(emision) + '">' + window.diaCorto(emision) + '</span>' : '',
        c.vencimiento ? '<span class="row-meta-strong">Vence ' + window.fmtDate(c.vencimiento) + '</span>' : ''
      ].filter(Boolean).join(SEP);

      return '<li class="row row-cxp ' + statusClass + (vencida ? ' is-overdue' : '') + '">'
        + '<div class="row-main">'
        + '<p class="row-title">' + esc(c.proveedor || 'Sin proveedor') + '</p>'
        + (c.concepto ? '<p class="row-sub">' + esc(c.concepto) + '</p>' : '')
        + '<p class="row-meta">' + meta + '</p>'
        + '</div>'
        + '<div class="row-figure">'
        + '<strong>' + window.fmtMoney(saldo) + '</strong>'
        + '<span class="row-figure-note">de ' + window.fmtMoney(c.monto) + '</span>'
        + '</div>'
        + '<div class="row-progress"><span class="row-progress-bar" style="width:' + pct.toFixed(1) + '%"></span></div>'
        + '<div class="row-status">'
        + '<span class="pill mini ' + statusPill + '">' + status + '</span>'
        + (vencida ? '<span class="cxp-vencida">' + window.ICONS.warning() + ' Vencida ' + window.fmtDate(c.vencimiento) + '</span>' : '')
        + (abonosTotal > 0 && !vencida ? '<span class="row-figure-note">' + (c.abonos || []).length + ' abono' + ((c.abonos || []).length !== 1 ? 's' : '') + '</span>' : '')
        + '</div>'
        + '<div class="row-actions">'
        + actBtn('edit-cxp', c.id, 'Editar cuenta de ' + nombre, ICO.edit, 'Editar')
        + actBtn('quick-pay-cxp', c.id, 'Abonar a ' + nombre, ICO.cash, 'Abonar')
        + trashBtn('del-cxp', c.id, 'Eliminar cuenta de ' + nombre)
        + '</div>'
        + '</li>';
    }).join('');

    wrap.innerHTML = '<ul class="rows">' + rows + '</ul>';
  }

  function openCxpModal(cxp) {
    if (cxp) {
      editingCxp = JSON.parse(JSON.stringify(cxp));
      $('#modal-cxp-title').textContent = 'Editar cuenta por pagar';
    } else {
      editingCxp = {
        id: window.uid(),
        proveedor: '', folio: '', concepto: '',
        monto: 0, vencimiento: '', fechaEmision: window.todayISO(),
        categoria: 'material', notas: '',
        abonos: [],
        createdAt: Date.now(), updatedAt: Date.now()
      };
      $('#modal-cxp-title').textContent = 'Nueva cuenta por pagar';
    }
    renderCxpModal();
    $('#modal-cxp').classList.add('open');
  }

  function renderCxpModal() {
    if (!editingCxp) return;
    $('#cxp-proveedor').value = editingCxp.proveedor || '';
    $('#cxp-folio').value = editingCxp.folio || '';
    $('#cxp-concepto').value = editingCxp.concepto || '';
    $('#cxp-monto').value = editingCxp.monto || '';
    $('#cxp-vencimiento').value = editingCxp.vencimiento || '';
    $('#cxp-fecha-emision').value = editingCxp.fechaEmision || '';
    $('#cxp-categoria').value = editingCxp.categoria || 'material';
    $('#cxp-notas').value = editingCxp.notas || '';

    var abWrap = $('#cxp-abonos-list');
    abWrap.innerHTML = (editingCxp.abonos || []).map(function(a, i) {
      return '<div class="cxp-abono-row" data-index="' + i + '">'
        + '<input class="cxp-a-fecha" type="date" value="' + esc(a.fecha) + '">'
        + '<input class="cxp-a-monto" type="number" min="0" step="0.01" placeholder="Monto" value="' + esc(a.monto) + '">'
        + '<button class="icon-btn" data-action="del-cxp-abono" data-index="' + i + '" title="Quitar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
        + '</div>';
    }).join('');
    updateCxpSaldo();
  }

  function syncCxpForm() {
    if (!editingCxp) return;
    var g = function(id) { var el = $('#' + id); return el ? el.value : ''; };
    editingCxp.proveedor = g('cxp-proveedor');
    editingCxp.folio = g('cxp-folio');
    editingCxp.concepto = g('cxp-concepto');
    editingCxp.monto = Number(g('cxp-monto')) || 0;
    editingCxp.vencimiento = g('cxp-vencimiento');
    editingCxp.fechaEmision = g('cxp-fecha-emision');
    editingCxp.categoria = g('cxp-categoria');
    editingCxp.notas = g('cxp-notas');

    $$('#cxp-abonos-list .cxp-abono-row').forEach(function(row) {
      var i = Number(row.dataset.index);
      if (!editingCxp.abonos[i]) editingCxp.abonos[i] = { fecha: '', monto: 0 };
      editingCxp.abonos[i].fecha = $('.cxp-a-fecha', row).value;
      editingCxp.abonos[i].monto = $('.cxp-a-monto', row).value;
    });
  }

  function updateCxpSaldo() {
    if (!editingCxp) return;
    syncCxpForm();
    var abonosTotal = (editingCxp.abonos || []).reduce(function(s, a) { return s + (Number(a.monto) || 0); }, 0);
    var saldo = editingCxp.monto - abonosTotal;
    var el = $('#cxp-saldo');
    if (el) el.textContent = window.fmtMoney(saldo);
  }

  function saveCxp() {
    if (!editingCxp) return;
    syncCxpForm();
    editingCxp.updatedAt = Date.now();
    if (!editingCxp.proveedor || !editingCxp.proveedor.trim()) {
      toast('Escribe el nombre del proveedor');
      return;
    }
    if (editingCxp.monto <= 0) {
      toast('El monto debe ser mayor a 0');
      return;
    }
    var idx = cuentasXPagar.findIndex(function(c) { return c.id === editingCxp.id; });
    if (idx >= 0) cuentasXPagar[idx] = editingCxp; else cuentasXPagar.push(editingCxp);
    storeSet('mc_cxp', cuentasXPagar);
    $('#modal-cxp').classList.remove('open');
    editingCxp = null;
    renderCxP();
    toast('Cuenta por pagar guardada ✓');
  }

  /* ================= CLIENTES / PROSPECTOS (directorio) ================= */
  const CLI_ESTADOS = {
    nuevo: 'Nuevo', contactado: 'Contactado', negociacion: 'En negociación',
    ganado: 'Ganado', perdido: 'Perdido'
  };
  const CLI_ORIGENES = {
    recomendacion: 'Recomendación', redes: 'Redes sociales', sitio: 'Sitio web',
    cliente_existente: 'Cliente existente', evento: 'Evento o feria',
    publicidad: 'Publicidad', otro: 'Otro'
  };
  const CLI_METODOS = {
    efectivo: 'Efectivo', transferencia: 'Transferencia',
    tarjeta_credito: 'Tarjeta de crédito', tarjeta_debito: 'Tarjeta de débito',
    cheque: 'Cheque', otro: 'Otro'
  };

  function cliTipo(c) { return (c && c.tipo === 'prospecto') ? 'prospecto' : 'cliente'; }
  function cliOrigen(c) {
    const key = String((c && c.origen) || '').trim();
    return CLI_ORIGENES[key] || key;
  }
  function cliMetodo(c) {
    const key = String((c && c.metodoPago) || '').trim();
    return CLI_METODOS[key] || key;
  }

  function fmtCliFecha(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (x) => String(x).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function renderClientes() {
    const wrap = $('#cli-list');
    if (!wrap) return;
    const q = cliQuery.trim().toLowerCase();
    const filtered = clientes.filter(function(c) {
      const okTipo = cliFilter === 'todos' || cliTipo(c) === cliFilter;
      const okQ = !q || [c.nombre, c.empresa, c.email, c.telefono, c.direccion, c.notas,
        c.rfc, cliOrigen(c), cliMetodo(c), c.seguimiento]
        .join(' ').toLowerCase().includes(q);
      return okTipo && okQ;
    }).sort(function(a, b) {
      return (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' });
    });

    paintChips('.chip[data-cli-filter]', 'cliFilter', cliFilter);

    setCount('cli-count', filtered.length, 'contacto', 'contactos',
      cliFilter === 'todos' ? '' : (cliFilter === 'cliente' ? 'clientes' : 'prospectos'));

    if (!filtered.length) {
      wrap.innerHTML = `
        <div class="empty" role="status">
          <span class="empty-icon">${window.ICONS.user('ic-lg')}</span>
          <h3>${clientes.length ? 'Ningún contacto coincide' : 'Aún no hay clientes ni prospectos'}</h3>
          <p>${clientes.length ? 'Prueba con otra búsqueda o quita los filtros.' : 'Agrega tu primer contacto: lo reutilizarás en recibos y cotizaciones con un toque.'}</p>
          <div class="empty-actions">
            <button class="btn primary" data-action="new-cliente">Nuevo cliente</button>
            <button class="btn outline" data-action="new-prospecto">Nuevo prospecto</button>
          </div>
        </div>`;
      return;
    }

    const rows = filtered.map(function(c) {
      const tipo = cliTipo(c);
      const nombre = String(c.nombre || '').trim() || 'Sin nombre';
      const initials = nombre.trim().split(/\s+/).filter(Boolean).slice(0, 2)
        .map(function(part) { return part.charAt(0); }).join('').toUpperCase();
      const stamp = tipo === 'prospecto'
        ? '<span class="pill ghost mini">Prospecto</span>'
        : '<span class="pill solid mini">Cliente</span>';
      const estado = (tipo === 'prospecto' && c.estado)
        ? `<span class="cli-estado" data-estado="${esc(c.estado)}">${esc(CLI_ESTADOS[c.estado] || c.estado)}</span>`
        : '';
      const contacto = [
        c.rfc ? `<span title="RFC: ${esc(c.rfc)}">RFC ${esc(c.rfc)}</span>` : '',
        c.email ? `<span title="Correo: ${esc(c.email)}">${esc(c.email)}</span>` : '',
        c.telefono ? `<span title="Teléfono: ${esc(c.telefono)}">${esc(c.telefono)}</span>` : '',
        c.direccion ? `<span title="Dirección: ${esc(c.direccion)}">${esc(c.direccion)}</span>` : ''
      ].filter(Boolean).join(SEP);
      const origen = (tipo === 'prospecto' && c.origen)
        ? `<p class="row-meta"><span>Origen: ${esc(cliOrigen(c))}</span></p>`
        : '';
      const metodo = (tipo === 'cliente' && c.metodoPago)
        ? `<span class="pill mini">${esc(cliMetodo(c))}</span>`
        : '';
      const hoyISO = window.todayISO();
      const segOver = c.seguimiento < hoyISO && c.estado !== 'ganado' && c.estado !== 'perdido';
      const seg = (tipo === 'prospecto' && c.seguimiento)
        ? `<span class="cli-seg${segOver ? ' is-over' : ''}">Seguimiento ${esc(window.fmtDate(c.seguimiento))}</span>`
        : '';
      const id = esc(c.id);
      const safeName = esc(nombre);

      return `
        <li class="row row-cli">
          <span class="row-avatar" aria-hidden="true">${esc(initials || '·')}</span>
          <div class="row-main">
            <p class="row-title" title="${safeName}">${safeName}</p>
            ${c.empresa ? `<p class="row-meta"><span>${esc(c.empresa)}</span></p>` : ''}
            <p class="row-meta">${contacto || '<span>Sin datos de contacto</span>'}</p>
            ${origen}
            ${c.notas ? `<p class="row-sub">${esc(c.notas)}</p>` : ''}
          </div>
          <div class="row-status">${stamp}${estado}${seg}${metodo}</div>
          <div class="row-actions">
            ${actBtn('edit-cliente', c.id, 'Editar ' + nombre, ICO.edit, 'Editar')}
            ${trashBtn('del-cliente-card', c.id, 'Eliminar ' + nombre)}
          </div>
        </li>`;
    }).join('');

    wrap.innerHTML = `<ul class="rows" aria-label="Directorio de clientes y prospectos">${rows}</ul>`;
  }

  /* La hoja de contacto cambia de copy y de campos según el tipo. */
  function updateCliSheetCopy() {
    const isProspect = cliModalTipo === 'prospecto';
    const editing = !!editingCliente;
    const kicker = $('#cl-kicker');
    if (kicker) kicker.textContent = (editing ? 'Editando ' : 'Nuevo ') + (isProspect ? 'prospecto' : 'cliente');
    const title = $('#modal-cliente-title');
    if (title) title.textContent = (editing ? 'Editar ' : 'Crear ') + (isProspect ? 'prospecto' : 'cliente');
    const sub = $('#cl-sub');
    if (sub) {
      sub.textContent = isProspect
        ? 'Registra un contacto potencial para dar seguimiento y convertirlo en cliente.'
        : 'Agrega un cliente para gestionar sus cotizaciones, recibos y documentos.';
    }
    const save = $('#cl-save-label');
    if (save) save.textContent = 'Guardar ' + (isProspect ? 'prospecto' : 'cliente');
  }

  function setCliTipo(t) {
    cliModalTipo = t === 'prospecto' ? 'prospecto' : 'cliente';
    const isProspect = cliModalTipo === 'prospecto';
    $$('#cli-tipo-seg .seg-btn').forEach(function(b) {
      const on = b.dataset.cliTipo === cliModalTipo;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    ['#cl-rfc-card', '#cl-metodo-card'].forEach(function(sel) {
      const el = $(sel); if (el) el.hidden = isProspect;
    });
    ['#cl-origen-card', '#cl-seguimiento-pair'].forEach(function(sel) {
      const el = $(sel); if (el) el.hidden = !isProspect;
    });
    const seg = $('#cl-seguimiento');
    if (isProspect && seg && !seg.value) seg.value = window.todayISO();
    updateCliSheetCopy();
  }

  /* La píldora de sync del formulario es un espejo de la barra superior. */
  function mirrorSheetSync() {
    const src = $('#sync-pill');
    const dst = $('#sheet-sync');
    if (!src || !dst) return;
    dst.textContent = src.textContent;
    dst.className = 'sync-pill ' + src.className.split(' ').filter(function(c) {
      return c && c !== 'sync-pill';
    }).join(' ');
  }

  function openClienteModal(id, tipoDef) {
    editingCliente = id ? (clientes.find(function(c) { return c.id === id; }) || null) : null;
    const c = editingCliente;
    const tipo = c ? cliTipo(c) : (tipoDef === 'prospecto' ? 'prospecto' : 'cliente');
    $('#cl-nombre').value = c ? (c.nombre || '') : '';
    $('#cl-empresa').value = c ? (c.empresa || '') : '';
    $('#cl-email').value = c ? (c.email || '') : '';
    $('#cl-telefono').value = c ? (c.telefono || '') : '';
    $('#cl-direccion').value = c ? (c.direccion || '') : '';
    $('#cl-rfc').value = c ? (c.rfc || '') : '';
    $('#cl-metodo').value = c ? (c.metodoPago || '') : '';
    $('#cl-origen').value = c ? (c.origen || '') : '';
    $('#cl-seguimiento').value = c ? (c.seguimiento || '') : (tipo === 'prospecto' ? window.todayISO() : '');
    $('#cl-estado').value = (c && c.estado) || 'nuevo';
    $('#cl-notas').value = c ? (c.notas || '') : '';
    setCliTipo(tipo);
    mirrorSheetSync();
    const body = $('#modal-cliente .sheet-body');
    if (body) body.scrollTop = 0;
    $('#modal-cliente').classList.add('open');
    setTimeout(function() { const n = $('#cl-nombre'); if (n) n.focus(); }, 80);
  }

  function saveClienteFromModal() {
    const g = function(id) { const el = $('#' + id); return el ? el.value.trim() : ''; };
    const nombre = g('cl-nombre');
    if (!nombre) {
      toast('Escribe el nombre del contacto');
      const n = $('#cl-nombre'); if (n) n.focus();
      return;
    }
    const now = Date.now();
    let c = editingCliente;
    const esNuevo = !c;
    if (esNuevo) {
      c = { id: window.uid(), createdAt: now };
      clientes.push(c);
    }
    c.tipo = cliModalTipo;
    c.nombre = nombre;
    c.empresa = g('cl-empresa');
    c.email = g('cl-email');
    c.telefono = g('cl-telefono');
    c.direccion = g('cl-direccion');
    c.notas = g('cl-notas');
    c.rfc = g('cl-rfc').toUpperCase().replace(/\s+/g, '');
    c.metodoPago = g('cl-metodo');
    c.origen = g('cl-origen');
    c.seguimiento = g('cl-seguimiento');
    c.estado = cliModalTipo === 'prospecto' ? ($('#cl-estado').value || 'nuevo') : '';
    c.updatedAt = now;

    storeSet('mc_clientes', clientes); // también avisa al sincronizador
    $('#modal-cliente').classList.remove('open');
    editingCliente = null;
    if (mainView === 'clientes') renderClientes();
    else if (mainView === 'inicio') renderInicio();
    toast((cliModalTipo === 'prospecto' ? 'Prospecto' : 'Cliente') + (esNuevo ? ' agregado ✓' : ' actualizado ✓'));
  }

  /* ================= CATÁLOGO: PRODUCTOS Y SERVICIOS =================
     Cada ítem guarda nombre, precio por unidad, unidad de medida y
     características. Desde el editor de recibos y cotizaciones se
     agregan como conceptos copiando esos datos. */
  function prodTipo(p) { return (p && p.tipo === 'servicio') ? 'servicio' : 'producto'; }

  function renderProductos() {
    const wrap = $('#prod-list');
    if (!wrap) return;
    const q = prodQuery.trim().toLowerCase();
    const filtered = productos.filter(function (p) {
      const okTipo = prodFilter === 'todos' || prodTipo(p) === prodFilter;
      const okQ = !q || [p.nombre, p.sku, p.unidad, p.notas, splitCaract(p.caracteristicas).join(' ')]
        .join(' ').toLowerCase().includes(q);
      return okTipo && okQ;
    }).sort(function (a, b) {
      return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' });
    });

    paintChips('.chip[data-prod-filter]', 'prodFilter', prodFilter);

    setCount('prod-count', filtered.length, 'ítem', 'ítems',
      prodFilter === 'todos' ? '' : (prodFilter === 'producto' ? 'productos' : 'servicios'));

    if (!filtered.length) {
      wrap.innerHTML = `
        <div class="empty">
          <span class="empty-icon">${window.ICONS.box('ic-lg')}</span>
          <h3>${productos.length ? 'Nada coincide con la búsqueda' : 'Tu catálogo está vacío'}</h3>
          <p>${productos.length
            ? 'Prueba con otro término o quita los filtros.'
            : 'Guarda lo que vendes con su precio por unidad, unidad de medida y características. Después los agregas a un recibo o cotización con un toque.'}</p>
          <div class="empty-actions">
            <button class="btn primary" data-action="new-producto">Nuevo producto</button>
            <button class="btn outline" data-action="new-servicio">Nuevo servicio</button>
          </div>
        </div>`;
      return;
    }

    const rows = filtered.map(function (p) {
      const tipo = prodTipo(p);
      const feats = splitCaract(p.caracteristicas);
      const nombre = p.nombre || 'este ítem';
      const metaFinal = '<span class="pill mini ' + (tipo === 'servicio' ? 'ghost' : 'solid') + '">'
        + (tipo === 'servicio' ? 'Servicio' : 'Producto') + '</span>'
        + [p.sku ? '<span>' + esc(p.sku) + '</span>' : '']
          .filter(Boolean).map((x) => SEP + x).join('');
      return `
      <li class="row row-prod">
        <div class="row-main">
          <p class="row-title" title="${esc(p.nombre || 'Sin nombre')}">
            <span class="row-title-text">${esc(p.nombre || 'Sin nombre')}</span>
            <strong class="row-amount">${window.fmtMoney(p.precio)}</strong>
          </p>
          <p class="row-meta">${metaFinal}
            <span class="row-note">${p.unidad ? 'por ' + esc(p.unidad) : 'por unidad'}</span>
          </p>
        </div>
        ${feats.length ? `<ul class="prod-feats">${feats.slice(0, 4).map((f) => `<li>${esc(f)}</li>`).join('')}${feats.length > 4 ? `<li class="prod-feat-more">+${feats.length - 4} más</li>` : ''}</ul>` : ''}
        <div class="row-status">${p.notas ? `<span class="row-figure-note">${esc(p.notas)}</span>` : ''}</div>
        <div class="row-actions">
          ${actBtn('edit-producto', p.id, 'Editar ' + nombre, ICO.edit, 'Editar')}
          ${actBtn('dup-producto', p.id, 'Duplicar ' + nombre, ICO.copy)}
          ${trashBtn('del-producto', p.id, 'Eliminar ' + nombre)}
        </div>
      </li>`;
    }).join('');

    wrap.innerHTML = '<ul class="rows">' + rows + '</ul>';
  }

  function setProdTipo(t) {
    prodModalTipo = t === 'servicio' ? 'servicio' : 'producto';
    $$('#prod-tipo-seg .seg-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.prodTipo === prodModalTipo);
    });
    const title = $('#modal-producto-title');
    if (title) {
      title.textContent = (editingProducto ? 'Editar ' : 'Nuevo ')
        + (prodModalTipo === 'servicio' ? 'servicio' : 'producto');
    }
  }

  function openProductoModal(id, tipoDef) {
    editingProducto = id ? (productos.find(function (p) { return p.id === id; }) || null) : null;
    const p = editingProducto;
    const tipo = p ? prodTipo(p) : (tipoDef === 'servicio' ? 'servicio' : 'producto');
    $('#pr-nombre').value = p ? (p.nombre || '') : '';
    $('#pr-precio').value = p && p.precio != null ? p.precio : '';
    $('#pr-unidad').value = p ? (p.unidad || '') : '';
    $('#pr-caracteristicas').value = p ? joinCaractLines(p.caracteristicas) : '';
    $('#pr-sku').value = p ? (p.sku || '') : '';
    $('#pr-notas').value = p ? (p.notas || '') : '';
    setProdTipo(tipo);
    $('#modal-producto').classList.add('open');
    setTimeout(function () { const n = $('#pr-nombre'); if (n) n.focus(); }, 80);
  }

  function saveProducto() {
    const g = function (id) { const el = $(id); return el ? el.value : ''; };
    const nombre = g('#pr-nombre').trim();
    if (!nombre) {
      toast('Escribe el nombre del producto o servicio');
      const n = $('#pr-nombre'); if (n) n.focus();
      return;
    }
    const precioRaw = g('#pr-precio').trim();
    const precio = precioRaw === '' ? 0 : Number(precioRaw);
    if (!isFinite(precio) || precio < 0) {
      toast('Escribe un precio por unidad válido');
      const pr = $('#pr-precio'); if (pr) pr.focus();
      return;
    }
    const now = Date.now();
    let p = editingProducto;
    const esNuevo = !p;
    if (esNuevo) { p = { id: window.uid(), createdAt: now }; productos.push(p); }
    p.tipo = prodModalTipo;
    p.nombre = nombre;
    p.precio = precio;
    p.unidad = g('#pr-unidad').trim();
    p.caracteristicas = splitCaract(g('#pr-caracteristicas'));
    p.sku = g('#pr-sku').trim();
    p.notas = g('#pr-notas').trim();
    p.updatedAt = now;

    storeSet('mc_productos', productos); // también avisa al sincronizador
    $('#modal-producto').classList.remove('open');
    editingProducto = null;
    if (mainView === 'productos') renderProductos();
    toast((prodModalTipo === 'servicio' ? 'Servicio' : 'Producto') + (esNuevo ? ' agregado ✓' : ' actualizado ✓'));
  }

  /* ================= TAREAS =================
     Título, descripción, área, prioridad, deadline y documento
     asociado opcional. Pendientes → To-Do del inicio (mc_tareas). */
  function tareaAreaLabel(a) {
    var m = { general: 'General', contabilidad: 'Contabilidad', ventas: 'Ventas', cobranza: 'Cobranza' };
    return m[a] || a || 'General';
  }
  function tareaPrioLabel(p) {
    var m = { high: 'Alta', mid: 'Media', low: 'Baja' };
    return m[p] || 'Media';
  }
  function tareaDueMeta(t, hoy) {
    if (t.done) return { text: 'Hecha', tone: 'ok' };
    if (!t.deadline) return { text: 'Sin fecha', tone: '' };
    if (t.deadline < hoy) {
      var d = Math.abs(daysBetween(hoy, t.deadline));
      return { text: 'Vencida · ' + d + 'd', tone: 'danger' };
    }
    if (t.deadline === hoy) return { text: 'Vence hoy', tone: 'danger' };
    var dd = daysBetween(t.deadline, hoy);
    if (dd <= 3) return { text: 'Vence en ' + dd + ' día' + (dd !== 1 ? 's' : ''), tone: 'warn' };
    if (dd <= 7) return { text: 'Vence en ' + dd + ' días', tone: 'warn' };
    return { text: 'Vence ' + window.fmtDate(t.deadline), tone: '' };
  }

  function fillTareaDocSelect(selectedId) {
    var sel = $('#ta-doc');
    if (!sel) return;
    var opts = ['<option value="">— Ninguno —</option>'];
    var sorted = docs.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    sorted.forEach(function (d) {
      var label = (d.tipo === 'cotizacion' ? 'COT' : 'REC') + ' ' + (d.numero || '') + ' — ' + (d.representante || d.proyecto || 'Sin cliente');
      opts.push('<option value="' + esc(d.id) + '"' + (d.id === selectedId ? ' selected' : '') + '>' + esc(label) + '</option>');
    });
    sel.innerHTML = opts.join('');
  }

  function renderTareas() {
    var wrap = $('#tareas-list');
    var summary = $('#tareas-summary');
    if (!wrap) return;

    var hoy = window.todayISO();
    var q = tareaQuery.trim().toLowerCase();

    var filtered = tareas.filter(function (t) {
      var okQ = true;
      if (q) {
        var text = ((t.titulo || '') + ' ' + (t.descripcion || '') + ' ' + (t.area || '')).toLowerCase();
        okQ = text.indexOf(q) >= 0;
      }
      var okEstado = true;
      if (tareaFilter === 'pendiente') okEstado = !t.done;
      else if (tareaFilter === 'hecha') okEstado = !!t.done;
      else if (tareaFilter === 'vencida') okEstado = !t.done && t.deadline && t.deadline < hoy;
      var okArea = true;
      if (tareaArea !== 'todas') okArea = (t.area || 'general') === tareaArea;
      return okQ && okEstado && okArea;
    }).sort(function (a, b) {
      // pendientes primero, luego por deadline (null al final), luego prioridad alta, luego actualizado
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      if (a.deadline && !b.deadline) return -1;
      if (!a.deadline && b.deadline) return 1;
      if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
      var prioRank = { high: 0, mid: 1, low: 2 };
      var pa = prioRank[a.prioridad] != null ? prioRank[a.prioridad] : 1;
      var pb = prioRank[b.prioridad] != null ? prioRank[b.prioridad] : 1;
      if (pa !== pb) return pa - pb;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    paintChips('.chip[data-tarea-filter]', 'tareaFilter', tareaFilter);
    paintChips('.chip[data-tarea-area]', 'tareaArea', tareaArea);

    // resumen integrado en la cabecera de la vista
    var pendientes = tareas.filter(function (t) { return !t.done; }).length;
    var vencidas = tareas.filter(function (t) { return !t.done && t.deadline && t.deadline < hoy; }).length;
    var hechas = tareas.filter(function (t) { return !!t.done; }).length;
    if (summary) {
      summary.innerHTML = ''
        + '<div class="head-fig' + (pendientes ? ' is-warn' : '') + '"><span class="head-fig-label">Pendientes</span><strong class="head-fig-value">' + pendientes + '</strong></div>'
        + '<div class="head-fig' + (vencidas ? ' is-danger' : '') + '"><span class="head-fig-label">Vencidas</span><strong class="head-fig-value">' + vencidas + '</strong></div>'
        + '<div class="head-fig is-ok"><span class="head-fig-label">Hechas</span><strong class="head-fig-value">' + hechas + '</strong></div>';
    }

    setCount('tareas-count', filtered.length, 'tarea', 'tareas',
      (tareaFilter === 'todas' ? '' : ({ pendiente: 'pendientes', hecha: 'hechas', vencida: 'vencidas' })[tareaFilter])
      + (tareaArea === 'todas' ? '' : ' · ' + tareaAreaLabel(tareaArea)));

    if (!filtered.length) {
      wrap.innerHTML = '<div class="empty"><span class="empty-icon">' + window.ICONS.check('ic-lg') + '</span>'
        + '<h3>' + (tareas.length ? 'No hay tareas que coincidan' : 'Aún no hay tareas') + '</h3>'
        + '<p>' + (tareas.length ? 'Prueba con otra búsqueda o filtro.' : 'Crea tu primera tarea con título, área, prioridad, deadline y, si quieres, un recibo o cotización asociado. Las pendientes salen en el To-Do del inicio.') + '</p>'
        + '<div class="empty-actions"><button class="btn primary" data-action="new-tarea"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Nueva tarea</button></div></div>';
      return;
    }

    /* La fila de una tarea no necesita cuatro píldoras: la prioridad es
       un punto de color, el área y el vencimiento van en texto y el
       documento asociado es un folio en línea. Así cabe en dos renglones
       y sigue diciendo lo mismo. */
    var rows = filtered.map(function (t) {
      var due = tareaDueMeta(t, hoy);
      var titulo = t.titulo || 'esta tarea';
      var docHtml = '';
      if (t.docId) {
        var d = docs.find(function (x) { return x.id === t.docId; });
        if (d) {
          docHtml = '<button type="button" class="tarea-doc-link" data-action="view-tarea-doc" data-docid="' + esc(d.id) + '"'
            + ' aria-label="Ver el documento ' + esc(d.numero || '') + '" title="' + esc((d.representante || d.proyecto || 'Ver documento')) + '">'
            + (d.tipo === 'cotizacion' ? 'COT' : 'REC') + ' ' + esc(d.numero || '') + '</button>';
        }
      }
      return '<li class="row row-tarea' + (t.done ? ' is-done' : '') + '"'
        + (t.updatedAt ? ' title="Actualizada ' + esc(fmtCliFecha(t.updatedAt)) + '"' : '') + '>'
        + '<div class="row-main">'
        + '<p class="row-title"><span class="row-prio ' + esc(t.prioridad || 'mid') + '" title="Prioridad ' + esc(tareaPrioLabel(t.prioridad)) + '"></span>'
        + '<span>' + esc(t.titulo || 'Sin título') + '</span></p>'
        + '<p class="row-meta">'
        + '<span>' + esc(tareaAreaLabel(t.area)) + '</span>'
        + (!t.done && due.text ? SEP + '<span class="tarea-due' + (due.tone ? ' is-' + due.tone : '') + '">' + esc(due.text) + '</span>' : '')
        + (docHtml ? SEP + docHtml : '')
        + (t.done ? SEP + '<span class="tarea-done">Hecha</span>' : '')
        + '</p>'
        + (t.descripcion ? '<p class="row-sub">' + esc(t.descripcion) + '</p>' : '')
        + '</div>'
        + '<div class="row-actions">'
        + actBtn('edit-tarea', t.id, 'Editar ' + titulo, ICO.edit, 'Editar')
        + (t.done
          ? actBtn('toggle-tarea', t.id, 'Reabrir ' + titulo, ICO.open, 'Reabrir')
          : actBtn('toggle-tarea', t.id, 'Marcar hecha ' + titulo, window.ICONS.check(), 'Hecha', 'outline'))
        + trashBtn('del-tarea', t.id, 'Eliminar ' + titulo)
        + '</div>'
        + '</li>';
    }).join('');

    wrap.innerHTML = '<ul class="rows">' + rows + '</ul>';
  }

  function openTareaModal(id) {
    editingTarea = id ? (tareas.find(function (x) { return x.id === id; }) || null) : null;
    var t = editingTarea;
    var titleEl = $('#modal-tarea-title');
    if (titleEl) titleEl.textContent = t ? 'Editar tarea' : 'Nueva tarea';
    $('#ta-titulo').value = t ? (t.titulo || '') : '';
    $('#ta-desc').value = t ? (t.descripcion || '') : '';
    $('#ta-area').value = t ? (t.area || 'general') : 'general';
    $('#ta-prioridad').value = t ? (t.prioridad || 'mid') : 'mid';
    $('#ta-deadline').value = t ? (t.deadline || '') : '';
    $('#ta-done').checked = t ? !!t.done : false;
    fillTareaDocSelect(t ? t.docId : '');
    $('#modal-tarea').classList.add('open');
    setTimeout(function () { var n = $('#ta-titulo'); if (n) n.focus(); }, 80);
  }

  function saveTareaFromModal() {
    var g = function (id) { var el = $('#' + id); return el ? el.value : ''; };
    var titulo = g('ta-titulo').trim();
    if (!titulo) {
      toast('Escribe el título de la tarea');
      var n = $('#ta-titulo'); if (n) n.focus();
      return;
    }
    var now = Date.now();
    var t = editingTarea;
    var esNuevo = !t;
    if (esNuevo) { t = { id: window.uid(), createdAt: now }; tareas.push(t); }
    t.titulo = titulo;
    t.descripcion = g('ta-desc').trim();
    t.area = g('ta-area') || 'general';
    t.prioridad = g('ta-prioridad') || 'mid';
    t.deadline = g('ta-deadline') || '';
    t.docId = g('ta-doc') || '';
    t.done = !!$('#ta-done').checked;
    t.updatedAt = now;

    storeSet('mc_tareas', tareas);
    $('#modal-tarea').classList.remove('open');
    editingTarea = null;
    renderTareas();
    if (mainView === 'inicio') renderInicio();
    toast(esNuevo ? 'Tarea creada ✓' : 'Tarea actualizada ✓');
  }

  function toggleTareaDone(id) {
    var t = tareas.find(function (x) { return x.id === id; });
    if (!t) return;
    t.done = !t.done;
    t.updatedAt = Date.now();
    storeSet('mc_tareas', tareas);
    renderTareas();
    renderInicio();
    toast(t.done ? 'Tarea marcada como hecha ✓' : 'Tarea reabierta');
  }

  function deleteTarea(id) {
    var t = tareas.find(function (x) { return x.id === id; });
    if (!t) return;
    if (!confirm('¿Eliminar la tarea «' + (t.titulo || 'esta tarea') + '»?')) return;
    tareas = tareas.filter(function (x) { return x.id !== id; });
    storeSet('mc_tareas', tareas);
    if (window.SYNC) window.SYNC.tombstone('tareas', id);
    renderTareas();
    renderInicio();
    toast('Tarea eliminada');
  }

  /* Selector del catálogo dentro del editor de documentos */
  function catalogoPickerHtml() {
    if (!productos.length) {
      return `<div class="prod-pick-empty">
        <p class="hint">Guarda productos y servicios en tu catálogo con su precio por unidad, unidad de medida y características: después los agregas aquí con un toque.</p>
        <button class="btn small outline" data-action="go-productos">Ir al catálogo</button>
      </div>`;
    }
    const grupos = [
      { label: 'Productos', list: productos.filter((p) => prodTipo(p) === 'producto') },
      { label: 'Servicios', list: productos.filter((p) => prodTipo(p) === 'servicio') }
    ];
    const opts = grupos.map(function (g) {
      if (!g.list.length) return '';
      return '<optgroup label="' + esc(g.label) + '">' + g.list.map(function (p) {
        return `<option value="${esc(p.id)}">${esc(p.nombre)} · ${window.fmtMoney(p.precio)}${p.unidad ? '/' + esc(p.unidad) : ''}</option>`;
      }).join('') + '</optgroup>';
    }).join('');
    return `<label class="prod-pick">Agregar del catálogo
      <select id="f-catalogo">
        <option value="">— Elige un producto o servicio —</option>
        ${opts}
      </select>
    </label>`;
  }

  function addItemFromCatalog(pid) {
    if (!editing) return;
    syncForm();
    const p = productos.find((x) => x.id === pid);
    if (!p) { toast('Ese ítem ya no está en el catálogo'); return; }
    // si el documento sólo tenía el renglón vacío inicial, se reemplaza
    if (editing.items.length === 1) {
      const solo = editing.items[0];
      if (!String(solo.desc || '').trim() && !Number(solo.precioU) && !splitCaract(solo.caracteristicas).length) {
        editing.items.length = 0;
      }
    }
    editing.items.push({
      desc: p.nombre || '',
      q: 1,
      precioU: Number(p.precio) || 0,
      unidad: p.unidad || '',
      caracteristicas: splitCaract(p.caracteristicas),
      prodId: p.id
    });
    renderEditor();
    renderPreview();
    toast('Agregado ✓ ' + (p.nombre || ''));
  }

  /* ================= EDITOR ================= */
  function showEditor(doc) {
    editing = JSON.parse(JSON.stringify(doc));
    // relacionar con cliente guardado (por email o nombre)
    const em = (editing.email || '').trim().toLowerCase();
    let match = null;
    if (em) match = clientes.find((c) => (c.email || '').trim().toLowerCase() === em);
    if (!match && editing.representante) {
      match = clientes.find((c) => (c.nombre || '').trim().toLowerCase() === editing.representante.trim().toLowerCase());
    }
    selectedClientId = match ? match.id : null;
    const editorWasOpen = !$('#view-editor').hidden;
    previousView = mainView;
    if (!editorWasOpen) writeAppHistory(previousView, false, { editorReturn: true });
    $('#view-inicio').hidden = true;
    $('#view-list').hidden = true;
    $('#view-cxc').hidden = true;
    $('#view-cxp').hidden = true;
    $('#view-clientes').hidden = true;
    $('#view-productos').hidden = true;
    $('#view-tareas').hidden = true;
    $('#view-editor').hidden = false;
    $('#topbar').classList.add('hidden');
    document.body.classList.add('in-editor');
    // al abrir siempre se entra por "Datos" (en móvil las pestañas
    // conservaban el estado anterior y se veía la hoja recortada)
    document.body.classList.add('tab-datos');
    document.body.classList.remove('tab-preview');
    $$('.editor-tabs [data-tab]').forEach((t) => t.classList.toggle('on', t.dataset.tab === 'datos'));
    closeNavPop();
    renderEditor();
    renderPreviewNow();
    watchPreview();
    window.scrollTo(0, 0);
  }

  function renderEditor() {
    const isCot = editing.tipo === 'cotizacion';
    $('#editor-mode-label').textContent =
      (isCot ? 'Cotización' : 'Recibo') + ' Nro. ' + (editing.numero || '');
    $('#editor-form').innerHTML = `
      <section class="fsec">
        <div class="fsec-head"><h2>Tipo de documento</h2></div>
        <div class="fsec-body">
        <div class="seg">
          <button class="seg-btn ${!isCot ? 'on' : ''}" data-action="set-tipo" data-tipo="recibo">Recibo</button>
          <button class="seg-btn ${isCot ? 'on' : ''}" data-action="set-tipo" data-tipo="cotizacion">Cotización</button>
        </div>
        </div>
      </section>

      <section class="fsec">
        <div class="fsec-head"><h2>Datos generales</h2></div>
        <div class="fsec-body">
        <div class="grid2">
          <label>Número
            <input id="f-numero" type="text" value="${esc(editing.numero)}">
          </label>
          <label>Fecha
            <input id="f-fecha" type="date" value="${esc(editing.fecha)}">
          </label>
        </div>
        <label>Estado del documento
          <select id="f-estado">
            ${DOC_ESTADOS.map(function (e) {
              return `<option value="${e.id}" ${(editing.estado || 'cotizado') === e.id ? 'selected' : ''}>${esc(e.label)}</option>`;
            }).join('')}
          </select>
          <p class="hint">Cotizado → Aprobado → En producción → Enviado → Entregado → Pagado. Marcar como Cerrado lo envía al archivo y deja de aparecer en el inicio.</p>
        </label>
        ${isCot ? `<label>Vigencia (válida hasta)
            <input id="f-vigencia" type="date" value="${esc(editing.vigencia || '')}">
          </label>` : ''}
        </div>
      </section>

      <section class="fsec">
        <div class="fsec-head"><h2>Cliente / Proyecto</h2></div>
        <div class="fsec-body">
        <label>Cliente guardado
          <div class="client-pick">
            <select id="f-cliente">
              <option value="">— Sin guardar / nuevo —</option>
              ${clientes.map((c) => `<option value="${c.id}" ${c.id === selectedClientId ? 'selected' : ''}>${esc(c.nombre)}${cliTipo(c) === 'prospecto' ? ' · prosp.' : ''}</option>`).join('')}
            </select>
            <button class="btn small outline" data-action="save-client" title="Guardar los datos actuales como cliente"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar</button>
            <button class="btn small danger" data-action="del-client" title="Eliminar cliente seleccionado"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 3h4a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z"/></svg></button>
          </div>
        </label>
        <label>Proyecto
          <input id="f-proyecto" type="text" placeholder="Ej. Identidad de marca" value="${esc(editing.proyecto)}">
        </label>
        <div class="grid2">
          <label>Representante
            <input id="f-representante" type="text" value="${esc(editing.representante)}">
          </label>
          <label>Teléfono
            <input id="f-telefono" type="text" value="${esc(editing.telefono)}">
          </label>
        </div>
        <label>Email
          <input id="f-email" type="email" value="${esc(editing.email)}">
        </label>
        </div>
      </section>

      <section class="fsec">
        <div class="fsec-head"><h2>Conceptos</h2></div>
        <div class="fsec-body">
        ${catalogoPickerHtml()}
        <div id="items-list">
          ${(editing.items || []).map((it, i) => itemRow(it, i)).join('')}
        </div>
        <button class="btn outline small" data-action="add-item"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Agregar concepto</button>
        <div class="iva-controls">
          <label class="toggle"><input type="checkbox" id="f-coniva" ${editing.conIva === false ? '' : 'checked'}><span>Aplicar IVA</span></label>
          <label class="iva-rate ${editing.conIva === false ? 'disabled' : ''}">% <input id="f-iva" type="number" min="0" max="30" step="0.1" value="${esc(editing.iva != null ? editing.iva : settings.iva)}" ${editing.conIva === false ? 'disabled' : ''}></label>
          <label class="iva-rate">Descuento $ <input id="f-descuento" type="number" min="0" step="0.01" value="${esc(editing.descuento || 0)}"></label>
        </div>
        <div class="totals-box">
          <div><span>Subtotal</span><b id="t-subtotal"></b></div>
          <div id="iva-row"><span id="t-iva-label">IVA</span><b id="t-iva"></b></div>
          <div id="desc-row"><span>Descuento</span><b id="t-descuento"></b></div>
          <div class="grand"><span>Total</span><b id="t-total"></b></div>
          <div><span>Abonado</span><b id="t-abonado"></b></div>
          <div class="grand"><span>Por pagar</span><b id="t-porpagar"></b></div>
        </div>
        </div>
      </section>

      <section class="fsec">
        <div class="fsec-head"><h2>Datos para pagos</h2></div>
        <div class="fsec-body">
        <div class="grid2">
          <label>Cuenta Nro.
            <input id="f-cuenta" type="text" value="${esc(editing.pagos.cuenta)}">
          </label>
          <label>Nro. Clabe
            <input id="f-clabe" type="text" value="${esc(editing.pagos.clabe)}">
          </label>
          <label>Beneficiario
            <input id="f-beneficiario" type="text" value="${esc(editing.pagos.beneficiario)}">
          </label>
          <label>Banco
            <input id="f-banco" type="text" value="${esc(editing.pagos.banco)}">
          </label>
        </div>
        </div>
      </section>

      <section class="fsec">
        <div class="fsec-head"><h2>Abonos</h2><p class="fsec-note">(opcional)</p></div>
        <div class="fsec-body">
        <div id="abonos-list">
          ${(editing.abonos || []).map((a, i) => abonoRow(a, i)).join('')}
        </div>
        <button class="btn outline small" data-action="add-abono"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Agregar abono</button>
        <div class="abono-foot"><span>Saldo pendiente</span><b id="saldo-pendiente">—</b></div>
        <p class="hint">El saldo se recalcula automáticamente con cada abono. En el documento impreso se muestran hasta 4 abonos.</p>
        </div>
      </section>

      <section class="fsec">
        <div class="fsec-head"><h2>Condiciones de Entrega</h2></div>
        <div class="fsec-body">
        <div class="grid2">
          <label>Fecha de entrega
            <input id="f-entrega-fecha" type="date" value="${esc(editing.entregaFecha)}">
          </label>
          <label>Forma de entrega
            <input id="f-entrega-forma" type="text" placeholder="Ej. Envío por paquetería" value="${esc(editing.entregaForma)}">
          </label>
        </div>
        <p class="hint">Estos datos aparecen junto al icono de reloj y caja del documento.</p>
        <textarea id="f-condiciones" rows="2">${esc(editing.condiciones)}</textarea>
        </div>
      </section>

      <section class="fsec">
        <div class="fsec-head"><h2>Términos</h2><p class="fsec-note">un punto por línea</p></div>
        <div class="fsec-body">
        <p class="hint">Formato «Título: texto». El título sale en negrita en el documento.</p>
        <textarea id="f-terminos" rows="9">${esc(editing.terminos)}</textarea>
        </div>
      </section>
    `;
    updateTotalsBox();
    updateAbonosSaldo();
  }

  function itemRow(it, i) {
    return `
    <div class="item-row" data-index="${i}">
      <div class="i-main">
        <input class="i-desc" type="text" placeholder="Descripción del servicio" value="${esc(it.desc)}">
        <input class="i-car" type="text" placeholder="Características (separadas por coma)" value="${esc(joinCaractInline(it.caracteristicas))}">
      </div>
      <div class="i-nums">
        <label>Q<input class="i-q" type="number" min="0" step="1" value="${esc(it.q)}"></label>
        <label>Unidad<input class="i-u" type="text" list="unidades-list" placeholder="pza" value="${esc(it.unidad || '')}"></label>
        <label>Precio U<input class="i-pu" type="number" min="0" step="0.01" value="${esc(it.precioU)}"></label>
        <span class="i-sub">${window.fmtMoney((Number(it.q) || 0) * (Number(it.precioU) || 0))}</span>
      </div>
      <button class="icon-btn" data-action="del-item" data-index="${i}" title="Quitar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>`;
  }
  function abonoRow(a, i) {
    return `
    <div class="item-row abono" data-index="${i}">
      <input class="a-fecha" type="date" value="${esc(a.fecha)}">
      <input class="a-monto" type="number" min="0" step="0.01" placeholder="Monto del abono" value="${esc(a.monto)}">
      <span class="a-saldo" title="Saldo después de este abono">—</span>
      <button class="icon-btn" data-action="del-abono" data-index="${i}" title="Quitar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>`;
  }

  function syncForm() {
    if (!editing) return;
    const g = (id) => { const el = $('#' + id); return el ? el.value : ''; };
    editing.numero = g('f-numero');
    editing.fecha = g('f-fecha');
    editing.vigencia = g('f-vigencia');
    const estEl = $('#f-estado');
    editing.estado = estEl ? (estEl.value || 'cotizado') : (editing.estado || 'cotizado');
    editing.proyecto = g('f-proyecto');
    editing.representante = g('f-representante');
    editing.telefono = g('f-telefono');
    editing.email = g('f-email');
    editing.condiciones = g('f-condiciones');
    editing.entregaFecha = g('f-entrega-fecha');
    editing.entregaForma = g('f-entrega-forma');
    editing.terminos = g('f-terminos');
    editing.pagos = {
      cuenta: g('f-cuenta'), clabe: g('f-clabe'),
      beneficiario: g('f-beneficiario'), banco: g('f-banco')
    };
    const conIvaEl = $('#f-coniva');
    editing.conIva = conIvaEl ? conIvaEl.checked : (editing.conIva !== false);
    const ivaEl = $('#f-iva');
    if (ivaEl) { const v = ivaEl.value.trim(); editing.iva = v === '' ? null : Number(v); }
    const descEl = $('#f-descuento');
    if (descEl) editing.descuento = Math.max(0, Number(descEl.value) || 0);
    // items
    $$('#items-list .item-row').forEach((row) => {
      const i = Number(row.dataset.index);
      if (!editing.items[i]) editing.items[i] = { desc: '', q: 1, precioU: 0 };
      editing.items[i].desc = $('.i-desc', row).value;
      editing.items[i].q = $('.i-q', row).value;
      editing.items[i].precioU = $('.i-pu', row).value;
      const uEl = $('.i-u', row);
      if (uEl) editing.items[i].unidad = uEl.value.trim();
      const cEl = $('.i-car', row);
      if (cEl) editing.items[i].caracteristicas = splitCaract(cEl.value);
      const sub = (Number(editing.items[i].q) || 0) * (Number(editing.items[i].precioU) || 0);
      $('.i-sub', row).textContent = window.fmtMoney(sub);
    });
    // abonos
    $$('#abonos-list .item-row').forEach((row) => {
      const i = Number(row.dataset.index);
      if (!editing.abonos[i]) editing.abonos[i] = { fecha: '', monto: 0 };
      editing.abonos[i].fecha = $('.a-fecha', row).value;
      editing.abonos[i].monto = $('.a-monto', row).value;
    });
  }

  function updateTotalsBox() {
    const t = computeTotals(editing || { items: [] });
    const s = (id, v) => { const el = $('#' + id); if (el) el.textContent = v; };
    s('t-subtotal', window.fmtMoney(t.subtotal));
    const ivaRow = $('#iva-row');
    if (ivaRow) {
      if (t.ivaRate > 0) {
        ivaRow.style.display = '';
        s('t-iva-label', 'IVA (' + t.ivaRate + '%)');
        s('t-iva', window.fmtMoney(t.iva));
      } else {
        ivaRow.style.display = 'none';
      }
    }
    const descRow = $('#desc-row');
    if (descRow) {
      descRow.style.display = t.descuento > 0 ? '' : 'none';
      s('t-descuento', '-' + window.fmtMoney(t.descuento));
    }
    s('t-total', window.fmtMoney(t.total));
    s('t-abonado', window.fmtMoney(t.abonado));
    s('t-porpagar', window.fmtMoney(t.porPagar));
  }

  function updateAbonosSaldo() {
    if (!editing) return;
    const t = computeTotals(editing);
    let saldo = t.total;
    $$('#abonos-list .item-row').forEach((row) => {
      const monto = Number($('.a-monto', row).value) || 0;
      saldo -= monto;
      const el = $('.a-saldo', row);
      if (el) el.textContent = window.fmtMoney(saldo);
    });
    const pend = $('#saldo-pendiente');
    if (pend) pend.textContent = window.fmtMoney(saldo);
  }

  /* ---------------- Vista previa ----------------
     Reconstruir la hoja implica medir textos en canvas. Con el borrador
     abierto eso pasaba en cada tecla: se agrupa en un fotograma y la
     escritura deja de trabarse en equipos modestos. */
  let _previewPendiente = false;
  function renderPreview() {
    if (_previewPendiente) return;
    _previewPendiente = true;
    requestAnimationFrame(function () {
      _previewPendiente = false;
      renderPreviewNow();
    });
  }
  function renderPreviewNow() {
    if (!editing) return;
    $('#preview-inner').innerHTML = window.receiptHTML(editing, settings);
    autoscale();
  }
  function autoscale() {
    const frame = $('#preview-frame');
    const inner = $('#preview-inner');
    if (!frame || !inner) return;
    // si el frame está oculto (tabs en móvil) no hay que escalar a 0:
    // se recalcula al volver a mostrarlo
    const w = frame.clientWidth;
    if (!w) return;
    // 612pt = 816px @96dpi. El alto lo da el aspect-ratio del frame en CSS.
    frame.style.setProperty('--preview-scale', (w / 816).toFixed(5));
  }

  // Recalcula la escala cuando el frame cambia de tamaño (rotación,
  // cambio de pestaña, teclado virtual, barra de direcciones del móvil…)
  let _previewRO = null;
  function watchPreview() {
    if (_previewRO || typeof ResizeObserver === 'undefined') return;
    const frame = $('#preview-frame');
    if (!frame) return;
    _previewRO = new ResizeObserver(() => autoscale());
    _previewRO.observe(frame);
  }

  /* ---------------- Salida del editor ----------------
     «Nuevo recibo» crea el documento al instante para poder editarlo. Si
     se sale sin escribir nada, ese cascarón vacío se descarta: el archivo
     deja de llenarse de documentos fantasma. */
  function esBorradorVacio(doc) {
    if (!doc) return false;
    if (String(doc.proyecto || '').trim()) return false;
    if (String(doc.representante || '').trim()) return false;
    if (String(doc.email || '').trim()) return false;
    if (String(doc.telefono || '').trim()) return false;
    if ((doc.abonos || []).length) return false;
    return !(doc.items || []).some(function (it) {
      return String(it.desc || '').trim() || (Number(it.precioU) || 0) > 0;
    });
  }

  function descartarBorradorVacio() {
    if (!editing || !esBorradorVacio(editing)) return false;
    const id = editing.id;
    docs = docs.filter(function (d) { return d.id !== id; });
    storeSet('mc_docs', docs);
    if (window.SYNC) window.SYNC.tombstone('docs', id);
    editing = null;
    return true;
  }

  /* Guarda lo que haya y vuelve a la vista de la que se salió. */
  function exitEditor(destino) {
    if (editing && !$('#view-editor').hidden && !descartarBorradorVacio()) saveDoc(true);
    switchMainView(destino || previousView, { replaceHistory: true });
  }

  /* ---------------- Acciones ---------------- */
  function saveDoc(silent) {
    if (!editing) return;
    syncForm();
    editing.updatedAt = Date.now();
    const idx = docs.findIndex((d) => d.id === editing.id);
    if (idx >= 0) docs[idx] = editing; else docs.push(editing);
    storeSet('mc_docs', docs);
    if (!silent) toast('Guardado ✓');
  }

  function deleteDoc(id) {
    const d = docs.find((x) => x.id === id);
    if (!d) return;
    if (!confirm(`¿Eliminar el ${d.tipo === 'cotizacion' ? 'presupuesto' : 'recibo'} Nro. ${d.numero}?`)) return;
    docs = docs.filter((x) => x.id !== id);
    storeSet('mc_docs', docs);
    if (window.SYNC) window.SYNC.tombstone('docs', id);
    switchMainView(mainView);
    toast('Documento eliminado');
  }

  function printDoc() {
    if (!editing) return;
    syncForm();
    $('#print-area').innerHTML = window.receiptHTML(editing, settings);
    setTimeout(() => window.print(), 60);
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    if (URL && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(blob);
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } else {
      // respaldo: data URL
      const fr = new FileReader();
      fr.onload = () => {
        a.href = fr.result; a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      fr.readAsDataURL(blob);
    }
  }

  /* El motor de PDF (jsPDF, ~360 KB) se descarga SOLO cuando de verdad se
     necesita: al enviar el documento. Imprimir no lo requiere. */
  let jsPdfPromise = null;
  function ensureJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (!jsPdfPromise) {
      jsPdfPromise = new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = 'assets/js/jspdf.umd.min.js';
        s.onload = function () {
          if (window.jspdf && window.jspdf.jsPDF) resolve();
          else { jsPdfPromise = null; reject(new Error('jsPDF no respondió')); }
        };
        s.onerror = function () {
          jsPdfPromise = null;
          reject(new Error('no se pudo descargar el motor de PDF'));
        };
        document.head.appendChild(s);
      });
    }
    return jsPdfPromise;
  }

  async function makePdfFile() {
    await ensureJsPDF();
    if (!images) await preloadImages();
    const blob = await window.PDFEngine.build(editing, settings, images);
    return new File([blob], fileName(editing), { type: 'application/pdf' });
  }

  async function sendEmail() {
    if (!editing) return;
    syncForm();
    const btn = $('[data-action="email"]');
    const old = btn.innerHTML; btn.disabled = true; btn.textContent = 'Generando…';
    try {
      const file = await makePdfFile();
      // 1) Si el dispositivo permite compartir archivos → mejor UX en móvil
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: file.name, text: `${editing.tipo === 'cotizacion' ? 'Cotización' : 'Recibo'} ${editing.numero}` });
          return;
        } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      // 2) Fallback escritorio: descargar PDF + abrir correo (mailto)
      downloadBlob(file, file.name);
      const tipoTxt = editing.tipo === 'cotizacion' ? 'cotización' : 'recibo';
      const subj = encodeURIComponent(`${editing.tipo === 'cotizacion' ? 'Cotización' : 'Recibo'} ${editing.numero} — ${settings.empresa}`);
      const body = encodeURIComponent(`Hola,\n\nTe adjunto el ${tipoTxt} ${editing.numero}.\n\nSaludos,\n${settings.empresa}`);
      const to = editing.email ? encodeURIComponent(editing.email) : '';
      window.location.href = `mailto:${to}?subject=${subj}&body=${body}`;
      toast('PDF descargado. Adjúntalo en el correo que se abrió.');
    } catch (err) {
      console.error(err);
      toast('No se pudo generar el PDF: ' + (err && err.message ? err.message : 'error'));
    } finally {
      btn.disabled = false; btn.innerHTML = old;
    }
  }

  /* ---------------- Ajustes ---------------- */
  function openSettings() {
    const s = settings;
    const cuenta = (window.SYNC && window.SYNC.accountEmail && window.SYNC.accountEmail()) || '';
    /* Ajustes en dos columnas de bloques: cada grupo tiene su propio
       espacio, en lugar de una lista larga de títulos apilados. */
    $('#settings-body').innerHTML = `
      <div class="set-grid">
        <section class="set-block">
          <h3>Datos del estudio</h3>
          <label>Empresa (línea 1)
            <input id="s-empresa" type="text" value="${esc(s.empresa)}"></label>
          <label>Empresa (línea 2)
            <input id="s-empresasub" type="text" value="${esc(s.empresaSub)}"></label>
          <label>Email
            <input id="s-email" type="text" value="${esc(s.email)}"></label>
          <label>Teléfono
            <input id="s-telefono" type="text" value="${esc(s.telefono)}"></label>
          <label>Sitio web
            <input id="s-web" type="text" value="${esc(s.web)}"></label>
          <label>Ciudad
            <input id="s-ciudad" type="text" value="${esc(s.ciudad)}"></label>
          <label>IVA (%)
            <input id="s-iva" type="number" min="0" max="30" step="0.1" value="${esc(s.iva)}"></label>
        </section>

        <section class="set-block">
          <h3>Datos de pago por defecto</h3>
          <label>Cuenta Nro.
            <input id="s-p-cuenta" type="text" value="${esc(s.pagos.cuenta)}"></label>
          <label>Nro. Clabe
            <input id="s-p-clabe" type="text" value="${esc(s.pagos.clabe)}"></label>
          <label>Beneficiario
            <input id="s-p-beneficiario" type="text" value="${esc(s.pagos.beneficiario)}"></label>
          <label>Banco
            <input id="s-p-banco" type="text" value="${esc(s.pagos.banco)}"></label>
          <h3>Código QR de pago <span class="hint">(opcional)</span></h3>
          <div class="qr-row">
            <input id="s-qr-file" type="file" accept="image/png,image/jpeg,image/webp">
            ${s.qr ? `<div class="qr-prev"><img src="${esc(s.qr)}" alt="QR de pago"><button class="btn small danger" data-action="clear-qr">Quitar</button></div>` : ''}
          </div>
        </section>

        <section class="set-block is-wide">
          <h3>Textos por defecto</h3>
          <div class="set-texts">
            <label>Condiciones de Entrega
              <textarea id="s-condiciones" rows="2">${esc(s.condiciones)}</textarea></label>
            <label>Términos <span class="hint">formato «Título: texto», uno por línea</span>
              <textarea id="s-terminos" rows="9">${esc(s.terminos)}</textarea></label>
          </div>
        </section>

        <section class="set-block">
          <h3>Cuenta y sincronización</h3>
          <div class="account-row">
            <span>${cuenta ? 'Sincronizando como <b>' + esc(cuenta) + '</b> entre tus equipos.' : 'Sin cuenta: tus datos viven solo en este dispositivo.'}</span>
            ${cuenta ? '<button class="btn small outline" data-action="logout">Cerrar sesión</button>' : ''}
          </div>
          <p class="hint">Los recibos, cotizaciones, contactos, catálogo y tareas viajan con tu cuenta.</p>
        </section>
      </div>
    `;
    $('#modal-settings').classList.add('open');
  }

  function saveSettings() {
    const g = (id) => { const el = $('#' + id); return el ? el.value : ''; };
    settings.empresa = g('s-empresa');
    settings.empresaSub = g('s-empresasub');
    settings.email = g('s-email');
    settings.telefono = g('s-telefono');
    settings.web = g('s-web');
    settings.ciudad = g('s-ciudad');
    settings.iva = Number(g('s-iva')) || 0;
    settings.pagos = { cuenta: g('s-p-cuenta'), clabe: g('s-p-clabe'), beneficiario: g('s-p-beneficiario'), banco: g('s-p-banco') };
    settings.condiciones = g('s-condiciones');
    settings.terminos = g('s-terminos');
    settings.updatedAt = Date.now();
    storeSet('mc_settings', settings);
    $('#modal-settings').classList.remove('open');
    if (editing) { renderPreview(); updateTotalsBox(); }
    toast('Ajustes guardados ✓');
  }

  /* El botón Atrás del navegador/PWA recorre las vistas internas antes de salir. */
  window.addEventListener('popstate', function (event) {
    const state = event.state;
    if (!state || state.inVoiceApp !== true) return;

    if (MAIN_VIEW_IDS.indexOf(state.view) === -1) return;

    closeNavPop();
    if (!$('#view-editor').hidden && editing && !descartarBorradorVacio()) saveDoc(true);
    switchMainView(state.view, { fromPopstate: true });
  });

  /* ---------------- Eventos ---------------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    switch (a) {
      case 'new-recibo': { const d = blankDoc('recibo'); docs.push(d); storeSet('mc_docs', docs); showEditor(d); break; }
      case 'new-cotizacion': { const d = blankDoc('cotizacion'); docs.push(d); storeSet('mc_docs', docs); showEditor(d); break; }
      case 'back': exitEditor(previousView); break;
      case 'go-home':
        if (!$('#view-editor').hidden && editing) exitEditor('inicio');
        else switchMainView('inicio');
        break;
      case 'save': saveDoc(false); break;
      case 'print': printDoc(); break;
      case 'email': sendEmail(); break;
      case 'delete': {
        if (!editing) break;
        // un borrador que nadie tocó se descarta sin preguntar
        const confirmar = !esBorradorVacio(editing) || confirm('¿Eliminar este documento?');
        if (!confirmar) break;
        const idBorrar = editing.id;
        editing = null;
        docs = docs.filter((d) => d.id !== idBorrar);
        storeSet('mc_docs', docs);
        if (window.SYNC) window.SYNC.tombstone('docs', idBorrar);
        switchMainView(previousView, { replaceHistory: true });
        break;
      }
      case 'edit': { const d = docs.find((x) => x.id === btn.dataset.id); if (d) showEditor(d); break; }
      case 'duplicate': {
        const src = docs.find((x) => x.id === btn.dataset.id);
        if (src) {
          const copy = JSON.parse(JSON.stringify(src));
          copy.id = window.uid(); copy.numero = nextNumero(src.tipo);
          copy.createdAt = copy.updatedAt = Date.now();
          docs.push(copy); storeSet('mc_docs', docs);
          switchMainView(mainView);
          toast('Documento duplicado ✓');
        }
        break;
      }
      case 'delete-list': deleteDoc(btn.dataset.id); break;

      /* ------ Estados de documento ------ */
      case 'cerrar': {
        const d = docs.find((x) => x.id === btn.dataset.id);
        if (!d) break;
        if (!confirm('¿Mover ' + (d.numero || 'este documento') + ' al archivo de Cerrados? Ya no aparecerá en el inicio.')) break;
        d.estado = 'cerrado';
        d.updatedAt = Date.now();
        storeSet('mc_docs', docs);
        switchMainView(mainView);
        toast('Documento cerrado → archivo');
        break;
      }
      case 'reabrir': {
        const d = docs.find((x) => x.id === btn.dataset.id);
        if (!d) break;
        // Reabre con el último estado útil (Pagado si está pagado, sino Cotizado).
        const t = computeTotals(d);
        d.estado = (t.pagado && t.total > 0) ? 'pagado' : 'cotizado';
        d.updatedAt = Date.now();
        storeSet('mc_docs', docs);
        switchMainView(mainView);
        toast('Documento reabierto');
        break;
      }
      case 'cambiar-estado': {
        const d = docs.find((x) => x.id === btn.dataset.id);
        if (!d) break;
        const actual = docEstado(d).id;
        const opts = DOC_ESTADOS.map(function (e, i) {
          return (i + 1) + '. ' + e.label + (e.id === actual ? ' (actual)' : '');
        }).join('\n');
        const resp = prompt('Cambiar estado del documento ' + (d.numero || '') + ':\n\n' + opts + '\n\nEscribe el número del nuevo estado:', '');
        if (resp == null) break;
        const n = parseInt(resp, 10);
        if (!n || n < 1 || n > DOC_ESTADOS.length) { toast('Opción inválida'); break; }
        const nuevo = DOC_ESTADOS[n - 1];
        d.estado = nuevo.id;
        d.updatedAt = Date.now();
        storeSet('mc_docs', docs);
        switchMainView(mainView);
        toast('Estado: ' + nuevo.label);
        break;
      }
      case 'set-tipo':
        if (editing) { editing.tipo = btn.dataset.tipo; renderEditor(); renderPreview(); }
        break;
      case 'add-item':
        if (editing) { editing.items.push({ desc: '', q: 1, precioU: 0, unidad: '', caracteristicas: [] }); renderEditor(); renderPreview(); }
        break;
      case 'del-item': {
        if (!editing) break;
        editing.items.splice(Number(btn.dataset.index), 1);
        if (!editing.items.length) editing.items = [{ desc: '', q: 1, precioU: 0, unidad: '', caracteristicas: [] }];
        renderEditor(); renderPreview(); break;
      }
      case 'add-abono': { if (editing) { editing.abonos.push({ fecha: window.todayISO(), monto: 0 }); renderEditor(); renderPreview(); } break; }
      case 'del-abono': { if (editing) { editing.abonos.splice(Number(btn.dataset.index), 1); renderEditor(); renderPreview(); } break; }
      case 'save-client': {
        syncForm();
        const nombre = (editing.representante || '').trim();
        if (!nombre) { toast('Escribe el nombre del cliente (campo Representante)'); break; }
        const em = (editing.email || '').trim().toLowerCase();
        let cli = em ? clientes.find((c) => (c.email || '').trim().toLowerCase() === em)
                     : clientes.find((c) => (c.nombre || '').trim().toLowerCase() === nombre.toLowerCase());
        if (cli) {
          cli.nombre = nombre; cli.telefono = editing.telefono || ''; cli.email = editing.email || '';
          cli.updatedAt = Date.now();
        } else {
          cli = { id: window.uid(), tipo: 'cliente', nombre, telefono: editing.telefono || '', email: editing.email || '', updatedAt: Date.now() };
          clientes.push(cli);
        }
        storeSet('mc_clientes', clientes);
        selectedClientId = cli.id;
        renderEditor(); renderPreview();
        toast('Cliente guardado ✓');
        break;
      }
      case 'del-client': {
        const sel = $('#f-cliente');
        if (!sel || !sel.value) { toast('Selecciona un cliente de la lista para eliminar'); break; }
        if (!confirm('¿Eliminar este cliente guardado? (No borra los documentos)')) break;
        clientes = clientes.filter((c) => c.id !== sel.value);
        storeSet('mc_clientes', clientes);
        if (window.SYNC) window.SYNC.tombstone('clientes', sel.value);
        selectedClientId = null;
        renderEditor(); renderPreview();
        toast('Cliente eliminado');
        break;
      }
      /* ------ Directorio de clientes / prospectos ------ */
      case 'new-cliente': openClienteModal(null, 'cliente'); break;
      case 'new-prospecto': openClienteModal(null, 'prospecto'); break;
      case 'edit-cliente': openClienteModal(btn.dataset.id); break;
      case 'set-cli-tipo': setCliTipo(btn.dataset.cliTipo); break;
      case 'close-cliente-modal':
        $('#modal-cliente').classList.remove('open');
        editingCliente = null;
        break;
      case 'save-cliente': saveClienteFromModal(); break;

      /* ------ Catálogo de productos y servicios ------ */
      case 'new-producto': openProductoModal(null, 'producto'); break;
      case 'new-servicio': openProductoModal(null, 'servicio'); break;
      case 'edit-producto': openProductoModal(btn.dataset.id); break;
      case 'set-prod-tipo': setProdTipo(btn.dataset.prodTipo); break;
      case 'close-producto-modal':
        $('#modal-producto').classList.remove('open');
        editingProducto = null;
        break;
      case 'save-producto': saveProducto(); break;
      case 'dup-producto': {
        const src = productos.find((x) => x.id === btn.dataset.id);
        if (src) {
          const copy = JSON.parse(JSON.stringify(src));
          copy.id = window.uid();
          copy.nombre = (src.nombre || '') + ' (copia)';
          copy.createdAt = copy.updatedAt = Date.now();
          productos.push(copy);
          storeSet('mc_productos', productos);
          renderProductos();
          toast('Ítem duplicado ✓');
        }
        break;
      }
      case 'del-producto': {
        const pp = productos.find((x) => x.id === btn.dataset.id);
        if (!pp) break;
        if (!confirm('¿Eliminar «' + (pp.nombre || 'este ítem') + '» del catálogo? (No borra los documentos donde ya se usa)')) break;
        productos = productos.filter((x) => x.id !== pp.id);
        storeSet('mc_productos', productos);
        if (window.SYNC) window.SYNC.tombstone('productos', pp.id);
        renderProductos();
        toast('Ítem eliminado');
        break;
      }
      /* desde el editor: ir al catálogo guardando el documento en silencio */
      case 'go-productos':
        closeNavPop();
        if (editing) saveDoc(true);
        switchMainView('productos');
        break;
      case 'del-cliente-card': {
        const cc = clientes.find((x) => x.id === btn.dataset.id);
        if (!cc) break;
        if (!confirm('¿Eliminar a «' + (cc.nombre || 'este contacto') + '»? (No borra sus documentos)')) break;
        clientes = clientes.filter((x) => x.id !== cc.id);
        storeSet('mc_clientes', clientes);
        if (window.SYNC) window.SYNC.tombstone('clientes', cc.id);
        if (selectedClientId === cc.id) selectedClientId = null;
        renderClientes();
        toast('Contacto eliminado');
        break;
      }
      case 'settings': closeNavPop(); openSettings(); break;
      case 'sheet-settings': openSettings(); break;
      case 'save-settings': saveSettings(); break;
      case 'go-docs': closeNavPop(); listEstado = 'activos'; switchMainView('docs'); break;
      case 'go-cerrados': closeNavPop(); listEstado = 'cerrados'; switchMainView('docs'); break;
      case 'go-cxc': closeNavPop(); switchMainView('cxc'); break;
      case 'go-cxp': closeNavPop(); switchMainView('cxp'); break;
      case 'go-clientes': closeNavPop(); switchMainView('clientes'); break;
      case 'go-tareas': closeNavPop(); switchMainView('tareas'); break;
      case 'toggle-filters':
        filtersCollapsed = !filtersCollapsed;
        applyFiltersState();
        break;

      case 'cob-pay': {
        const docPay = docs.find(function (x) { return x.id === btn.dataset.id; });
        if (!docPay) break;
        const saldoPay = computeTotals(docPay).porPagar;
        const montoStr = prompt('Saldo pendiente: ' + window.fmtMoney(saldoPay) + '\n\n¿Cuánto quieres cobrar?', String(saldoPay));
        if (montoStr === null) break;
        const monto = Number(montoStr);
        if (!(monto > 0)) { toast('Monto inválido'); break; }
        if (abonarDocumento(docPay.id, monto)) {
          renderInicio();
          toast('Cobro registrado ✓');
        }
        break;
      }
      case 'cob-settle': {
        const docSet = docs.find(function (x) { return x.id === btn.dataset.id; });
        if (!docSet) break;
        const saldoSet = computeTotals(docSet).porPagar;
        if (!confirm('¿Marcar ' + (docSet.numero || 'este documento') + ' como pagado (' + window.fmtMoney(saldoSet) + ')?')) break;
        if (liquidarDocumento(docSet.id)) {
          renderInicio();
          toast('Marcado como pagado ✓');
        }
        break;
      }
      case 'todo-done': {
        var tid = btn.dataset.tid || '';
        if (!tid) break;
        if (tid.indexOf('tarea-') === 0) {
          var tareaId = tid.slice(6);
          var tt = tareas.find(function (x) { return x.id === tareaId; });
          if (tt) {
            tt.done = true;
            tt.updatedAt = Date.now();
            storeSet('mc_tareas', tareas);
            renderInicio();
            renderTareas();
            toast('Tarea marcada como hecha ✓');
          }
        } else {
          markHomeTaskDone(tid);
          renderInicio();
        }
        break;
      }
      case 'todo-go': {
        const go = btn.dataset.go;
        const gid = btn.dataset.id;
        if (go === 'go-cxc') { closeNavPop(); switchMainView('cxc'); }
        else if (go === 'go-cxp') { closeNavPop(); switchMainView('cxp'); }
        else if (go === 'go-docs') { closeNavPop(); switchMainView('docs'); }
        else if (go === 'go-clientes') { closeNavPop(); switchMainView('clientes'); }
        else if (go === 'go-tareas') { closeNavPop(); switchMainView('tareas'); }
        else if (go === 'edit-tarea' && gid) {
          var tGo = tareas.find(function (x) { return x.id === gid; });
          if (tGo) openTareaModal(gid);
        }
        else if (go === 'new-cotizacion') {
          const d = blankDoc('cotizacion'); docs.push(d); storeSet('mc_docs', docs); showEditor(d);
        }
        else if (go === 'edit' && gid) {
          const d = docs.find(function (x) { return x.id === gid; });
          if (d) showEditor(d);
        }
        else if (go === 'edit-cxp' && gid) {
          const cxpGo = cuentasXPagar.find(function (x) { return x.id === gid; });
          if (cxpGo) openCxpModal(cxpGo);
        }
        break;
      }
      case 'close-settings': $('#modal-settings').classList.remove('open'); break;
      case 'clear-qr': { settings.qr = ''; openSettings(); break; }
      case 'tab': {
        $$('[data-tab]').forEach((t) => {
          const on = t === btn;
          t.classList.toggle('on', on);
          t.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        document.body.classList.toggle('tab-datos', btn.dataset.tab === 'datos');
        document.body.classList.toggle('tab-preview', btn.dataset.tab === 'preview');
        // al mostrar la vista previa, recalcular escala (pudo medirse oculta)
        requestAnimationFrame(autoscale);
        break;
      }
      case 'install': if (window._deferredPrompt) { window._deferredPrompt.prompt(); window._deferredPrompt = null; btn.style.display = 'none'; } break;

      /* --- Menú compacto --- */
      case 'toggle-menu':
        toggleNavPop();
        break;

      case 'open-cmdk': openCmdk(); break;
      case 'close-cmdk': closeCmdk(); break;

      /* --- Navegación principal --- */
      case 'view-cxc-doc': {
        var dd = docs.find(function(x) { return x.id === btn.dataset.docid; });
        if (dd) showEditor(dd);
        break;
      }

      /* --- Cuentas por Pagar --- */
      case 'new-cxp': openCxpModal(null); break;
      case 'edit-cxp': {
        var cxp = cuentasXPagar.find(function(x) { return x.id === btn.dataset.id; });
        if (cxp) openCxpModal(cxp);
        break;
      }
      case 'del-cxp': {
        if (!confirm('¿Eliminar esta cuenta por pagar?')) break;
        cuentasXPagar = cuentasXPagar.filter(function(x) { return x.id !== btn.dataset.id; });
        storeSet('mc_cxp', cuentasXPagar);
        if (window.SYNC) window.SYNC.tombstone('cxp', btn.dataset.id);
        renderCxP();
        toast('Cuenta por pagar eliminada');
        break;
      }
      case 'quick-pay-cxp': {
        var cxp2 = cuentasXPagar.find(function(x) { return x.id === btn.dataset.id; });
        if (cxp2) {
          var abonosTotal2 = (cxp2.abonos || []).reduce(function(s, a) { return s + (Number(a.monto) || 0); }, 0);
          var saldo2 = cxp2.monto - abonosTotal2;
          var montoStr = prompt('Saldo pendiente: ' + window.fmtMoney(saldo2) + '\n\n¿Cuánto quieres abonar?', String(saldo2));
          if (montoStr === null) break;
          var montoAbono = Number(montoStr);
          if (isNaN(montoAbono) || montoAbono <= 0) { toast('Monto inválido'); break; }
          if (!cxp2.abonos) cxp2.abonos = [];
          cxp2.abonos.push({ fecha: window.todayISO(), monto: montoAbono });
          cxp2.updatedAt = Date.now();
          storeSet('mc_cxp', cuentasXPagar);
          renderCxP();
          toast('Abono registrado ✓');
        }
        break;
      }
      case 'save-cxp': saveCxp(); break;
      case 'close-cxp-modal': $('#modal-cxp').classList.remove('open'); break;
      case 'add-cxp-abono': {
        if (!editingCxp) editingCxp = { abonos: [] };
        if (!editingCxp.abonos) editingCxp.abonos = [];
        editingCxp.abonos.push({ fecha: window.todayISO(), monto: 0 });
        renderCxpModal();
        break;
      }
      case 'del-cxp-abono': {
        if (editingCxp && editingCxp.abonos) {
          editingCxp.abonos.splice(Number(btn.dataset.index), 1);
          renderCxpModal();
        }
        break;
      }

      /* --- Tareas --- */
      case 'new-tarea': openTareaModal(null); break;
      case 'edit-tarea': openTareaModal(btn.dataset.id); break;
      case 'del-tarea': deleteTarea(btn.dataset.id); break;
      case 'toggle-tarea': toggleTareaDone(btn.dataset.id); break;
      case 'save-tarea': saveTareaFromModal(); break;
      case 'close-tarea-modal': $('#modal-tarea').classList.remove('open'); editingTarea = null; break;
      case 'view-tarea-doc': {
        var didT = btn.dataset.docid;
        var ddT = docs.find(function (x) { return x.id === didT; });
        if (ddT) showEditor(ddT);
        break;
      }

      case 'logout':
        closeNavPop();
        if (window.SYNC) window.SYNC.logout();
        break;
    }
  });

  document.addEventListener('input', (e) => {
    if (!editing) return;
    if (e.target.id === 'f-numero' || e.target.id === 'f-fecha' || e.target.id === 'f-vigencia' ||
        e.target.id === 'f-proyecto' || e.target.id === 'f-representante' || e.target.id === 'f-telefono' ||
        e.target.id === 'f-email' || e.target.id === 'f-condiciones' || e.target.id === 'f-terminos' ||
        e.target.id === 'f-entrega-fecha' || e.target.id === 'f-entrega-forma' ||
        e.target.id === 'f-cuenta' || e.target.id === 'f-clabe' || e.target.id === 'f-beneficiario' || e.target.id === 'f-banco' ||
        e.target.id === 'f-iva' || e.target.id === 'f-descuento' ||
        e.target.classList.contains('i-desc') || e.target.classList.contains('i-q') || e.target.classList.contains('i-pu') ||
        e.target.classList.contains('i-u') || e.target.classList.contains('i-car') ||
        e.target.classList.contains('a-fecha') || e.target.classList.contains('a-monto')) {
      syncForm();
      updateTotalsBox();
      updateAbonosSaldo();
      renderPreview();
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'f-catalogo' && e.target.value) {
      addItemFromCatalog(e.target.value);
    }
    if (e.target.id === 'f-cliente') {
      const c = clientes.find((x) => x.id === e.target.value);
      selectedClientId = c ? c.id : null;
      if (c) {
        const r = $('#f-representante'), t = $('#f-telefono'), m = $('#f-email');
        if (r) r.value = c.nombre || '';
        if (t) t.value = c.telefono || '';
        if (m) m.value = c.email || '';
        syncForm();
        updateTotalsBox();
        updateAbonosSaldo();
        renderPreview();
        toast('Cliente cargado ✓');
      }
    }
    if (e.target.id === 'f-coniva') {
      const on = e.target.checked;
      const rateEl = $('#f-iva');
      if (rateEl) { rateEl.disabled = !on; rateEl.closest('.iva-rate').classList.toggle('disabled', !on); }
      syncForm();
      updateTotalsBox();
      updateAbonosSaldo();
      renderPreview();
    }
    if (e.target.id === 's-qr-file' && e.target.files && e.target.files[0]) {
      const fr = new FileReader();
      fr.onload = () => { settings.qr = fr.result; openSettings(); };
      fr.readAsDataURL(e.target.files[0]);
    }
  });

  $('#search').addEventListener('input', (e) => { listQuery = e.target.value; renderList(); });
  $$('.chip[data-filter]').forEach((c) => c.addEventListener('click', () => { listFilter = c.dataset.filter; renderList(); }));
  $$('.chip[data-status]').forEach((c) => c.addEventListener('click', () => { listStatus = c.dataset.status; renderList(); }));
  $$('.chip[data-estado]').forEach((c) => c.addEventListener('click', () => { listEstado = c.dataset.estado; renderList(); }));

  // Búsqueda global: tecleo, clic y cierre al tocar fuera de la tarjeta
  const cmdkInput = $('#cmdk-input');
  if (cmdkInput) cmdkInput.addEventListener('input', (e) => paintCmdk(e.target.value));
  const cmdkList = $('#cmdk-list');
  if (cmdkList) {
    cmdkList.addEventListener('click', (e) => {
      const item = e.target.closest('.cmdk-item');
      if (item) cmdkAbrir(cmdk.planos[Number(item.dataset.index)]);
    });
  }
  const cmdkBox = $('#cmdk');
  if (cmdkBox) cmdkBox.addEventListener('click', (e) => { if (e.target === cmdkBox) closeCmdk(); });

  // Menú a pantalla completa: se cierra con Esc (o con su ✕ y al elegir
  // sección). Ya no hay «tocar fuera»: la capa cubre todo el viewport, y
  // tampoco se cierra al redimensionar (el teclado móvil lo disparaba).
  document.addEventListener('keydown', function (e) {
    const paleta = cmdkEl();
    const paletaAbierta = paleta && !paleta.hidden;

    /* Atajos globales: ⌘K / Ctrl+K busca, ⌘S guarda el documento abierto.
       Se ignoran dentro de campos salvo el propio buscador. */
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); if (paletaAbierta) closeCmdk(); else openCmdk(); return; }
      if (k === 's' && editing && !$('#view-editor').hidden) {
        e.preventDefault(); saveDoc(false); return;
      }
    }

    const pop = navPopEl();
    const overlay = paletaAbierta ? paleta : (pop && !pop.hidden ? pop : $('.modal.open'));

    if (paletaAbierta && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      cmdkMover(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (paletaAbierta && e.key === 'Enter') {
      e.preventDefault();
      cmdkAbrir(cmdk.planos[cmdk.activo]);
      return;
    }
    if (e.key === 'Escape') {
      if (paletaAbierta) { closeCmdk(); return; }
      if (pop && !pop.hidden) closeNavPop();
      else if (overlay) {
        const close = $('.modal-head [data-action^="close-"], .sheet-top [data-action^="close-"]', overlay);
        if (close) close.click();
      }
      return;
    }
    if (e.key !== 'Tab' || !overlay) return;
    const focusable = $$('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)', overlay)
      .filter(function (el) { return el.getClientRects().length; });
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (!overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // Búsqueda CxC
  var searchCxc = $('#search-cxc');
  if (searchCxc) searchCxc.addEventListener('input', function(e) { cxcQuery = e.target.value; renderCxC(); });

  // Búsqueda y filtros CxP
  var searchCxp = $('#search-cxp');
  if (searchCxp) searchCxp.addEventListener('input', function(e) { cxpQuery = e.target.value; renderCxP(); });
  $$('.chip[data-cxp-filter]').forEach(function(c) {
    c.addEventListener('click', function() { cxpFilter = c.dataset.cxpFilter; renderCxP(); });
  });

  // Búsqueda y filtros del directorio (clientes / prospectos)
  var searchCli = $('#search-cli');
  if (searchCli) searchCli.addEventListener('input', function(e) { cliQuery = e.target.value; renderClientes(); });
  $$('.chip[data-cli-filter]').forEach(function(c) {
    c.addEventListener('click', function() { cliFilter = c.dataset.cliFilter; renderClientes(); });
  });

  // Búsqueda y filtros del catálogo (productos y servicios)
  var searchProd = $('#search-prod');
  if (searchProd) searchProd.addEventListener('input', function(e) { prodQuery = e.target.value; renderProductos(); });
  $$('.chip[data-prod-filter]').forEach(function(c) {
    c.addEventListener('click', function() { prodFilter = c.dataset.prodFilter; renderProductos(); });
  });

  // Búsqueda y filtros de tareas
  var searchTareas = $('#search-tareas');
  if (searchTareas) searchTareas.addEventListener('input', function(e) { tareaQuery = e.target.value; renderTareas(); });
  $$('.chip[data-tarea-filter]').forEach(function(c) {
    c.addEventListener('click', function() { tareaFilter = c.dataset.tareaFilter; renderTareas(); });
  });
  $$('.chip[data-tarea-area]').forEach(function(c) {
    c.addEventListener('click', function() { tareaArea = c.dataset.tareaArea; renderTareas(); });
  });

  // Input events para modal CxP
  document.addEventListener('input', function(e) {
    if (!$('#modal-cxp').classList.contains('open')) return;
    if (e.target.id && e.target.id.indexOf('cxp-') === 0) {
      updateCxpSaldo();
    }
  });

  window.addEventListener('resize', () => {
    if (!$('#view-editor').hidden) autoscale();
  });

  /* Diálogos: foco dentro de la tarjeta y retorno al control de origen. */
  (function watchDialogs() {
    const modals = $$('.modal');
    const returnTargets = new Map();
    let openBefore = new Set();
    function update() {
      const open = new Set(modals.filter(function (el) { return el.classList.contains('open'); }));
      open.forEach(function (el) {
        if (openBefore.has(el)) return;
        returnTargets.set(el, document.activeElement);
        const close = $('.modal-head button, .sheet-back', el);
        if (close && !el.contains(document.activeElement)) close.focus({ preventScroll: true });
      });
      document.body.classList.toggle('modal-open', open.size > 0);
      setBackgroundInert();
      openBefore.forEach(function (el) {
        if (open.has(el)) return;
        const target = returnTargets.get(el);
        const inAnotherModal = target && target.isConnected &&
          target.closest && target.closest('.modal.open');
        if (target && target.isConnected && (!open.size || inAnotherModal)) {
          target.focus({ preventScroll: true });
        } else if (!open.size) {
          $('#main-content').focus({ preventScroll: true });
        }
        returnTargets.delete(el);
      });
      openBefore = open;
    }
    const observer = new MutationObserver(update);
    modals.forEach(function (el) { observer.observe(el, { attributes: true, attributeFilter: ['class'] }); });
  })();

  /* Barra superior de sincronización: refleja el estado de la píldora */
  (function watchSync() {
    const pill = $('#sync-pill');
    const bar = $('#sync-bar');
    if (!pill || !bar) return;
    let doneTimer = null;
    function paint() {
      const busy = pill.classList.contains('sync-busy');
      const err = pill.classList.contains('sync-err');
      clearTimeout(doneTimer);
      bar.classList.toggle('on', busy || err);
      bar.classList.toggle('done', false);
      if (busy) return;
      if (bar.classList.contains('on')) {
        bar.classList.remove('on');
        bar.classList.add('done');
        doneTimer = setTimeout(() => bar.classList.remove('done'), 500);
      }
    }
    new MutationObserver(paint).observe(pill, { attributes: true, attributeFilter: ['class'] });
    paint();
    if ($('#sheet-sync')) {
      new MutationObserver(mirrorSheetSync).observe(pill, {
        attributes: true, childList: true, characterData: true, subtree: true
      });
      mirrorSheetSync();
    }
  })();


  /* ================= BÚSQUEDA GLOBAL (Ctrl / ⌘ + K) =================
     Un solo campo para llegar a cualquier dato: documentos, contactos,
     cuentas por pagar, catálogo, tareas y acciones. Nada de recorrer
     menús para encontrar un folio o un cliente. */
  const CMDK_MAX = 6;   // resultados por grupo

  const CMDK_ACCIONES = [
    { action: 'new-recibo',     title: 'Nuevo recibo',             meta: 'Registrar un cobro' },
    { action: 'new-cotizacion', title: 'Nueva cotización',         meta: 'Enviar un presupuesto' },
    { action: 'new-cliente',    title: 'Nuevo cliente',            meta: 'Agregar al directorio' },
    { action: 'new-cxp',        title: 'Nueva cuenta por pagar',   meta: 'Registrar un gasto' },
    { action: 'new-producto',   title: 'Nuevo producto o servicio', meta: 'Agregar al catálogo' },
    { action: 'new-tarea',      title: 'Nueva tarea',              meta: 'Agendar un pendiente' },
    { action: 'go-docs',        title: 'Ir a Documentos',          meta: 'Archivo general' },
    { action: 'go-cxc',         title: 'Ir a Por cobrar',          meta: 'Saldos por cliente' },
    { action: 'go-cxp',         title: 'Ir a Por pagar',           meta: 'Gastos y facturas' },
    { action: 'go-clientes',    title: 'Ir al Directorio',         meta: 'Clientes y prospectos' },
    { action: 'go-productos',   title: 'Ir al Catálogo',           meta: 'Productos y servicios' },
    { action: 'go-tareas',      title: 'Ir a Tareas',              meta: 'Pendientes y proyectos' },
    { action: 'settings',       title: 'Ajustes',                  meta: 'Estudio, pagos y cuenta' }
  ];

  /* Búsqueda tolerante: sin acentos, sin distinguir mayúsculas, y con
     todas las palabras en cualquier orden. */
  function normaliza(txt) {
    return String(txt == null ? '' : txt).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function cmdkTokens(q) { return normaliza(q).split(/\s+/).filter(Boolean); }
  function cmdkCoincide(tokens, campos) {
    if (!tokens.length) return true;
    const pajar = normaliza(campos.filter(Boolean).join(' '));
    return tokens.every(function (t) { return pajar.indexOf(t) >= 0; });
  }

  function buscarTodo(q) {
    const tokens = cmdkTokens(q);
    const grupos = [];
    function add(label, items) { if (items.length) grupos.push({ label: label, items: items }); }
    const cortar = function (arr) { return arr.slice(0, CMDK_MAX); };

    add('Acciones', cortar(CMDK_ACCIONES.filter(function (a) {
      return cmdkCoincide(tokens, [a.title, a.meta]);
    })).map(function (a) {
      return { title: a.title, meta: a.meta, icono: 'plus', run: a.action };
    }));

    add('Documentos', cortar(docs.filter(function (d) {
      return cmdkCoincide(tokens, [d.numero, d.proyecto, d.representante, d.email,
        d.tipo === 'cotizacion' ? 'cotizacion presupuesto' : 'recibo']);
    }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })).map(function (d) {
      const esCot = d.tipo === 'cotizacion';
      const t = computeTotals(d);
      return {
        title: d.proyecto || ((esCot ? 'Cotización' : 'Recibo') + ' ' + (d.numero || '')),
        meta: [esCot ? 'Cotización' : 'Recibo', d.numero, d.representante,
          t.pagado ? 'liquidado' : (t.abonado > 0 ? 'pago parcial' : 'pendiente')]
          .filter(Boolean).join(' · '),
        amount: window.fmtMoney(t.total),
        icono: esCot ? 'quote' : 'doc',
        openDoc: d.id
      };
    }));

    add('Directorio', cortar(clientes.filter(function (c) {
      return cmdkCoincide(tokens, [c.nombre, c.empresa, c.email, c.telefono, c.rfc,
        cliTipo(c) === 'prospecto' ? 'prospecto' : 'cliente']);
    }).sort(function (a, b) {
      return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' });
    })).map(function (c) {
      return {
        title: c.nombre || 'Sin nombre',
        meta: [cliTipo(c) === 'prospecto' ? 'Prospecto' : 'Cliente', c.empresa, c.email]
          .filter(Boolean).join(' · '),
        icono: 'user',
        openCliente: c.id
      };
    }));

    add('Por pagar', cortar(cuentasXPagar.filter(function (c) {
      return cmdkCoincide(tokens, [c.proveedor, c.concepto, c.folio, c.notas]);
    }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })).map(function (c) {
      const abonado = (c.abonos || []).reduce(function (s, a) { return s + (Number(a.monto) || 0); }, 0);
      const saldo = (Number(c.monto) || 0) - abonado;
      return {
        title: c.proveedor || 'Sin proveedor',
        meta: [c.concepto, c.folio, saldo <= 0.005 ? 'pagada' : (abonado > 0 ? 'pago parcial' : 'pendiente')]
          .filter(Boolean).join(' · '),
        amount: window.fmtMoney(saldo),
        icono: 'clipboard',
        openCxp: c.id
      };
    }));

    add('Catálogo', cortar(productos.filter(function (p) {
      return cmdkCoincide(tokens, [p.nombre, p.sku, p.unidad, p.notas,
        splitCaract(p.caracteristicas).join(' '), prodTipo(p) === 'servicio' ? 'servicio' : 'producto']);
    }).sort(function (a, b) {
      return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' });
    })).map(function (p) {
      return {
        title: p.nombre || 'Sin nombre',
        meta: [prodTipo(p) === 'servicio' ? 'Servicio' : 'Producto', p.sku,
          p.unidad ? 'por ' + p.unidad : ''].filter(Boolean).join(' · '),
        amount: window.fmtMoney(p.precio),
        icono: 'box',
        openProducto: p.id
      };
    }));

    add('Tareas', cortar(tareas.filter(function (t) {
      return cmdkCoincide(tokens, [t.titulo, t.descripcion, tareaAreaLabel(t.area)]);
    }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })).map(function (t) {
      return {
        title: t.titulo || 'Sin título',
        meta: [t.done ? 'hecha' : 'pendiente', tareaAreaLabel(t.area),
          t.deadline ? 'vence ' + window.fmtDate(t.deadline) : ''].filter(Boolean).join(' · '),
        icono: 'check',
        openTarea: t.id
      };
    }));

    return grupos;
  }

  const CMDK_ICONS = {
    doc: window.ICONS.docs,
    quote: window.ICONS.docs,
    user: window.ICONS.user,
    clipboard: window.ICONS.clipboard,
    box: window.ICONS.box,
    check: window.ICONS.check,
    plus: function () {
      return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    }
  };

  const cmdk = { grupos: [], planos: [], activo: 0 };

  function cmdkEl() { return $('#cmdk'); }

  function openCmdk() {
    const el = cmdkEl();
    if (!el || !el.hidden) return;
    closeNavPop();
    $$('.modal.open').forEach(function (m) { m.classList.remove('open'); });
    el.hidden = false;
    el.classList.add('open');
    setBackgroundInert();
    const input = $('#cmdk-input');
    if (input) { input.value = ''; input.focus({ preventScroll: true }); }
    paintCmdk('');
  }

  function closeCmdk() {
    const el = cmdkEl();
    if (!el || el.hidden) return;
    const dentro = el.contains(document.activeElement);
    el.hidden = true;
    el.classList.remove('open');
    cmdk.grupos = []; cmdk.planos = []; cmdk.activo = 0;
    setBackgroundInert();
    if (!dentro) return;
    const btn = $('[data-action="open-cmdk"]');
    if (btn && btn.getClientRects().length) btn.focus({ preventScroll: true });
    else $('#main-content').focus({ preventScroll: true });
  }

  function paintCmdk(q) {
    const list = $('#cmdk-list');
    if (!list) return;
    cmdk.grupos = q.trim() ? buscarTodo(q) : [
      { label: 'Acciones', items: CMDK_ACCIONES.slice(0, CMDK_MAX).map(function (a) {
        return { title: a.title, meta: a.meta, icono: 'plus', run: a.action };
      }) },
      { label: 'Reciente', items: docs.slice().sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      }).slice(0, 4).map(function (d) {
        const esCot = d.tipo === 'cotizacion';
        return {
          title: d.proyecto || ((esCot ? 'Cotización' : 'Recibo') + ' ' + (d.numero || '')),
          meta: [esCot ? 'Cotización' : 'Recibo', d.numero, d.representante].filter(Boolean).join(' · '),
          amount: window.fmtMoney(computeTotals(d).total),
          icono: esCot ? 'quote' : 'doc',
          openDoc: d.id
        };
      }) }
    ];

    cmdk.planos = [];
    let html = '';
    cmdk.grupos.forEach(function (g) {
      html += '<p class="cmdk-group" role="presentation">' + esc(g.label) + '</p>';
      g.items.forEach(function (item) {
        const i = cmdk.planos.length;
        cmdk.planos.push(item);
        html += '<button type="button" class="cmdk-item" role="option" id="cmdk-opt-' + i + '"'
          + ' data-index="' + i + '" aria-selected="false">'
          + '<span class="cmdk-ico" aria-hidden="true">' + (CMDK_ICONS[item.icono] || CMDK_ICONS.doc)() + '</span>'
          + '<span class="cmdk-title">' + esc(item.title) + '</span>'
          + '<span class="cmdk-meta">' + esc(item.meta || '') + '</span>'
          + (item.amount ? '<span class="cmdk-amt">' + esc(item.amount) + '</span>' : '')
          + '</button>';
      });
    });

    if (!cmdk.planos.length) {
      html = '<div class="cmdk-empty"><strong>Sin resultados</strong>'
        + 'Prueba con otro término: número de folio, cliente, proveedor…</div>';
    }
    list.innerHTML = html;
    cmdk.activo = 0;
    cmdkPintarActivo();
  }

  function cmdkPintarActivo() {
    const items = $$('#cmdk-list .cmdk-item');
    items.forEach(function (el, i) {
      const on = i === cmdk.activo;
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    });
    const input = $('#cmdk-input');
    if (input && cmdk.planos[cmdk.activo]) {
      input.setAttribute('aria-activedescendant', 'cmdk-opt-' + cmdk.activo);
    } else if (input) {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function cmdkMover(delta) {
    if (!cmdk.planos.length) return;
    const n = cmdk.planos.length;
    cmdk.activo = (cmdk.activo + delta + n) % n;
    cmdkPintarActivo();
  }

  function cmdkAbrir(res) {
    closeCmdk();
    if (!res) return;
    if (res.openDoc) {
      const d = docs.find(function (x) { return x.id === res.openDoc; });
      if (d) {
        if (editing && !$('#view-editor').hidden) saveDoc(true);
        showEditor(d);
      }
      return;
    }
    if (res.openCliente) { switchMainView('clientes'); openClienteModal(res.openCliente); return; }
    if (res.openProducto) { switchMainView('productos'); openProductoModal(res.openProducto); return; }
    if (res.openTarea) { openTareaModal(res.openTarea); return; }
    if (res.openCxp) {
      const c = cuentasXPagar.find(function (x) { return x.id === res.openCxp; });
      if (c) { switchMainView('cxp'); openCxpModal(c); }
      return;
    }
    if (res.run) {
      // se reutiliza el cableado de la interfaz: el mismo botón, el mismo caso
      const btn = $('[data-action="' + res.run + '"]');
      if (btn) btn.click();
    }
  }

  /* ---------------- PWA install ---------------- */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window._deferredPrompt = e;
    const b = $('#btn-install');
    if (b) b.style.display = '';
  });
  window.addEventListener('appinstalled', () => {
    const b = $('#btn-install');
    if (b) b.style.display = 'none';
  });

  /* ---------------- Sync remoto: refrescar estado ---------------- */
  function reloadFromStore(changed) {
    if (!changed || changed.size === 0) return;
    if (changed.has('mc_settings')) {
      settings = Object.assign({}, DEFAULT_SETTINGS, storeGet('mc_settings', {}));
      settings.pagos = Object.assign({}, DEFAULT_SETTINGS.pagos, settings.pagos || {});
    }
    if (changed.has('mc_docs')) docs = storeGet('mc_docs', []);
    if (changed.has('mc_clientes')) clientes = storeGet('mc_clientes', []);
    if (changed.has('mc_cxp')) cuentasXPagar = storeGet('mc_cxp', []);
    if (changed.has('mc_productos')) productos = storeGet('mc_productos', []);
    if (changed.has('mc_tareas')) tareas = storeGet('mc_tareas', []);


    if (!$('#view-editor').hidden && editing) {
      // si el documento que estoy editando se borró en otro equipo, salir del editor
      if (docs.some((d) => d.id === editing.id)) {
        renderPreview();
        updateTotalsBox();
      } else {
        switchMainView(previousView, { replaceHistory: true });
      }
    } else {
      switchMainView(mainView);
    }
  }

  function bootApp() {
    applyFiltersState();
    // releer colecciones (el primer pull pudo traer datos remotos)
    settings = Object.assign({}, DEFAULT_SETTINGS, storeGet('mc_settings', {}));
    settings.pagos = Object.assign({}, DEFAULT_SETTINGS.pagos, settings.pagos || {});
    docs = storeGet('mc_docs', []);
    clientes = storeGet('mc_clientes', []);
    cuentasXPagar = storeGet('mc_cxp', []);
    productos = storeGet('mc_productos', []);
    tareas = storeGet('mc_tareas', []);
    showHome();
  }

  /* ---------------- Init ---------------- */
  async function init() {
    resetAppHistory();
    preloadImages();
    if ('serviceWorker' in navigator) {
      try { navigator.serviceWorker.register('sw.js'); } catch (e) {}
    }
    if (window.SYNC) {
      window.SYNC.setRemoteHandler(reloadFromStore);
      if (window.SYNC.authed()) {
        bootApp();
        window.SYNC.runSync(true); // re-sincronizar al abrir
      } else {
        window.SYNC.showAuth(bootApp);
      }
    } else {
      bootApp();
    }
  }
  init();
})();
