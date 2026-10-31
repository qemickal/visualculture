/* Sólo lo inyecta scripts/dev-server.mjs con --demo.
 * No aparece en index.html ni en la caché de producción.
 * No crea tokens, no conecta una cuenta y no envía datos a la API.
 */
(function () {
  'use strict';
  let nativeStorage;
  try { nativeStorage = window.localStorage; } catch (error) { /* privacidad estricta: memoria local */ }
  const memory = new Map();
  const prefix = 'clerki-preview:';
  const isolatedStorage = {
    getItem: (key) => {
      if (memory.has(key)) return memory.get(key);
      try { return nativeStorage ? nativeStorage.getItem(prefix + key) : null; } catch (error) { return null; }
    },
    setItem: (key, value) => {
      memory.set(key, String(value));
      try { if (nativeStorage) nativeStorage.setItem(prefix + key, value); } catch (error) { /* sin persistencia */ }
    },
    removeItem: (key) => {
      memory.delete(key);
      try { if (nativeStorage) nativeStorage.removeItem(prefix + key); } catch (error) { /* sin persistencia */ }
    },
  };
  Object.defineProperty(window, 'localStorage', { value: isolatedStorage });
  // La demo no instala ni modifica la caché offline de la app real.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register = () => Promise.resolve();
  }
  const now = new Date();
  const stamp = now.getTime();
  const date = (offset) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 12);
  const previousDate = [previousMonth.getFullYear(), String(previousMonth.getMonth() + 1).padStart(2, '0'), '12'].join('-');
  const document = (id, numero, proyecto, representante, total, paid, tipo, deadline, estado, entrega) => ({
    id, numero, proyecto, representante, tipo, fecha: date(-2), vigencia: date(deadline),
    estado: estado || (paid >= total ? 'pagado' : 'cotizado'),
    entregaFecha: entrega ? date(entrega) : '',
    email: 'estudio@example.com', telefono: '',
    items: [{ desc: proyecto, q: 1, precioU: total, unidad: 'proyecto', caracteristicas: ['Diseño y dirección creativa', 'Archivos finales incluidos'] }],
    conIva: false, iva: 16, descuento: 0,
    abonos: paid ? [{ fecha: date(-1), monto: paid }] : [],
    pagos: {}, condiciones: 'Entrega a convenir con el cliente.', terminos: '',
    createdAt: stamp - 86400000 * 4, updatedAt: stamp,
  });
  // Los estados y las entregas hacen que la demo se parezca a un día real:
  // una orden en producción, una aprobada, una cotización viva y dos cerradas.
  const exampleDocs = [
    document('demo-nomada', 'PO26001', 'Identidad · Estudio Nómada', 'Lucía Méndez', 18500, 10000, 'recibo', 4, 'produccion', 3),
    document('demo-alba', 'PO26002', 'Branding · Casa Alba', 'Mateo Rivera', 12800, 6400, 'recibo', 10, 'aprobado', 6),
    document('demo-prisma', 'RQ26003', 'Diseño editorial · Prisma', 'Valeria López', 8500, 0, 'cotizacion', 12, 'cotizado'),
    document('demo-forma', 'PO26004', 'Identidad · Forma', 'Sofía Torres', 14200, 14200, 'recibo', 8, 'entregado', -1),
    { ...document('demo-archivo', 'PO25005', 'Web · Taller Norte', 'Daniel Silva', 19500, 19500, 'recibo', 9, 'cerrado'), fecha: previousDate, abonos: [{ fecha: previousDate, monto: 19500 }] },
  ];
  const data = {
    mc_docs: exampleDocs,
    mc_clientes: [
      { id: 'cli-nomada', tipo: 'cliente', nombre: 'Lucía Méndez', empresa: 'Estudio Nómada', email: 'lucia@example.com', telefono: '55 0000 0101', updatedAt: stamp },
      { id: 'cli-alba', tipo: 'cliente', nombre: 'Mateo Rivera', empresa: 'Casa Alba', email: 'mateo@example.com', telefono: '55 0000 0102', updatedAt: stamp },
      { id: 'cli-forma', tipo: 'cliente', nombre: 'Sofía Torres', empresa: 'Forma', email: 'sofia@example.com', updatedAt: stamp },
      { id: 'cli-prisma', tipo: 'prospecto', nombre: 'Valeria López', empresa: 'Editorial Prisma', email: 'valeria@example.com', estado: 'negociacion', updatedAt: stamp },
    ],
    mc_cxp: [
      { id: 'cxp-papel', proveedor: 'Papel & Co.', concepto: 'Impresión de tarjetas de presentación', monto: 3200, categoria: 'material', fecha: date(-2), vencimiento: date(2), abonos: [{ fecha: date(-1), monto: 1600 }], updatedAt: stamp },
      { id: 'cxp-adobe', proveedor: 'Creative Cloud', concepto: 'Suscripción mensual de diseño', monto: 890, categoria: 'servicio', fecha: date(-1), vencimiento: date(4), abonos: [], updatedAt: stamp },
    ],
    mc_productos: [
      { id: 'prod-identidad', tipo: 'servicio', nombre: 'Identidad de marca', precio: 18500, unidad: 'proyecto', sku: 'ID-01', caracteristicas: ['Logotipo y sistema visual', 'Manual de marca', 'Archivos editables'], updatedAt: stamp },
      { id: 'prod-tarjetas', tipo: 'producto', nombre: 'Tarjetas de presentación', precio: 850, unidad: 'lote', sku: 'TAR-02', caracteristicas: ['Papel couché 350 g', 'Impresión a color', 'Acabado mate'], updatedAt: stamp },
      { id: 'prod-editorial', tipo: 'servicio', nombre: 'Diseño editorial', precio: 8500, unidad: 'proyecto', caracteristicas: ['Diseño de portada', 'Retícula y maquetación'], updatedAt: stamp },
    ],
    mc_tareas: [
      { id: 'task-propuesta', titulo: 'Preparar propuesta para Prisma', descripcion: 'Revisar alcance y confirmar entregables con Valeria.', area: 'ventas', prioridad: 'mid', deadline: date(3), docId: 'demo-prisma', done: false, updatedAt: stamp },
      { id: 'task-entrega', titulo: 'Revisar entrega de Casa Alba', descripcion: 'Validar aplicaciones y preparar los archivos finales.', area: 'general', prioridad: 'low', deadline: date(5), docId: 'demo-alba', done: false, updatedAt: stamp },
    ],
  };
  if (localStorage.getItem('mc_preview_seeded') !== 'v3') {
    for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('mc_preview_seeded', 'v3');
  }
  window.SYNC = {
    authed: () => true,
    accountEmail: () => 'demo@example.com',
    runSync: () => {},
    localChanged: () => {},
    tombstone: () => {},
    setRemoteHandler: () => {},
    _state: () => 'off',
    logout: () => { window.location.href = '/?auth=1'; },
  };
  const pill = window.document.getElementById('sync-pill');
  pill.textContent = 'Demo local';
  pill.title = 'Datos de ejemplo. No hay cuenta ni sincronización real en esta vista previa.';
  // La ficha de fecha del saludo lleva el aviso de que son datos de ejemplo.
  window.document.title = 'CLERKI — Vista previa con datos de ejemplo';
  const fecha = window.document.getElementById('hero-kicker');
  if (fecha) fecha.title = 'Vista previa con datos de ejemplo: no hay cuenta ni sincronización real.';
})();
