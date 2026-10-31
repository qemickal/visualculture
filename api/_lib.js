/* ============================================================
   API SHARED — base de datos, esquema, autenticación y helpers
   (Vercel Functions · Node 18+ · pg)
   ============================================================ */
'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');

/* ---------------- Base de datos ---------------- */

let _pool = null;
function db() {
  if (!_pool) {
    const url = process.env.DATABASE_URL || '';
    const opts = {
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000,
    };
    // Vercel Postgres (Neon) exige TLS; solo lo forzamos si la URL no lo define
    if (url && !/sslmode=/.test(url)) opts.ssl = { rejectUnauthorized: false };
    _pool = new Pool(opts);
  }
  return _pool;
}

let _schemaReady = null;
async function ensureSchema() {
  if (!_schemaReady) {
    _schemaReady = (async () => {
      await db().query(`
        CREATE TABLE IF NOT EXISTS app_users (
          email      TEXT PRIMARY KEY,
          pass_hash  TEXT NOT NULL,
          salt       TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await db().query(`
        CREATE TABLE IF NOT EXISTS app_records (
          owner_email TEXT NOT NULL,
          kind        TEXT NOT NULL,
          record_id   TEXT NOT NULL,
          data        JSONB,
          updated_at  BIGINT NOT NULL,
          deleted     BOOLEAN NOT NULL DEFAULT FALSE,
          PRIMARY KEY (owner_email, kind, record_id)
        )`);
      await db().query(`
        CREATE INDEX IF NOT EXISTS app_records_owner_ts_idx
          ON app_records (owner_email, updated_at)`);
    })();
  }
  return _schemaReady;
}

/* ---------------- Contraseñas (scrypt, sin dependencias) ---------------- */

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64, SCRYPT_OPTS).toString('hex');
}

function verifyPassword(password, salt, expectedHex) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(String(expectedHex), 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/* ---------------- Sesión: token HMAC sin estado (30 días) ---------------- */

function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('Falta la variable de entorno SESSION_SECRET (mín. 16 caracteres)');
  }
  return s;
}

function makeToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 30 * 24 * 3600 * 1000 }))
    .toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i < 8) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  let a, b;
  try {
    a = Buffer.from(sig);
    b = Buffer.from(crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url'));
  } catch (e) { return null; }
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!p.email || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return p;
  } catch (e) { return null; }
}

/* ---------------- Helpers HTTP ---------------- */

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = code;
  res.end(body);
}

const MAX_BODY = 1024 * 1024; // 1 MB

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('BAD_JSON')); }
    });
    req.on('error', reject);
  });
}

function bearerToken(req) {
  const h = req.headers && req.headers.authorization;
  const m = /^Bearer\s+(.+)$/i.exec(h || '');
  return m ? m[1].trim() : null;
}

async function authUser(req) {
  const t = bearerToken(req);
  if (!t) return null;
  return verifyToken(t);
}

/* ---------------- Validación de registros de sync ---------------- */

const KINDS = { docs: 1, settings: 1, clientes: 1, cxp: 1, productos: 1, tareas: 1 };

function normEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function validEmail(raw) {
  const e = normEmail(raw);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
}

function validRecord(r) {
  if (!r || typeof r !== 'object') return false;
  if (!KINDS[r.kind]) return false;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 100) return false;
  const ts = Number(r.updatedAt);
  if (!Number.isFinite(ts) || ts <= 0 || ts > 8.64e15) return false;
  return true;
}

module.exports = {
  db, ensureSchema,
  newSalt, hashPassword, verifyPassword,
  makeToken, verifyToken,
  json, readJson, authUser, bearerToken,
  KINDS, normEmail, validEmail, validRecord,
};
