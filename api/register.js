/* POST /api/register — crea la cuenta y devuelve token de sesión */
'use strict';

const L = require('./_lib');

module.exports = async function (req, res) {
  if (req.method !== 'POST') return L.json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    await L.ensureSchema();
    const body = await L.readJson(req);
    const email = L.normEmail(body.email);
    const password = String(body.password || '');

    if (!L.validEmail(email)) return L.json(res, 400, { error: 'EMAIL_INVALIDO' });
    if (password.length < 6 || password.length > 200) {
      return L.json(res, 400, { error: 'CONTRA_SENOR_DEBIL' });
    }

    const salt = L.newSalt();
    const hash = L.hashPassword(password, salt);

    const exists = await L.db().query('SELECT 1 FROM app_users WHERE email = $1', [email]);
    if (exists.rows.length) return L.json(res, 409, { error: 'YA_EXISTE' });

    await L.db().query(
      `INSERT INTO app_users (email, pass_hash, salt) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [email, hash, salt]
    );

    // si perdimos una carrera de registro simultáneo, el salt no es el nuestro
    const chk = await L.db().query('SELECT salt FROM app_users WHERE email = $1', [email]);
    if (!chk.rows.length || chk.rows[0].salt !== salt) {
      return L.json(res, 409, { error: 'YA_EXISTE' });
    }

    L.json(res, 200, { token: L.makeToken(email), email });
  } catch (e) {
    L.json(res, 500, { error: 'SERVIDOR' });
  }
};
