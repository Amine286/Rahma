/* database.js — أدوات مساعدة + قاعدة البيانات المحلية (IndexedDB) */
(function () {
  'use strict';
  var RM = (window.RM = window.RM || {});

  /* ---------------------------- أدوات مساعدة ---------------------------- */
  function pad(n, l) { return String(n).padStart(l || 2, '0'); }

  RM.util = {
    pad: pad,
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    // توحيد النص للبحث: حروف صغيرة، بلا تشكيل ولا لكنات فرنسية، وتوحيد الألف والياء والتاء المربوطة
    norm: function (s) {
      return String(s == null ? '' : s).toLowerCase().normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[ً-ٰٟـ]/g, '')
        .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
    },
    todayISO: function () {
      var d = new Date();
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },
    nowHM: function () {
      var d = new Date();
      return pad(d.getHours()) + ':' + pad(d.getMinutes());
    },
    fmtQty: function (n) {
      n = Number(n);
      return isFinite(n) ? String(Math.round(n * 1000) / 1000) : '0';
    },
    parseQty: function (v, fallback) {
      var n = parseFloat(String(v).replace(',', '.').replace(/[^\d.]/g, ''));
      return isFinite(n) && n > 0 ? n : (fallback == null ? 1 : fallback);
    },
    fmtDateLong: function (d) {
      d = d || new Date();
      try {
        return d.toLocaleDateString('ar-DZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' });
      } catch (e) {
        try { return d.toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
        catch (e2) { return d.toDateString(); }
      }
    },
    fmtDateTime: function (ts) {
      var d = new Date(ts);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    },
    // 0562167110 → 213562167110
    phone: function (s) {
      var d = String(s || '').replace(/\D/g, '');
      if (d.indexOf('00') === 0) d = d.slice(2);
      else if (d.charAt(0) === '0') d = '213' + d.slice(1);
      return d;
    }
  };

  /* ---------------------------- IndexedDB ---------------------------- */
  var DB_NAME = 'rahma-market';
  var DB_VER = 1;
  var STORES = { products: 'code', orders: 'number', meta: 'key' };
  var dbp = null;
  var mem = { products: {}, orders: {}, meta: {} };
  var useMem = false;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
      var r;
      try { r = indexedDB.open(DB_NAME, DB_VER); } catch (e) { reject(e); return; }
      r.onupgradeneeded = function () {
        var d = r.result;
        Object.keys(STORES).forEach(function (s) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: STORES[s] });
        });
      };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.onblocked = function () { reject(new Error('blocked')); };
    }).catch(function (e) {
      // وضع احتياطي في الذاكرة (مثلاً التصفح الخاص) حتى لا يتعطل الموقع
      useMem = true;
      console.warn('IndexedDB غير متاح، استعمال الذاكرة المؤقتة', e);
      return null;
    });
    return dbp;
  }

  function run(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var req = fn(t.objectStore(store));
        t.oncomplete = function () { resolve(req && req.result !== undefined ? req.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('aborted')); };
      });
    });
  }

  function keyOf(store, v) { return v[STORES[store]]; }

  RM.db = {
    open: open,
    isMemory: function () { return useMem; },
    get: function (store, key) {
      return open().then(function (db) {
        if (useMem || !db) return mem[store][key];
        return run(store, 'readonly', function (s) { return s.get(key); });
      });
    },
    put: function (store, val) {
      return open().then(function (db) {
        if (useMem || !db) { mem[store][keyOf(store, val)] = val; return; }
        return run(store, 'readwrite', function (s) { return s.put(val); });
      });
    },
    del: function (store, key) {
      return open().then(function (db) {
        if (useMem || !db) { delete mem[store][key]; return; }
        return run(store, 'readwrite', function (s) { return s.delete(key); });
      });
    },
    all: function (store) {
      return open().then(function (db) {
        if (useMem || !db) return Object.keys(mem[store]).map(function (k) { return mem[store][k]; });
        return run(store, 'readonly', function (s) { return s.getAll(); }).then(function (r) { return r || []; });
      });
    },
    clear: function (store) {
      return open().then(function (db) {
        if (useMem || !db) { mem[store] = {}; return; }
        return run(store, 'readwrite', function (s) { return s.clear(); });
      });
    },
    // استبدال محتوى مخزن كاملاً في عملية واحدة
    replaceAll: function (store, list) {
      return open().then(function (db) {
        if (useMem || !db) {
          mem[store] = {};
          list.forEach(function (v) { mem[store][keyOf(store, v)] = v; });
          return;
        }
        return run(store, 'readwrite', function (s) {
          s.clear();
          list.forEach(function (v) { s.put(v); });
          return null;
        });
      });
    },
    getMeta: function (key) {
      return RM.db.get('meta', key).then(function (r) { return r ? r.value : undefined; });
    },
    setMeta: function (key, value) {
      return RM.db.put('meta', { key: key, value: value });
    }
  };
})();
