# CLERKI — Recibos &amp; Cotizaciones

PWA para crear, guardar, imprimir y enviar **recibos y cotizaciones**.
Funciona sin conexión, se instala en el celular y, si se quiere, sincroniza
los datos entre dispositivos con una cuenta.

Sin framework, sin paso de compilación y sin dependencias en el navegador:
HTML, CSS y JavaScript de navegador. El único motor externo (jsPDF) se
descarga únicamente cuando se va a enviar un PDF.

## Empezar


## Estructura

```
index.html            Toda la interfaz: vistas, modales, hoja de contacto y acceso
css/app.css           Hoja única de estilos de la interfaz (el documento impreso no la usa)
js/layout.js          Especificación del documento en puntos + formato + iconos
js/render.js          El documento como HTML (vista previa e impresión)
js/pdf.js             El mismo documento como PDF real (jsPDF + Archivo incrustada)
js/app.js             Estado, vistas, editor y acciones
js/sync.js            Cuenta y sincronización incremental contra /api/*
api/                  Functions de Vercel: login, register, sync (Postgres)
sw.js                 Service worker: HTML/CSS/JS siempre frescos, assets en caché
scripts/              Servidor local, datos de ejemplo, auditoría e iconos
```

El documento que se imprime y se envía tiene su propia especificación en
`js/layout.js` (puntos, Letter 612 × 792) y se pinta dos veces con las mismas
coordenadas: `js/render.js` para la pantalla y `js/pdf.js` para el archivo.
Cambiar la interfaz no toca el documento, y viceversa.

## Documentos

- [DISENO.md](DISENO.md) — criterio visual, tokens, breakpoints e historial de versiones.
- [SINCRONIZACION.md](SINCRONIZACION.md) — puesta en marcha de la cuenta y detalle del protocolo de sync.

## Notas

- Los datos viven en `localStorage` (`mc_docs`, `mc_clientes`, `mc_cxp`,
  `mc_productos`, `mc_tareas`, `mc_settings`). Sin cuenta, son de este
  dispositivo.
- El motor de PDF no se carga al arrancar: se pide cuando se va a compartir.
- Todo el tipografía es local (Archivo, OFL 1.1). No hay peticiones a
  terceros.
