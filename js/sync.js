/* ============================================================
   SYNC — cuenta + sincronización entre dispositivos
   Offline-first: localStorage sigue siendo la fuente local;
   push/pull incremental contra /api/* con último-en-escribir
   gana (last-write-wins) y tumbas para borrados.
   ============================================================ */
(function () {
  'use strict';
  if (window.SYNC) return;

  const TOKEN_KEY = 'mc_token';
  const EMAIL_KEY = 'mc_email';
  const TOMB_KEY = 'mc_tombstones'; // { kind: { id: ts } }
  const META_KEY = 'mc_sync_meta';  // { serverCursor, lastPush }

  /* Colecciones que viajan. id de registro = r.id (arrays) o '_' (settings) */
  const COLLECTIONS = {
    docs:     { key: 'mc_docs',     array: true },
    settings: { key: 'mc_settings', array: false },
    clientes: { key: 'mc_clientes', array: true },
    cxp:      { key: 'mc_cxp',      array: true },
    productos:{ key: 'mc_productos',array: true },
    tareas:  { key: 'mc_tareas',   array: true }
  };

  /* ---------------- localStorage (mismas llaves que app.js) ---------------- */
  function lsGet(k, d) {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch (e) { return d; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function getMeta() {
    const m = lsGet(META_KEY, null);
    return {
      serverCursor: Number(m && m.serverCursor) || 0,
      lastPush: Number(m && m.lastPush) || 0
    };
  }
  function getTomb() { const t = lsGet(TOMB_KEY, null); return (t && typeof t === 'object') ? t : {}; }

  function authed() { return !!lsGet(TOKEN_KEY, null); }
  function accountEmail() { return lsGet(EMAIL_KEY, '') || ''; }

  /* ---------------- Píldora de estado ---------------- */
  let state = 'off'; // off | busy | ok | err | offl
  let lastOkTime = null;

  function fmtHm(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function pill() {
    const el = document.getElementById('sync-pill');
    if (!el) return;
    const map = {
      off:  { cls: 'sync-off',  label: authed() ? 'Sin conexión' : 'Sin cuenta' },
      offl: { cls: 'sync-offl', label: 'Sin conexión' },
      busy: { cls: 'sync-busy', label: 'Sincronizando…' },
      err:  { cls: 'sync-err',  label: 'Error de sync' },
      ok:   { cls: 'sync-ok',   label: lastOkTime ? 'Sync ' + fmtHm(lastOkTime) : 'Sincronizado' }
    };
    const m = map[state] || map.off;
    el.className = 'sync-pill ' + m.cls;
    el.textContent = m.label;
    el.title = 'Sincronización entre dispositivos · ' + (accountEmail() || 'sin cuenta');
  }

  /* ---------------- Red ---------------- */
  async function postJson(path, payload, withAuth) {
    const headers = { 'Content-Type': 'application/json' };
    if (withAuth) {
      const t = lsGet(TOKEN_KEY, null);
      if (t) headers['Authorization'] = 'Bearer ' + t;
    }
    let res;
    try {
      res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload || {}) });
    } catch (e) {
      const err = new Error('SIN_RETE');
      throw err;
    }
    let body = null;
    try { body = await res.json(); } catch (e) {}
    if (res.status === 401 && withAuth) { sessionExpired(); }
    if (!res.ok) {
      const err = new Error((body && body.error) || ('HTTP' + res.status));
      err.status = res.status;
      throw err;
    }
    return body || {};
  }

  async function pullSync(since) {
    const t = lsGet(TOKEN_KEY, null);
    let res;
    try {
      res = await fetch('/api/sync?since=' + encodeURIComponent(since || 0), {
        headers: t ? { Authorization: 'Bearer ' + t } : {}
      });
    } catch (e) {
      throw new Error('SIN_RETE');
    }
    let body = null;
    try { body = await res.json(); } catch (e) {}
    if (res.status === 401) { sessionExpired(); }
    if (!res.ok) {
      const err = new Error((body && body.error) || ('HTTP' + res.status));
      err.status = res.status;
      throw err;
    }
    return body || { now: Date.now(), records: [] };
  }

  /* ---------------- Autenticación ---------------- */
  function storeSession(token, email) {
    lsSet(TOKEN_KEY, token);
    lsSet(EMAIL_KEY, email);
  }

  function doLogout() {
    lsDel(TOKEN_KEY);
    lsDel(EMAIL_KEY);
    window.location.reload();
  }

  function sessionExpired() {
    // token inválido/expirado → volver a la puerta de acceso
    lsDel(TOKEN_KEY);
    lsDel(EMAIL_KEY);
    window.location.reload();
  }

  /* ---------------- Gate de acceso ---------------- */
  function showAuth(onSuccess) {
    const gate = document.getElementById('auth-gate');
    if (!gate) { onSuccess(); return; }

    state = navigator.onLine ? 'off' : 'offl';
    pill();
    gate.hidden = false;
    document.body.classList.add('auth-open');

    const forms = {
      login: gate.querySelector('#auth-form-login'),
      register: gate.querySelector('#auth-form-register')
    };
    const errEls = {
      login: gate.querySelector('#auth-login-error'),
      register: gate.querySelector('#auth-register-error')
    };
    let mode = 'login';
    const setErr = (msg) => {
      for (const m of Object.keys(errEls)) {
        const el = errEls[m];
        if (!el) continue;
        el.textContent = (m === mode) ? (msg || '') : '';
        el.classList.toggle('show', m === mode && !!msg);
      }
    };
    const setMode = (m) => {
      mode = m;
      setErr('');
      gate.querySelectorAll('[data-auth-tab]').forEach((b) => b.classList.toggle('on', b.dataset.authTab === m));
      forms.login.hidden = m !== 'login';
      forms.register.hidden = m !== 'register';
    };
    gate.querySelectorAll('[data-auth-tab]').forEach((b) => {
      b.addEventListener('click', () => setMode(b.dataset.authTab));
    });

    const setBusy = (on) => {
      gate.querySelectorAll('form button[type=submit]').forEach((b) => { b.disabled = on; });
    };

    const submit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const email = (f.querySelector('input[type=email]') || {}).value || '';
      const password = (f.querySelector('input[type=password]') || {}).value || '';
      if (!email.trim() || !password) { setErr('Escribe tu email y contraseña.'); return; }
      setBusy(true); setErr('');
      try {
        const path = mode === 'login' ? '/api/login' : '/api/register';
        const r = await postJson(path, { email: email.trim(), password }, false);
        storeSession(r.token, r.email);
        setBusy(false);
        gate.hidden = true;
        document.body.classList.remove('auth-open');
        setMode('login');
        runSync(true); // primera sincronización inmediata
        onSuccess();
      } catch (err) {
        setBusy(false);
        const map = {
          CREDENCIALES_INVALIDAS: 'Email o contraseña incorrectos.',
          YA_EXISTE: 'Ese email ya tiene cuenta. Pasa a «Ingresar».',
          EMAIL_INVALIDO: 'El email no parece válido.',
          CONTRA_SENOR_DEBIL: 'La contraseña necesita al menos 6 caracteres.',
          SIN_RETE: 'Sin conexión. Revisa tu internet e intenta de nuevo.',
          SERVIDOR: 'El servidor no respondió. Intenta de nuevo en unos segundos.'
        };
        setErr(map[err.message] || 'No se pudo completar la operación. Intenta de nuevo.');
      }
    };
    forms.login.addEventListener('submit', submit);
    forms.register.addEventListener('submit', submit);
    setMode('login');
  }

  /* ---------------- Merge: aplicar remotos a local ---------------- */
  let remoteHandler = null;

  function applyRemote(records) {
    if (!records || !records.length) return new Set();
    const changed = new Set();
    for (const rec of records) {
      if (!rec) continue;
      const cfg = COLLECTIONS[rec.kind];
      if (!cfg) continue;
      const ts = Number(rec.updatedAt) || 0;

      if (!cfg.array) {
        const local = lsGet(cfg.key, null);
        const lts = Number(local && local.updatedAt) || 0;
        if (ts >= lts) {
          lsSet(cfg.key, rec.deleted ? null : rec.data);
          changed.add(cfg.key);
        }
        continue;
      }

      const list = lsGet(cfg.key, null);
      const arr = Array.isArray(list) ? list : [];
      const idx = arr.findIndex((x) => x && String(x.id) === String(rec.id));

      if (rec.deleted) {
        if (idx >= 0) {
          arr.splice(idx, 1);
          lsSet(cfg.key, arr);
          changed.add(cfg.key);
        }
      } else {
        const lts = idx >= 0 ? (Number(arr[idx] && arr[idx].updatedAt) || 0) : 0;
        if (ts >= lts) {
          if (idx >= 0) arr[idx] = rec.data;
          else arr.push(rec.data);
          lsSet(cfg.key, arr);
          changed.add(cfg.key);
        }
      }
    }
    if (changed.size && typeof remoteHandler === 'function') {
      try { remoteHandler(changed); } catch (e) { /* la app re-renderiza a su ritmo */ }
    }
    return changed;
  }

  /* ---------------- Push: qué es sucio ---------------- */
  function normalizeLocal() {
    // registros heredados sin updatedAt/id: se normalizan una vez
    for (const kind of Object.keys(COLLECTIONS)) {
      const cfg = COLLECTIONS[kind];
      if (!cfg.array) {
        const s = lsGet(cfg.key, null);
        if (s && !Number(s.updatedAt)) { s.updatedAt = Date.now(); lsSet(cfg.key, s); }
        continue;
      }
      const arr = lsGet(cfg.key, null);
      if (!Array.isArray(arr) || !arr.length) continue;
      let changed = false;
      arr.forEach((r, i) => {
        if (!r || typeof r !== 'object') return;
        if (!Number(r.updatedAt)) { r.updatedAt = Date.now() - 60000 + i; changed = true; }
        if (r.id == null || r.id === '') { r.id = 'l' + Date.now().toString(36) + i.toString(36); changed = true; }
      });
      if (changed) lsSet(cfg.key, arr);
    }
  }

  function collectDirty(meta) {
    const out = [];
    const tomb = getTomb();
    for (const kind of Object.keys(COLLECTIONS)) {
      const cfg = COLLECTIONS[kind];
      if (cfg.array) {
        const arr = lsGet(cfg.key, null);
        if (Array.isArray(arr)) {
          for (const r of arr) {
            if (!r || r.id == null) continue;
            const ts = Number(r.updatedAt) || 0;
            if (ts > meta.lastPush) out.push({ kind, id: String(r.id), data: r, updatedAt: ts, deleted: false });
          }
        }
      } else {
        const s = lsGet(cfg.key, null);
        if (s) {
          const ts = Number(s.updatedAt) || 0;
          if (ts > meta.lastPush) out.push({ kind, id: '_', data: s, updatedAt: ts, deleted: false });
        }
      }
      const kt = tomb[kind];
      if (kt && typeof kt === 'object') {
        for (const id of Object.keys(kt)) {
          const ts = Number(kt[id]);
          if (ts > meta.lastPush) out.push({ kind, id, data: null, updatedAt: ts, deleted: true });
        }
      }
    }
    return out.slice(0, 500);
  }

  function tombstone(kind, id) {
    if (!COLLECTIONS[kind] || id == null) return;
    const t = getTomb();
    t[kind] = t[kind] || {};
    t[kind][String(id)] = Date.now();
    lsSet(TOMB_KEY, t);
    queueSync();
  }

  function pruneTombstones(untilTs) {
    if (!untilTs) return;
    const t = getTomb();
    let changed = false;
    for (const kind of Object.keys(t)) {
      for (const id of Object.keys(t[kind] || {})) {
        if (Number(t[kind][id]) <= untilTs) { delete t[kind][id]; changed = true; }
      }
      if (!Object.keys(t[kind] || {}).length) delete t[kind];
    }
    if (changed) lsSet(TOMB_KEY, t);
  }

  /* ---------------- Bucle de sincronización ---------------- */
  let inFlight = false;
  let queued = false;
  let debounceT = null;

  function queueSync() {
    if (!authed()) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) { state = 'offl'; pill(); return; }
    clearTimeout(debounceT);
    debounceT = setTimeout(() => runSync(true), 800);
  }

  async function runSync(immediate) {
    if (!authed()) { state = 'off'; pill(); return; }
    if (inFlight) { queued = true; return; }
    inFlight = true;
    state = 'busy';
    pill();
    try {
      normalizeLocal();
      const meta = getMeta();

      // 1) PULL — el servidor es la única fuente de tiempo para el cursor
      const pull = await pullSync(meta.serverCursor);
      applyRemote(pull.records);
      meta.serverCursor = Math.max(meta.serverCursor, Number(pull.now) || 0);

      // 2) PUSH — lo que cambió localmente desde el último push
      const dirty = collectDirty(meta);
      if (dirty.length) {
        await postJson('/api/sync', { records: dirty }, true);
        let mx = meta.lastPush;
        for (const r of dirty) if (r.updatedAt > mx) mx = r.updatedAt;
        meta.lastPush = mx;
      }

      lsSet(META_KEY, meta);
      pruneTombstones(meta.lastPush);
      lastOkTime = Date.now();
      state = 'ok';
    } catch (err) {
      if (err.message === 'SIN_SESION') return; // sessionExpired ya recargó
      state = (typeof navigator !== 'undefined' && !navigator.onLine) ? 'offl' : 'err';
    } finally {
      inFlight = false;
      pill();
      if (queued) {
        queued = false;
        runSync(true);
      }
    }
  }

  /* ---------------- Eventos globales ---------------- */
  window.addEventListener('online', () => { pill(); queueSync(); });
  window.addEventListener('offline', () => { state = 'offl'; pill(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) queueSync();
  });

  /* ---------------- API pública ---------------- */
  window.SYNC = {
    authed,
    accountEmail,
    showAuth,
    logout: doLogout,
    localChanged: queueSync,
    tombstone,
    setRemoteHandler: (fn) => { remoteHandler = fn; },
    runSync,
    _state: () => state,
    _test: { applyRemote, collectDirty, getMeta, tombstone }
  };
})();
