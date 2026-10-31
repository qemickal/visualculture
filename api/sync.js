/* ============================================================
   /api/sync — sincronización de datos
   GET  /api/sync?since=<ms>  → registros cambiados desde el cursor
   POST /api/sync {records}   → upsert con guarda "solo si es más nuevo"
   Último en escribir gana (last-write-wins por timestamp).
   ============================================================ */
'use strict';

const L = require('./_lib');

const MAX_RECORDS = 500;
const MAX_PULL = 1000;

async function pull(req, res, user) {
  const sinceRaw = Number((req.query && req.query.since) || 0);
  const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : 0;

  const { rows } = await L.db().query(
    `SELECT kind, record_id, data, updated_at, deleted
       FROM app_records
      WHERE owner_email = $1 AND updated_at > $2
      ORDER BY updated_at
      LIMIT $3`,
    [user.email, since, MAX_PULL]
  );

  L.json(res, 200, {
    now: Date.now(),
    records: rows.map((r) => ({
      kind: r.kind,
      id: r.record_id,
      data: r.data,
      updatedAt: Number(r.updated_at),
      deleted: !!r.deleted,
    })),
  });
}

async function push(req, res, user) {
  const body = await L.readJson(req);
  const incoming = Array.isArray(body.records) ? body.records.slice(0, MAX_RECORDS) : [];

  let applied = 0;
  for (const r of incoming) {
    if (!L.validRecord(r)) continue;
    const ts = Math.floor(Number(r.updatedAt));

    const ex = await L.db().query(
      'SELECT updated_at FROM app_records WHERE owner_email = $1 AND kind = $2 AND record_id = $3',
      [user.email, r.kind, r.id]
    );

    if (ex.rowCount === 0) {
      await L.db().query(
        `INSERT INTO app_records (owner_email, kind, record_id, data, updated_at, deleted)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.email, r.kind, r.id, JSON.stringify(r.data == null ? null : r.data), ts, !!r.deleted]
      );
      applied++;
    } else if (Number(ex.rows[0].updated_at) <= ts) {
      await L.db().query(
        `UPDATE app_records
            SET data = $4, updated_at = $5, deleted = $6
          WHERE owner_email = $1 AND kind = $2 AND record_id = $3`,
        [user.email, r.kind, r.id, JSON.stringify(r.data == null ? null : r.data), ts, !!r.deleted]
      );
      applied++;
    }
    // si el existente es más nuevo → se ignora (protege al otro dispositivo)
  }

  L.json(res, 200, { now: Date.now(), applied });
}

module.exports = async function (req, res) {
  try {
    await L.ensureSchema();
    const user = await L.authUser(req);
    if (!user) return L.json(res, 401, { error: 'SIN_SESION' });

    if (req.method === 'GET') return await pull(req, res, user);
    if (req.method === 'POST') return await push(req, res, user);
    L.json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    L.json(res, 500, { error: 'SERVIDOR' });
  }
};
