# Sincronización entre dispositivos

Tu app ya sincroniza **recibos y cotizaciones, clientes, cuentas por pagar, el
catálogo de productos y servicios, y los ajustes** entre todos los equipos donde
entres con la misma cuenta (celular ⇄ compu).

- **Offline-first**: la app funciona sin internet. Los cambios se guardan local y se
  sincronizan solos al volver a estar en línea.
- **Cuenta**: email + contraseña (mínimo 6 caracteres). Tu contraseña es la llave de
  tus datos: sin ella nadie puede leerlos.
- **Conflictos**: gana el cambio más reciente (por sello de tiempo).
- **Borrados** se propagan entre dispositivos (no se "resucita" nada por error).
- La **píldora** en la parte superior muestra el estado: `SYNC hh:mm` (verde),
  `SINCRONIZANDO…`, `SIN CONEXIÓN` o `ERROR DE SYNC`.
- **Cerrar sesión** está en el menú «Más» (en la cabecera de escritorio o en la barra inferior móvil) y en **Ajustes → Cuenta y sincronización**.

---

## Puesta en marcha (una vez, ~5 minutos)

El código ya está en la rama. Para que el backend exista hay que darle base de datos
y secreto de sesión. Se hace todo desde el dashboard de Vercel, sin tocar código:

### 1. Crea la base de datos (gratis)

1. Entra a [vercel.com/dashboard](https://vercel.com/dashboard) y abre tu proyecto **clerki**.
2. Pestaña **Storage** → botón **Add** → **Postgres** → **Add**.
3. Elige una región (la que más cerca esté de ti, ej. `South America (São Paulo)`).
4. Al terminar, Vercel crea la base y **automáticamente configura la variable
   `DATABASE_URL`** para el proyecto (en producción y preview). No hay que hacer nada más.

> El primer deploy crea las tablas solo, no hay que migrar nada.

### 2. Crea el secreto de sesión

1. En el proyecto: **Settings → Environment Variables → Add**.
2. Nombre: `SESSION_SECRET`
3. Valor: una cadena larga y aleatoria (40+ caracteres). Puedes generarla en tu terminal:
   ```
   openssl rand -hex 32
   ```
   (o escribe cualquier frase larga y desordenada; solo debe ser secreta).
4. En **Environments** deja marcadas **Production** y **Preview** → **Add**.

### 3. Deploy

Cuando esta rama se empuje / se mergee, Vercel hace el deploy solo. Verás en el build
que instala `pg` (dependencia nueva) y despliega 3 funciones:
`/api/register`, `/api/login`, `/api/sync`.

### 4. Prueba

1. Abre tu sitio (`clerki.vercel.app`). Si el service worker tiene caché vieja,
   haz **recarga dura** (Ctrl+Shift+R / en el menú del navegador → recargar sin caché).
2. Aparece la puerta de cuenta → **Crear cuenta** → email + contraseña.
3. Tus datos actuales (de ese dispositivo) se suben solos.
4. En el segundo equipo: mismo sitio → **Ingresar** con la misma cuenta →
   todos tus documentos aparecen.

---

## Detalle técnico (referencia)

| Pieza | Dónde | Qué hace |
|---|---|---|
| `api/_lib.js` | backend | Pool `pg` + esquema (`app_users`, `app_records`) + scrypt + token HMAC (30 días) |
| `api/register.js` | `POST /api/register` | Crea cuenta, devuelve token |
| `api/login.js` | `POST /api/login` | Verifica, devuelve token |
| `api/sync.js` | `GET /api/sync?since=` · `POST /api/sync` | Pull incremental / push con guarda "solo si es más nuevo" |
| `js/sync.js` | cliente | Cola de cambios, pull+push, merge last-write-wins, tumbas, píldora de estado |
| `js/app.js` | hooks | Notifica cambios/borrados al sincronizador; refresca vistas al llegar remoto |
| `sw.js` v82 | PWA | Cachea `js/sync.js` y los archivos de la interfaz |

**Esquema:** `app_records(owner_email, kind, record_id, data JSONB, updated_at BIGINT,
deleted BOOL, PK(owner_email, kind, record_id))` — cada fila es un documento, cliente,
cuenta por pagar, producto del catálogo, o los ajustes (id `_`).

**Colecciones que viajan** (`COLLECTIONS` en `js/sync.js` · `KINDS` en `api/_lib.js`):
`docs`, `settings`, `clientes`, `cxp`, `productos` y `tareas` (`localStorage: mc_*`).
Para añadir una colección hay que darla de alta en los dos lados: si el `kind` no
está en `KINDS`, el servidor rechaza el registro silenciosamente.

**Reglas de merge:**

- Pull: registros con `updated_at > cursor` (el cursor es el "now" del servidor; nunca retrocede).
- Push: solo se escribe si el registro local no existe **o** es más reciente (o igual).
  Un push viejo jamás pisa un dato nuevo del otro equipo — la misma regla aplica a los borrados.
- Local: cada registro lleva `updatedAt`; si llega un remoto más nuevo (o igual) se aplica.
- Borrado = fila marcada `deleted` con su sello de tiempo; el equipo que recibe aplica la
  tumba solo si es más reciente que su copia local.

**Límites:** 500 registros por push (más que sobra); el body está limitado a 1 MB.
Los campos de contacto (RFC, método de pago, origen y seguimiento) viajan dentro
del JSON de cada cliente; no requieren cambios de esquema ni de `KINDS`.

**Seguridad:** contraseñas con `scrypt` (sal por usuario, comparación en tiempo
constante); tokens HMAC-SHA256 de 30 días sin estado; cada usuario solo ve sus filas.

---

## Si algo falla

- **La píldora dice `ERROR DE SYNC`** y ya tienes internet: abre DevTools → Network →
  busca `/api/sync`. Un `500` suele significar que falta `DATABASE_URL` o `SESSION_SECRET`
  (revisa los pasos 1 y 2). Un `401` es sesión expirada: la app te manda sola a la
  puerta de acceso.
- **No aparece la puerta de cuenta**: caché vieja del service worker → recarga dura.
- **Los datos no aparecen en el otro equipo**: confirma que entraste con el mismo email
  (es case-insensitive) y espera ~1 segundo (el sync va con un pequeño debounce).
- **Borrar todo**: en el dashboard de Vercel → Storage → Postgres → Delete. La app
  sigue funcionando local; la cuenta queda "vacía".
