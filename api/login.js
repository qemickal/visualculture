/* POST /api/login — verifica credenciales y devuelve token de sesión */
'use strict';

const L = require('./_lib');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return L.json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    await L.ensureSchema();
    const body = await L.readJson(req);
    const email = L.normEmail(body.email);
    const password = String(body.password || '');

    if (!L.validEmail(email) || !password) return L.json(res, 400, { error: 'CREDENCIALES_INVALIDAS' });

    const { rows } = await L.db().query(
      'SELECT pass_hash, salt FROM app_users WHERE email = $1',
      [email]
    );
    const row = rows[0];
    if (!row || !L.verifyPassword(password, row.salt, row.pass_hash)) {
      return L.json(res, 401, { error: 'CREDENCIALES_INVALIDAS' });
    }

    L.json(res, 200, { token: L.makeToken(email), email });
  } catch (e) {
    L.json(res, 500, { error: 'SERVIDOR' });
  }
};
