/* orders.js — الطلبية الحالية (السلة) + حفظ الطلبيات وسجلها */
(function () {
  'use strict';
  var RM = (window.RM = window.RM || {});
  var C = window.RM_CONFIG;
  var U = RM.util;

  var user = '';
  var userInfo = { name: '', code: '' };
  var saveTimer = null;

  function blank(receiver) {
    return { items: [], note: '', receiver: receiver || '', date: U.todayISO(), number: null };
  }

  function normItem(i) {
    return {
      code: String(i.code),
      name: String(i.name || ''),
      category: String(i.category || ''),
      note: String(i.note || ''),
      qty: U.parseQty(i.qty, 1)
    };
  }

  /* ---------------------------- الإعدادات ---------------------------- */
  RM.settings = {
    get: function () {
      return RM.db.getMeta('settings').then(function (s) {
        s = s || {};
        return {
          receiver: s.receiver ? s.receiver : C.DEFAULT_RECEIVER,
          whatsapp: s.whatsapp !== undefined ? s.whatsapp : (C.WHATSAPP_NUMBER || '')
        };
      });
    },
    set: function (patch) {
      return RM.db.getMeta('settings').then(function (s) {
        return RM.db.setMeta('settings', Object.assign({}, s || {}, patch));
      });
    }
  };

  /* ---------------------------- السلة (الطلبية الحالية) ---------------------------- */
  var cart = {
    state: blank(''),

    init: function (sess) {
      user = sess.username;
      userInfo = { name: sess.name || sess.username, code: sess.code || '' };
      return Promise.all([RM.db.getMeta('draft:' + user), RM.settings.get()]).then(function (r) {
        var d = r[0], st = r[1];
        var s = blank(st.receiver);
        if (d && typeof d === 'object') {
          s.items = (Array.isArray(d.items) ? d.items : []).filter(function (i) { return i && i.code; }).map(normItem);
          s.note = d.note || '';
          s.receiver = d.receiver || st.receiver;
          s.date = d.date || s.date;
          s.number = d.number || null;
        }
        if (!s.items.length && !s.number) s.date = U.todayISO();
        cart.state = s;
      });
    },

    _emit: function () { document.dispatchEvent(new CustomEvent('rm:cart')); },
    persist: function () { clearTimeout(saveTimer); saveTimer = setTimeout(cart.flush, 200); },
    flush: function () {
      clearTimeout(saveTimer);
      return user ? RM.db.setMeta('draft:' + user, cart.state) : Promise.resolve();
    },

    find: function (code) {
      for (var i = 0; i < cart.state.items.length; i++) {
        if (cart.state.items[i].code === code) return cart.state.items[i];
      }
      return null;
    },
    add: function (p, qty) {
      qty = U.parseQty(qty, 1);
      var it = cart.find(p.code);
      if (it) it.qty = Math.round((it.qty + qty) * 1000) / 1000;
      else cart.state.items.push({ code: p.code, name: p.name, category: p.category || '', note: '', qty: qty });
      cart.persist(); cart._emit();
    },
    // silent = true: لا نعيد رسم الواجهة (حتى لا يضيع التركيز أثناء الكتابة)
    setQty: function (code, qty, silent) {
      var it = cart.find(code);
      if (!it) return;
      it.qty = U.parseQty(qty, it.qty);
      cart.persist();
      if (!silent) cart._emit();
    },
    setItemNote: function (code, note) {
      var it = cart.find(code);
      if (!it) return;
      it.note = String(note || '');
      cart.persist();
    },
    remove: function (code) {
      cart.state.items = cart.state.items.filter(function (i) { return i.code !== code; });
      cart.persist(); cart._emit();
    },
    setField: function (key, value) {
      cart.state[key] = value;
      cart.persist();
    },
    clear: function () {
      return RM.settings.get().then(function (st) {
        cart.state = blank(st.receiver);
        cart.persist();
        cart._emit();
        return cart.flush();
      });
    },
    loadFromOrder: function (order) {
      return RM.settings.get().then(function (st) {
        var s = blank(st.receiver);
        s.items = order.items.map(normItem);
        cart.state = s;
        cart.persist();
        cart._emit();
      });
    },
    count: function () { return cart.state.items.length; },
    totalQty: function () {
      return cart.state.items.reduce(function (s, i) { return s + Number(i.qty || 0); }, 0);
    }
  };

  /* ---------------------------- الطلبيات المحفوظة ---------------------------- */
  function formatNumber(n) {
    var tag = userInfo.code ? userInfo.code + '-' : '';
    return (C.ORDER_PREFIX || 'BC') + '-' + tag + U.pad(n, 4);
  }

  function counter() {
    return RM.db.getMeta('orderCounter').then(function (n) { return Number(n) || 0; });
  }

  async function allocateNumber() {
    var n = await counter();
    var num;
    do { n++; num = formatNumber(n); } while (await RM.db.get('orders', num));
    await RM.db.setMeta('orderCounter', n);
    return num;
  }

  var orders = {
    // الرقم المتوقع للطلبية القادمة (للعرض فقط)
    peekNumber: async function () {
      var n = await counter();
      var num;
      do { n++; num = formatNumber(n); } while (await RM.db.get('orders', num));
      return num;
    },

    // حفظ الطلبية الحالية. finalize = true: نحفظ ثم نبدأ طلبية جديدة فارغة
    saveCurrent: async function (opts) {
      var s = cart.state;
      if (!s.items.length) throw new Error('empty');
      var rec = s.number ? await RM.db.get('orders', s.number) : null;
      if (!rec) {
        var number = await allocateNumber();
        var now = Date.now();
        rec = { number: number, id: user + ':' + now, status: 'saved', sent: false, createdAt: now, time: U.nowHM() };
      }
      rec.username = user;
      rec.worker = userInfo.name;
      rec.date = s.date || U.todayISO();
      rec.receiver = s.receiver || '';
      rec.note = s.note || '';
      rec.items = s.items.map(function (i) { return Object.assign({}, i); });
      await RM.db.put('orders', rec);
      s.number = rec.number;
      if (opts && opts.finalize) await cart.clear();
      else await cart.flush();
      return rec;
    },

    list: async function () {
      var all = await RM.db.all('orders');
      return all.filter(function (o) { return o.username === user; })
        .sort(function (a, b) { return b.createdAt - a.createdAt; });
    },
    get: function (number) { return RM.db.get('orders', number); },
    remove: function (number) { return RM.db.del('orders', number); },
    setStatus: async function (number, status) {
      var o = await RM.db.get('orders', number);
      if (!o) return null;
      o.status = status;
      await RM.db.put('orders', o);
      return o;
    },
    totalQty: function (o) {
      return o.items.reduce(function (s, i) { return s + Number(i.qty || 0); }, 0);
    },
    // الحالات: saved (محفوظة لم تُرسل) | new (مرسلة) | preparing (قيد التحضير) | ready (جاهزة)
    statusLabel: function (s, o) {
      if (o && typeof o === 'object' && s === 'saved' && o.sending) return 'بانتظار الإرسال';
      switch (s) {
        case 'new': return 'مرسلة';
        case 'preparing': return 'قيد التحضير';
        case 'ready': return 'جاهزة';
        case 'done': return 'مكتملة';
        default: return 'لم تُرسل';
      }
    },
    isSent: function (o) { return o.status === 'new' || o.status === 'preparing' || o.status === 'ready'; },
    // يمكن التعديل ما دامت الطلبية لم تبدأ في التحضير
    canEdit: function (o) { return o.status !== 'preparing' && o.status !== 'ready'; },

    // إرسال الطلبية إلى المخزن (تُسجل في الجدول). تُحفظ في صندوق الإرسال إن لم يوجد إنترنت.
    send: async function (rec) {
      if (!rec.id) rec.id = user + ':' + rec.createdAt;
      if (!orders.canEdit(rec)) throw new Error('locked');
      rec.sending = true;
      rec.sendError = null;
      if (rec.status !== 'new') rec.status = 'saved';
      await RM.db.put('orders', rec);
      await RM.sync.enqueue({
        key: 'order:' + rec.id, kind: 'order', number: rec.number, action: 'sendOrder',
        payload: {
          order: {
            id: rec.id, number: rec.number, date: rec.date, time: rec.time, receiver: rec.receiver, note: rec.note,
            items: rec.items.map(function (i) { return { code: i.code, name: i.name, category: i.category, qty: i.qty, note: i.note }; })
          }
        }
      });
      return rec;
    }
  };

  window.addEventListener('pagehide', function () { cart.flush(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') cart.flush();
  });

  RM.cart = cart;
  RM.orders = orders;
})();
