/* sync.js — تسجيل الدخول والمزامنة مع Google Apps Script */
(function () {
  'use strict';
  var RM = (window.RM = window.RM || {});
  var C = window.RM_CONFIG;
  var SKEY = 'rm_session';
  var memSession = null;

  /* ---------------------------- الجلسة ---------------------------- */
  RM.auth = {
    get: function () {
      try {
        var s = localStorage.getItem(SKEY) || sessionStorage.getItem(SKEY);
        if (s) return JSON.parse(s);
      } catch (e) { /* التخزين غير متاح */ }
      return memSession;
    },
    set: function (sess, remember) {
      memSession = sess;
      try {
        localStorage.removeItem(SKEY);
        sessionStorage.removeItem(SKEY);
        (remember ? localStorage : sessionStorage).setItem(SKEY, JSON.stringify(sess));
      } catch (e) { /* نكتفي بالذاكرة */ }
    },
    clear: function () {
      memSession = null;
      try { localStorage.removeItem(SKEY); sessionStorage.removeItem(SKEY); } catch (e) { /* لا شيء */ }
    }
  };

  /* ---------------------------- الاتصال بالخادم ---------------------------- */
  function configured() {
    var u = C.APPS_SCRIPT_URL;
    return !!u && !/PASTE_/.test(u);
  }

  // نرسل النص كـ text/plain حتى لا يطلب المتصفح فحصاً مسبقاً (CORS preflight) مع Apps Script
  function api(payload, timeoutMs) {
    if (!configured()) return Promise.resolve({ ok: false, error: 'not_configured' });
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 25000);
    return fetch(C.APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text();
    }).then(function (txt) {
      try { return JSON.parse(txt); } catch (e) { return { ok: false, error: 'bad_response' }; }
    }).catch(function () {
      return { ok: false, error: navigator.onLine === false ? 'offline' : 'network' };
    }).then(function (r) { clearTimeout(timer); return r; });
  }

  function cleanProducts(list) {
    var seen = {};
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (p) {
      if (!p) return;
      var code = String(p.code == null ? '' : p.code).trim();
      var name = String(p.name == null ? '' : p.name).trim();
      if (!code || !name || seen[code]) return;
      seen[code] = true;
      out.push({
        code: code,
        name: name,
        category: String(p.category == null ? '' : p.category).trim(),
        note: String(p.note == null ? '' : p.note).trim()
      });
    });
    return out;
  }

  function emit(detail) {
    document.dispatchEvent(new CustomEvent('rm:sync', { detail: detail }));
  }

  function pushLog(entry) {
    return RM.db.getMeta('syncLog').then(function (log) {
      log = Array.isArray(log) ? log : [];
      log.unshift(entry);
      return RM.db.setMeta('syncLog', log.slice(0, 8));
    });
  }

  function storeProducts(list) {
    var clean = cleanProducts(list);
    return RM.db.replaceAll('products', clean).then(function () {
      var now = Date.now();
      return RM.db.setMeta('lastSync', now).then(function () { return { products: clean, at: now }; });
    });
  }

  /* ---------------------------- تسجيل الدخول ---------------------------- */
  function login(username, password, remember) {
    return api({ action: 'login', username: username, password: password }).then(function (r) {
      if (!r || !r.ok) return r || { ok: false, error: 'network' };
      RM.auth.set({
        token: r.token,
        exp: r.exp,
        username: r.user.username,
        name: r.user.name,
        code: r.user.code || ''
      }, !!remember);
      return storeProducts(r.products).then(function (s) {
        pushLog({ at: s.at, ok: true, count: s.products.length, manual: true });
        return { ok: true, user: r.user, count: s.products.length };
      });
    });
  }

  /* ---------------------------- مزامنة المنتجات ---------------------------- */
  var running = false;
  var lastAttempt = 0;

  function syncProducts(opts) {
    opts = opts || {};
    if (running) return Promise.resolve({ ok: false, error: 'busy' });
    var sess = RM.auth.get();
    if (!sess) return Promise.resolve({ ok: false, error: 'no_session' });
    if (navigator.onLine === false) {
      emit({ phase: 'error', error: 'offline', manual: !!opts.manual });
      return Promise.resolve({ ok: false, error: 'offline' });
    }
    running = true;
    lastAttempt = Date.now();
    emit({ phase: 'start', manual: !!opts.manual });
    return api({ action: 'products', token: sess.token }).then(function (r) {
      if (r && r.ok) {
        return storeProducts(r.products).then(function (s) {
          pushLog({ at: s.at, ok: true, count: s.products.length, manual: !!opts.manual });
          emit({ phase: 'done', count: s.products.length, at: s.at, manual: !!opts.manual });
          return { ok: true, count: s.products.length };
        });
      }
      var err = (r && r.error) || 'network';
      pushLog({ at: Date.now(), ok: false, error: err, manual: !!opts.manual });
      emit({ phase: 'error', error: err, manual: !!opts.manual });
      return { ok: false, error: err };
    }).then(function (res) { running = false; return res; },
      function (e) { running = false; throw e; });
  }

  var timer = null;
  function start() {
    stop();
    var mins = Math.max(1, Number(C.AUTO_SYNC_MINUTES) || 5);
    timer = setInterval(function () { syncProducts({}); }, mins * 60000);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  window.addEventListener('online', function () { if (RM.auth.get()) syncProducts({}); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && RM.auth.get() && Date.now() - lastAttempt > 120000) {
      syncProducts({});
    }
  });

  RM.sync = {
    configured: configured,
    login: login,
    syncProducts: syncProducts,
    start: start,
    stop: stop,
    isRunning: function () { return running; }
  };
})();
