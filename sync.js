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

  // مهمات العامل (من ورقة «المهمات»). إن لم يرسل الخادم مهمات (نسخة قديمة) نبقي المحفوظ
  function storeTasks(username, tasks) {
    if (!Array.isArray(tasks)) return Promise.resolve();
    var clean = tasks.filter(function (t) { return t && t.id && t.text; }).map(function (t) {
      return { id: String(t.id), text: String(t.text), note: String(t.note || '') };
    });
    return RM.db.setMeta('tasks:' + username, clean);
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
        code: r.user.code || '',
        role: r.user.role || 'worker'
      }, !!remember);
      return storeTasks(r.user.username, r.tasks).then(function () { return storeProducts(r.products); }).then(function (s) {
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
        return storeTasks(sess.username, r.tasks).then(function () { return storeProducts(r.products); }).then(function (s) {
          pushLog({ at: s.at, ok: true, count: s.products.length, manual: !!opts.manual });
          emit({ phase: 'done', count: s.products.length, at: s.at, manual: !!opts.manual });
          flush();
          pullMyOrders();
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


  /* ---------------------------- صندوق الإرسال (يعمل حتى بلا إنترنت) ---------------------------- */
  // كل ما يجب إرساله للخادم (طلبيات، حالة مهام) يُحفظ هنا ويُرسل عند توفر الإنترنت.
  function outKey() { var s = RM.auth.get(); return s ? 'outbox:' + s.username : null; }
  function loadOutbox() {
    var k = outKey();
    return k ? RM.db.getMeta(k).then(function (a) { return Array.isArray(a) ? a : []; }) : Promise.resolve([]);
  }
  function saveOutbox(list) { var k = outKey(); return k ? RM.db.setMeta(k, list) : Promise.resolve(); }

  function enqueue(item) {
    item.at = Date.now();
    return loadOutbox().then(function (list) {
      list = list.filter(function (x) { return x.key !== item.key; });
      list.push(item);
      return saveOutbox(list);
    }).then(function () { flush(); });
  }

  function markOrderResult(item, r) {
    if (item.kind !== 'order') return Promise.resolve();
    return RM.db.get('orders', item.number).then(function (o) {
      if (!o) return;
      o.sending = false;
      if (r.ok) { o.sent = true; o.status = r.status || 'new'; }
      else if (r.error === 'locked') { o.sent = true; o.status = r.status || o.status; o.lockedEdit = true; }
      else { o.sendError = r.error; }
      return RM.db.put('orders', o);
    });
  }

  var flushing = false;
  function flush() {
    var sess = RM.auth.get();
    if (flushing || !sess || !configured() || navigator.onLine === false) return Promise.resolve();
    flushing = true;
    function loop() {
      return loadOutbox().then(function (list) {
        if (!list.length) return;
        var it = list[0];
        var payload = Object.assign({ action: it.action, token: sess.token }, it.payload);
        return api(payload).then(function (r) {
          r = r || { ok: false, error: 'network' };
          if (r.error === 'unauthorized') { emit({ phase: 'error', error: 'unauthorized' }); return; }
          var final = r.ok || r.error === 'locked' || r.error === 'bad_request' || r.error === 'forbidden';
          if (!final) return; // مشكلة اتصال: نتوقف ونعيد لاحقاً
          return markOrderResult(it, r).then(function () {
            return loadOutbox();
          }).then(function (cur) {
            return saveOutbox(cur.filter(function (x) { return x.key !== it.key || x.at !== it.at; }));
          }).then(function () {
            document.dispatchEvent(new CustomEvent('rm:orders'));
            return loop();
          });
        });
      });
    }
    return loop().then(function () { flushing = false; }, function () { flushing = false; });
  }

  // طلب عادي للخادم برمز الجلسة (للمخزن: كل الطلبيات، تغيير الحالة، الإحصائيات...)
  function call(action, extra) {
    var sess = RM.auth.get();
    if (!sess) return Promise.resolve({ ok: false, error: 'no_session' });
    return api(Object.assign({ action: action, token: sess.token }, extra || {})).then(function (r) {
      if (r && r.error === 'unauthorized') emit({ phase: 'error', error: 'unauthorized' });
      return r;
    });
  }

  // نسخة احتياطية: نجلب طلبيات العامل من الجدول وندمجها مع المحلية (الحالة من الخادم)
  function pullMyOrders() {
    var sess = RM.auth.get();
    if (!sess || sess.role === 'warehouse' || navigator.onLine === false) return Promise.resolve({ ok: false });
    return call('myOrders').then(function (r) {
      if (!r || !r.ok) return r || { ok: false };
      return RM.db.all('orders').then(function (local) {
        var byId = {}, byNum = {};
        local.forEach(function (o) { if (o.id) byId[o.id] = o; byNum[o.number] = o; });
        var jobs = [];
        r.orders.forEach(function (s) {
          var o = byId[s.id];
          if (o) {
            o.status = s.status; o.statusAt = s.statusAt; o.statusBy = s.statusBy; o.sent = true; o.sending = false;
            jobs.push(RM.db.put('orders', o));
          } else {
            var num = s.number || ('BC-' + s.id);
            if (byNum[num]) num = num + '-' + (Number(String(s.id).split(':').pop()) % 1000);
            var t = Number(String(s.id).split(':').pop()) || Date.now();
            jobs.push(RM.db.put('orders', {
              number: num, id: s.id, status: s.status, sent: true, statusAt: s.statusAt, statusBy: s.statusBy,
              createdAt: t, time: s.time, username: sess.username, worker: s.worker, date: s.date,
              receiver: s.receiver, note: s.note, items: s.items.map(function (i) {
                return { code: i.code, name: i.name, category: i.category, note: i.note, qty: i.qty };
              })
            }));
          }
        });
        return Promise.all(jobs);
      }).then(function () {
        document.dispatchEvent(new CustomEvent('rm:orders'));
        return { ok: true };
      });
    });
  }

  var timer = null;
  function start() {
    stop();
    var mins = Math.max(1, Number(C.AUTO_SYNC_MINUTES) || 5);
    timer = setInterval(function () { syncProducts({}); }, mins * 60000);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  window.addEventListener('online', function () { if (RM.auth.get()) { flush(); syncProducts({}); } });
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
    isRunning: function () { return running; },
    enqueue: enqueue,
    flush: flush,
    call: call,
    pullMyOrders: pullMyOrders,
    pending: function () { return loadOutbox().then(function (l) { return l.length; }); }
  };
})();
