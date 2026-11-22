/* app.js — واجهة التطبيق: الدخول، التنقل، المنتجات، السلة، الطلبيات، السجل، المزامنة، الإعدادات */
(function () {
  'use strict';
  var RM = window.RM;
  var C = window.RM_CONFIG;
  var U = RM.util;
  var E = U.esc;

  function $(id) { return document.getElementById(id); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function ico(name, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '"><use href="#i-' + name + '"/></svg>'; }

  /* ---------------------------- حالة التطبيق ---------------------------- */
  var S = {
    sess: null,
    products: [],
    byCode: {},
    query: '',
    cat: '',
    sort: 'name',
    limit: 60,
    route: 'home',
    hPage: 1,
    online: navigator.onLine !== false,
    lastSync: 0
  };
  var PAGE = 60;
  var HPAGE = 10;

  /* ---------------------------- أدوات الواجهة ---------------------------- */
  var toastTimer = null;
  function toast(msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isErr ? 4200 : 2200);
  }

  var modalClose = null;
  function openModal(title, html, onOpen) {
    $('mTitle').textContent = title;
    $('mBody').innerHTML = html;
    $('modal').hidden = false;
    if (onOpen) onOpen($('mBody'));
  }
  function closeModal() {
    if ($('modal').hidden) return;
    $('modal').hidden = true;
    $('mBody').innerHTML = '';
    if (modalClose) { var f = modalClose; modalClose = null; f(false); }
  }
  function confirmBox(title, msg, okLabel, danger) {
    return new Promise(function (resolve) {
      var done = false;
      modalClose = function () { if (!done) { done = true; resolve(false); } };
      openModal(title, '<p style="margin-bottom:16px;font-weight:600">' + E(msg) + '</p>' +
        '<div class="modal-actions"><button class="btn ' + (danger ? 'btn-danger-soft' : 'btn-green') + '" data-ok>' + E(okLabel || 'تأكيد') + '</button>' +
        '<button class="btn btn-outline" data-cancel>إلغاء</button></div>', function (body) {
        body.querySelector('[data-ok]').onclick = function () { done = true; modalClose = null; $('modal').hidden = true; $('mBody').innerHTML = ''; resolve(true); };
        body.querySelector('[data-cancel]').onclick = function () { closeModal(); };
      });
    });
  }

  function errText(code) {
    switch (code) {
      case 'invalid': return 'اسم المستخدم أو كلمة المرور غير صحيحة.';
      case 'locked': return 'محاولات كثيرة خاطئة. أعد المحاولة بعد 15 دقيقة.';
      case 'offline': return 'لا يوجد اتصال بالإنترنت.';
      case 'not_configured': return 'لم يتم ضبط رابط Apps Script في ملف config.js.';
      case 'sheet': return 'تعذّرت قراءة جدول المنتجات. تأكد من إعدادات Google Sheets.';
      case 'unauthorized': return 'انتهت الجلسة. سجّل الدخول من جديد.';
      case 'bad_request': return 'طلب غير صالح.';
      default: return 'تعذّر الاتصال بالخادم. حاول مرة أخرى.';
    }
  }

  function fmtQty(n) { return U.fmtQty(n); }
  function pill(o) { return '<span class="pill ' + (o.sending ? 'sending' : o.status) + '">' + RM.orders.statusLabel(o.status, o) + '</span>'; }

  /* ---------------------------- الصور (روابط فقط، تُستبدل لاحقاً) ---------------------------- */
  function bindImages() {
    qa('img[data-img]').forEach(function (img) {
      var key = img.getAttribute('data-img');
      var src = C.IMAGES && C.IMAGES[key];
      var holder = img.closest('.logo-box') || img.closest('.hero');
      if (!src) { if (holder) holder.classList.add('missing'); return; }
      img.onerror = function () { if (holder) holder.classList.add('missing'); img.removeAttribute('src'); };
      img.onload = function () { if (holder) holder.classList.remove('missing'); };
      img.src = src;
    });
    var bg = C.IMAGES && C.IMAGES.loginBackground;
    if (bg) {
      var t = new Image();
      t.onload = function () {
        var l = $('loginScreen');
        l.style.setProperty('--login-bg', 'url("' + bg + '")');
        l.classList.add('has-bg');
      };
      t.src = bg;
    }
  }

  /* ---------------------------- المنتجات ---------------------------- */
  async function loadProducts() {
    var list = await RM.db.all('products');
    S.products = list;
    S.byCode = {};
    list.forEach(function (p) { S.byCode[p.code] = p; });
    var last = await RM.db.getMeta('lastSync');
    S.lastSync = Number(last) || 0;
  }

  function matches(p, q) {
    if (!q) return true;
    var hay = U.norm(p.name + ' ' + p.code + ' ' + p.category + ' ' + p.note);
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }

  function filtered(q, cat, sort) {
    var nq = U.norm(q || '');
    var list = S.products.filter(function (p) {
      return (!cat || p.category === cat) && matches(p, nq);
    });
    list.sort(function (a, b) {
      if (nq) {
        var ea = a.code === q.trim() ? 0 : 1, eb = b.code === q.trim() ? 0 : 1;
        if (ea !== eb) return ea - eb;
        var sa = U.norm(a.name).indexOf(nq) === 0 ? 0 : 1, sb = U.norm(b.name).indexOf(nq) === 0 ? 0 : 1;
        if (sa !== sb) return sa - sb;
      }
      if (sort === 'code') return a.code.localeCompare(b.code, 'en', { numeric: true });
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });
    return list;
  }

  function categories() {
    var map = {};
    S.products.forEach(function (p) { if (p.category) map[p.category] = (map[p.category] || 0) + 1; });
    return Object.keys(map).sort(function (a, b) { return a.localeCompare(b, 'ar'); });
  }

  function renderChips() {
    var cats = categories();
    if (S.cat && cats.indexOf(S.cat) === -1) S.cat = '';
    var h = '<button class="chip' + (!S.cat ? ' active' : '') + '" data-cat="">الكل</button>';
    cats.forEach(function (c) {
      h += '<button class="chip' + (S.cat === c ? ' active' : '') + '" data-cat="' + E(c) + '">' + E(c) + '</button>';
    });
    $('chips').innerHTML = h;
    $('chips').hidden = cats.length === 0;
  }

  function cardHtml(p) {
    return '<article class="pcard" data-code="' + E(p.code) + '">' +
      '<div class="pinfo">' +
        '<div class="pname" dir="auto">' + E(p.name) + '</div>' +
        '<div class="pmeta">' + (p.category ? '<span class="pcat">' + E(p.category) + '</span>' : '<span class="pcat none">بدون فئة</span>') + '</div>' +
        '<div class="prow"><span class="plabel">كود الميزان:</span><span class="pcode">' + E(p.code) + '</span></div>' +
        '<div class="prow pnote"><span class="plabel">ملاحظة:</span><span>' + (p.note ? E(p.note) : '—') + '</span></div>' +
      '</div>' +
      '<div class="pactions">' +
        '<div class="stepper"><button type="button" data-st="-" aria-label="إنقاص">' + ico('minus') + '</button>' +
        '<input class="qin" value="1" inputmode="decimal" aria-label="الكمية"><button type="button" data-st="+" aria-label="زيادة">' + ico('plus') + '</button></div>' +
        '<button type="button" class="add" data-add>' + ico('plus', 'sm') + '<span>إضافة للطلبية</span></button>' +
      '</div></article>';
  }

  function renderProducts() {
    var list = filtered(S.query, S.cat, S.sort);
    var total = S.products.length;
    $('pCount').textContent = '(' + list.length + (list.length !== total ? ' / ' + total : '') + ')';
    var shown = list.slice(0, S.limit);
    $('products').innerHTML = shown.map(cardHtml).join('');
    $('pmore').hidden = list.length <= S.limit;
    var empty = $('pempty');
    if (!total) {
      empty.hidden = false;
      empty.textContent = 'لا توجد منتجات محفوظة بعد. افتح «مزامنة البيانات» وتأكد من الاتصال بالإنترنت.';
    } else if (!list.length) {
      empty.hidden = false;
      empty.textContent = 'لا توجد نتائج مطابقة للبحث.';
    } else {
      empty.hidden = true;
    }
    $('sortLabel').textContent = S.sort === 'name' ? 'حسب الاسم' : 'حسب الكود';
    markInCart();
  }

  function markInCart() {
    qa('#products .pcard').forEach(function (card) {
      var it = RM.cart.find(card.getAttribute('data-code'));
      var b = card.querySelector('.add');
      if (!b) return;
      b.classList.toggle('in-cart', !!it);
      b.querySelector('span').textContent = it ? 'في الطلبية (' + fmtQty(it.qty) + ')' : 'إضافة للطلبية';
    });
  }

  function addProduct(code, qty, card) {
    var p = S.byCode[code];
    if (!p) return;
    RM.cart.add(p, qty);
    if (card) { card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
    var fab = $('fab');
    fab.classList.remove('bump'); void fab.offsetWidth; fab.classList.add('bump');
    toast('أُضيف: ' + p.name);
  }

  function stepValue(input, dir) {
    var v = U.parseQty(input.value, 1);
    v = dir > 0 ? v + 1 : Math.max(0.5, v - 1);
    input.value = fmtQty(v);
  }

  function onProductsClick(e) {
    var card = e.target.closest('.pcard');
    if (!card) return;
    var code = card.getAttribute('data-code');
    var st = e.target.closest('[data-st]');
    if (st) { stepValue(card.querySelector('.qin'), st.getAttribute('data-st') === '+' ? 1 : -1); return; }
    if (e.target.closest('[data-add]')) {
      var inp = card.querySelector('.qin');
      addProduct(code, U.parseQty(inp.value, 1), card);
      inp.value = '1';
    }
  }

  /* ---------------------------- السلة ---------------------------- */
  function stepperHtml(code, qty) {
    return '<div class="stepper"><button type="button" data-cst="-" data-code="' + E(code) + '" aria-label="إنقاص">' + ico('minus') + '</button>' +
      '<input class="qin" data-code="' + E(code) + '" value="' + E(fmtQty(qty)) + '" inputmode="decimal" aria-label="الكمية">' +
      '<button type="button" data-cst="+" data-code="' + E(code) + '" aria-label="زيادة">' + ico('plus') + '</button></div>';
  }

  function cartHtml() {
    var st = RM.cart.state;
    var h = '<div class="cart-head">' + ico('cart') + '<span>الطلبية الحالية</span></div><div class="cart-body">';
    if (!st.items.length) {
      h += '<div class="cart-empty">الطلبية فارغة.<br>أضف منتجات من القائمة.</div>';
    } else {
      h += '<div class="cart-list">';
      st.items.forEach(function (i) {
        h += '<div class="crow"><div class="cinfo"><div class="cname" dir="auto">' + E(i.name) + '</div>' +
          '<div class="ccode">كود: <b>' + E(i.code) + '</b></div></div>' + stepperHtml(i.code, i.qty) +
          '<button type="button" class="icon-btn" data-crm="' + E(i.code) + '" aria-label="حذف">' + ico('trash') + '</button>' +
          '<input class="crow-note note-in" data-ncode="' + E(i.code) + '" value="' + E(i.note) + '" placeholder="ملاحظة لهذا المنتج (اختياري)" aria-label="ملاحظة المنتج"></div>';
      });
      h += '</div>';
    }
    h += '<div class="cart-sum"><div><span>عدد المنتجات</span><b data-sum="count">' + RM.cart.count() + '</b></div>' +
      '<div><span>إجمالي الكمية</span><b data-sum="qty">' + fmtQty(RM.cart.totalQty()) + '</b></div></div>' +
      '<textarea class="cart-note" placeholder="ملاحظات الطلبية (اختياري)">' + E(st.note) + '</textarea>' +
      '<div class="cart-actions">' +
      '<button type="button" class="btn btn-orange wide" data-cgo>' + ico('cart') + 'متابعة وإرسال الطلبية</button>' +
      '<button type="button" class="btn btn-green" data-csave>' + ico('check') + 'حفظ وإرسال</button>' +
      '<button type="button" class="btn btn-danger-soft" data-cclear>' + ico('trash') + 'تفريغ</button>' +
      '</div></div>';
    return h;
  }

  function renderCartAreas() {
    $('cartPanel').innerHTML = cartHtml();
    if (!$('drawer').hidden) $('drawerBody').innerHTML = cartHtml();
    updateFab();
  }

  function updateFab() {
    var n = RM.cart.count();
    $('fabBadge').textContent = n;
    $('fabBadge').hidden = n === 0;
  }

  function updateTotals() {
    var c = RM.cart.count(), q = fmtQty(RM.cart.totalQty());
    qa('[data-sum="count"]').forEach(function (el) { el.textContent = c; });
    qa('[data-sum="qty"]').forEach(function (el) { el.textContent = q; });
    $('oTotalCount').textContent = c;
    $('oTotalQty').textContent = q;
    updateFab();
  }

  function cartClick(e) {
    var t = e.target;
    var st = t.closest('[data-cst]');
    if (st) {
      var it = RM.cart.find(st.getAttribute('data-code'));
      if (it) {
        var nq = st.getAttribute('data-cst') === '+' ? it.qty + 1 : Math.max(0.5, it.qty - 1);
        RM.cart.setQty(it.code, nq);
      }
      return;
    }
    var rm = t.closest('[data-crm]');
    if (rm) { RM.cart.remove(rm.getAttribute('data-crm')); return; }
    if (t.closest('[data-cgo]')) { closeDrawer(); if (!RM.cart.count()) { toast('أضف منتجاً واحداً على الأقل.', true); return; } location.hash = '#/new'; return; }
    if (t.closest('[data-csave]')) { saveOrder({ finalize: true, send: true }); return; }
    if (t.closest('[data-cclear]')) {
      if (!RM.cart.count()) return;
      confirmBox('تفريغ الطلبية', 'هل تريد حذف كل المنتجات من الطلبية الحالية؟', 'نعم، تفريغ', true).then(function (ok) {
        if (ok) RM.cart.clear();
      });
    }
  }
  function cartInput(e) {
    var t = e.target;
    if (t.classList.contains('qin') && t.getAttribute('data-code')) {
      var v = parseFloat(String(t.value).replace(',', '.'));
      if (isFinite(v) && v > 0) { RM.cart.setQty(t.getAttribute('data-code'), v, true); updateTotals(); }
    } else if (t.getAttribute('data-ncode')) {
      RM.cart.setItemNote(t.getAttribute('data-ncode'), t.value);
    } else if (t.classList.contains('cart-note')) {
      RM.cart.setField('note', t.value);
      $('oNote').value = t.value;
    }
  }
  function cartChange(e) {
    var t = e.target;
    if (t.classList.contains('qin') && t.getAttribute('data-code')) {
      var code = t.getAttribute('data-code');
      var it = RM.cart.find(code);
      // تعديل صامت: لا نعيد رسم السلة حتى لا يضيع التركيز على الحقل التالي
      RM.cart.setQty(code, U.parseQty(t.value, it ? it.qty : 1), true);
      var cur = RM.cart.find(code);
      if (cur) t.value = fmtQty(cur.qty);
      updateTotals(); markInCart();
    }
  }

  /* ---------------------------- الدرج (الهاتف) ---------------------------- */
  function openDrawer() {
    $('drawerBody').innerHTML = cartHtml();
    $('drawer').hidden = false;
    $('drawerScrim').hidden = false;
  }
  function closeDrawer() {
    $('drawer').hidden = true;
    $('drawerScrim').hidden = true;
  }

  /* ---------------------------- صفحة الطلبية ---------------------------- */
  function rowHtml(i, n) {
    return '<tr data-code="' + E(i.code) + '">' +
      '<td data-l="idx">' + (n + 1) + '</td>' +
      '<td data-l="code" class="code">' + E(i.code) + '</td>' +
      '<td data-l="name" class="l" dir="auto">' + E(i.name) + '</td>' +
      '<td data-l="cat">' + E(i.category || '—') + '</td>' +
      '<td data-l="note"><input class="note-in" data-code="' + E(i.code) + '" value="' + E(i.note) + '" placeholder="ملاحظة" aria-label="ملاحظة"></td>' +
      '<td data-l="qty">' + stepperHtml(i.code, i.qty) + '</td>' +
      '<td data-l="del"><button type="button" class="icon-btn" data-crm="' + E(i.code) + '" aria-label="حذف">' + ico('trash') + '</button></td></tr>';
  }

  function renderOrderTable() {
    var items = RM.cart.state.items;
    $('oBody').innerHTML = items.map(rowHtml).join('');
    $('oEmpty').hidden = items.length > 0;
    qa('.otable').forEach(function (t) { t.hidden = items.length === 0; });
    updateTotals();
  }

  async function renderOrderFields() {
    var st = RM.cart.state;
    $('oNumber').value = st.number || await RM.orders.peekNumber();
    $('oDate').value = st.date || U.todayISO();
    $('oWorker').value = S.sess ? (S.sess.name || S.sess.username) : '';
    $('oReceiver').value = st.receiver || '';
    $('oNote').value = st.note || '';
  }

  async function renderOrderView() {
    await renderOrderFields();
    renderOrderTable();
    renderRecent();
  }

  async function renderRecent() {
    var list = (await RM.orders.list()).slice(0, 5);
    var box = $('recentBody');
    if (!list.length) { box.innerHTML = '<div class="empty">لا توجد طلبيات محفوظة بعد.</div>'; return; }
    box.innerHTML = '<table class="ltable"><thead><tr><th>الرقم</th><th>التاريخ</th><th>الحالة</th></tr></thead><tbody>' +
      list.map(function (o) {
        return '<tr class="click" data-open="' + E(o.number) + '"><td class="num">' + E(o.number) + '</td><td>' + E(o.date) + '</td>' +
          '<td>' + pill(o) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p style="margin-top:14px;text-align:center"><a class="link" href="#/history">عرض كل الطلبيات</a></p>';
  }

  function syncFieldsToCart() {
    RM.cart.setField('date', $('oDate').value || U.todayISO());
    RM.cart.setField('receiver', $('oReceiver').value.trim());
    RM.cart.setField('note', $('oNote').value);
  }

  var busy = false;
  async function saveOrder(opts) {
    if (busy) return null;
    if (!RM.cart.count()) { toast('الطلبية فارغة. أضف منتجاً أولاً.', true); return null; }
    busy = true;
    try {
      if (S.route === 'new') syncFieldsToCart();
      var rec = await RM.orders.saveCurrent(opts || {});
      if (opts && opts.send) {
        try {
          await RM.orders.send(rec);
          toast(navigator.onLine === false ? 'حُفظت الطلبية ' + rec.number + ' وستُرسل عند عودة الإنترنت' : 'جاري إرسال الطلبية ' + rec.number + '…');
        } catch (e) {
          toast(e && e.message === 'locked' ? 'بدأ المخزن تحضير هذه الطلبية فلا يمكن تعديلها.' : 'تعذّر الإرسال.', true);
        }
      } else if (opts && opts.finalize) toast('تم حفظ الطلبية ' + rec.number);
      if (S.route === 'new') { await renderOrderView(); }
      return rec;
    } catch (e) {
      toast('تعذّر حفظ الطلبية.', true);
      return null;
    } finally { busy = false; }
  }

  async function orderAction(act, order) {
    try {
      if (act === 'print') { await RM.pdf.print(order); }
      else if (act === 'pdf') { toast('جاري إنشاء ملف PDF…'); await RM.pdf.download(order); toast('تم إنشاء ملف PDF'); }
      else if (act === 'wa') { await RM.pdf.whatsapp(order); }
    } catch (e) { toast('تعذّرت العملية: ' + (e && e.message ? e.message : ''), true); }
  }

  async function onOrderActions(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'save') { await saveOrder({ finalize: true, send: true }); return; }
    var rec = await saveOrder({ finalize: false });
    if (rec) {
      b.disabled = true;
      await orderAction(act, rec);
      b.disabled = false;
    }
  }

  /* ---------------------------- بحث إضافة منتج داخل الطلبية ---------------------------- */
  var oSel = -1;
  function showResults() {
    var q = $('oq').value.trim();
    var box = $('oResults');
    if (!q) { box.hidden = true; return; }
    var list = filtered(q, '', 'name').slice(0, 8);
    oSel = list.length ? 0 : -1;
    if (!list.length) box.innerHTML = '<div class="none">لا توجد نتائج</div>';
    else box.innerHTML = list.map(function (p, i) {
      return '<button type="button" data-pick="' + E(p.code) + '" class="' + (i === 0 ? 'on' : '') + '"><span class="rc">' + E(p.code) + '</span>' +
        '<span class="rn" dir="auto">' + E(p.name) + '</span><span class="rk">' + E(p.category) + '</span></button>';
    }).join('');
    box.hidden = false;
  }
  function pickFromResults(code) {
    addProduct(code, 1);
    $('oq').value = '';
    $('oResults').hidden = true;
  }

  function openPicker() {
    openModal('إضافة منتج', '<div class="searchbar" style="margin-bottom:12px"><input id="pkQ" type="search" placeholder="ابحث بالاسم أو الكود..." autocomplete="off">' + ico('search', 'sic') + '</div>' +
      '<div id="pkList" class="results" style="position:static;max-height:50vh;box-shadow:none"></div>', function (body) {
      var inp = body.querySelector('#pkQ'), list = body.querySelector('#pkList');
      function draw() {
        var l = filtered(inp.value, '', 'name').slice(0, 60);
        list.innerHTML = l.length ? l.map(function (p) {
          var it = RM.cart.find(p.code);
          return '<button type="button" data-pk="' + E(p.code) + '"><span class="rc">' + E(p.code) + '</span><span class="rn" dir="auto">' + E(p.name) +
            '</span><span class="rk">' + (it ? '✓ ' + fmtQty(it.qty) : E(p.category)) + '</span></button>';
        }).join('') : '<div class="none">لا توجد نتائج</div>';
      }
      inp.oninput = draw;
      list.onclick = function (e) {
        var b = e.target.closest('[data-pk]');
        if (!b) return;
        addProduct(b.getAttribute('data-pk'), 1);
        draw();
      };
      draw();
      setTimeout(function () { inp.focus(); }, 50);
    });
  }

  /* ---------------------------- سجل الطلبيات ---------------------------- */
  async function renderHistory() {
    var all = await RM.orders.list();
    var q = U.norm($('hq').value), st = $('hStatus').value;
    var list = all.filter(function (o) {
      return (!st || (st === 'unsent' ? !RM.orders.isSent(o) : o.status === st)) && (!q || U.norm(o.number + ' ' + o.date).indexOf(q) !== -1);
    });
    var pages = Math.max(1, Math.ceil(list.length / HPAGE));
    if (S.hPage > pages) S.hPage = pages;
    var from = (S.hPage - 1) * HPAGE;
    var slice = list.slice(from, from + HPAGE);
    var box = $('histBody');
    if (!list.length) {
      box.innerHTML = '<div class="empty">' + (all.length ? 'لا توجد طلبيات مطابقة.' : 'لا توجد طلبيات محفوظة بعد.') + '</div>';
      return;
    }
    var h = '<table class="ltable"><thead><tr><th>رقم الطلبية</th><th class="opt">العامل</th><th>التاريخ</th><th class="opt">عدد المنتجات</th><th class="opt">إجمالي الكمية</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>';
    slice.forEach(function (o) {
      h += '<tr class="click" data-open="' + E(o.number) + '"><td class="num">' + E(o.number) + '</td><td class="opt">' + E(o.worker) + '</td><td>' + E(o.date) + '</td>' +
        '<td class="opt">' + o.items.length + '</td><td class="opt">' + fmtQty(RM.orders.totalQty(o)) + '</td>' +
        '<td>' + pill(o) + '</td>' +
        '<td><span class="row-actions"><button class="icon-btn" data-open="' + E(o.number) + '" aria-label="فتح">' + ico('eyeopen') + '</button>' +
        '<button class="icon-btn" data-hprint="' + E(o.number) + '" aria-label="طباعة">' + ico('printer') + '</button></span></td></tr>';
    });
    h += '</tbody></table><div class="pager"><span class="info">' + list.length + ' طلبية — صفحة ' + S.hPage + ' من ' + pages + '</span><div class="pgs">';
    h += '<button class="pg" data-hp="' + (S.hPage + 1) + '"' + (S.hPage >= pages ? ' disabled' : '') + ' aria-label="التالي">' + ico('right', 'sm') + '</button>';
    var a = Math.max(1, S.hPage - 2), b = Math.min(pages, a + 4);
    a = Math.max(1, b - 4);
    for (var p = a; p <= b; p++) h += '<button class="pg' + (p === S.hPage ? ' active' : '') + '" data-hp="' + p + '">' + p + '</button>';
    h += '<button class="pg" data-hp="' + (S.hPage - 1) + '"' + (S.hPage <= 1 ? ' disabled' : '') + ' aria-label="السابق">' + ico('left', 'sm') + '</button></div></div>';
    box.innerHTML = h;
  }

  async function openOrder(number) {
    var o = await RM.orders.get(number);
    if (!o) return;
    var h = '<div class="dl">' +
      '<div><span>رقم الطلبية</span><b>' + E(o.number) + '</b></div>' +
      '<div><span>الحالة</span><b>' + pill(o) + '</b></div>' +
      '<div><span>العامل</span><b>' + E(o.worker) + '</b></div>' +
      '<div><span>التاريخ والوقت</span><b>' + E(o.date) + ' ' + E(o.time || '') + '</b></div>' +
      '<div><span>الجهة المستلمة</span><b>' + E(o.receiver || '—') + '</b></div>' +
      '<div><span>المنتجات / الكمية</span><b>' + o.items.length + ' / ' + fmtQty(RM.orders.totalQty(o)) + '</b></div></div>' +
      '<div class="tablewrap" style="overflow-x:auto"><table class="ltable"><thead><tr><th>الكود</th><th>المنتج</th><th>الكمية</th><th>ملاحظة</th></tr></thead><tbody>' +
      o.items.map(function (i) {
        return '<tr><td class="num">' + E(i.code) + '</td><td style="text-align:right" dir="auto">' + E(i.name) + '</td><td><b>' + fmtQty(i.qty) + '</b></td><td>' + E(i.note || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (o.note ? '<div class="notebox" style="margin-top:12px"><label>' + ico('pencil', 'sm') + 'ملاحظات الطلبية</label><div>' + E(o.note) + '</div></div>' : '') +
      '<div class="modal-actions">' +
      '<button class="btn btn-dg" data-m="print">' + ico('printer') + 'طباعة</button>' +
      '<button class="btn btn-orange" data-m="pdf">' + ico('pdf') + 'PDF</button>' +
      '<button class="btn btn-outline" data-m="wa">' + ico('wa') + 'WhatsApp</button>' +
      (!RM.orders.isSent(o) ? '<button class="btn btn-green" data-m="send">' + ico('check') + 'إرسال إلى المخزن</button>' : '') +
      (RM.orders.canEdit(o) ? '<button class="btn btn-soft" data-m="edit">' + ico('pencil') + (RM.orders.isSent(o) ? 'تعديل وإعادة إرسال' : 'تعديل') + '</button>' : '') +
      '<button class="btn btn-soft" data-m="reuse">' + ico('copy') + 'طلبية جديدة بنفس المنتجات</button>' +
      '<button class="btn btn-danger-soft" data-m="del">' + ico('trash') + 'حذف</button></div>';
    openModal('طلبية ' + o.number, h, function (body) {
      body.onclick = async function (e) {
        var b = e.target.closest('[data-m]');
        if (!b) return;
        var m = b.getAttribute('data-m');
        if (m === 'print' || m === 'pdf' || m === 'wa') { await orderAction(m, o); return; }
        if (m === 'send') {
          try { await RM.orders.send(await RM.orders.get(o.number)); toast('جاري إرسال الطلبية…'); } catch (er) { toast('تعذّر الإرسال.', true); }
          closeModal(); refreshOrderViews(); return;
        }
        if (m === 'del') {
          closeModal();
          var ok = await confirmBox('حذف الطلبية', 'سيتم حذف الطلبية ' + o.number + ' من هذا الجهاز نهائياً.', 'حذف', true);
          if (ok) {
            await RM.orders.remove(o.number);
            if (RM.cart.state.number === o.number) RM.cart.setField('number', null);
            refreshOrderViews(); toast('تم حذف الطلبية');
          }
          return;
        }
        if (m === 'edit' || m === 'reuse') {
          closeModal();
          if (RM.cart.count()) {
            var go = await confirmBox('استبدال الطلبية الحالية', 'الطلبية الحالية تحتوي على منتجات وسيتم استبدالها. متابعة؟', 'متابعة');
            if (!go) return;
          }
          await RM.cart.loadFromOrder(o);
          if (m === 'edit') {
            RM.cart.setField('number', o.number);
            RM.cart.setField('date', o.date);
            RM.cart.setField('receiver', o.receiver);
            RM.cart.setField('note', o.note);
          }
          location.hash = '#/new';
          if (S.route === 'new') renderOrderView();
        }
      };
    });
  }

  function refreshOrderViews() {
    if (S.route === 'history') renderHistory();
    if (S.route === 'new') { renderRecent(); }
  }

  /* ---------------------------- مهام اليوم ---------------------------- */
  function renderTasks() {
    var list = RM.tasks.get();
    var c = RM.tasks.counts();
    $('tkTitle').textContent = c.done + ' / ' + c.total + ' مكتملة';
    $('tkSub').textContent = ' — ' + U.fmtDateLong(new Date());
    $('tkBar').style.width = (c.total ? Math.round(c.done * 100 / c.total) : 0) + '%';
    $('tkAllDone').hidden = !(c.total && c.pending === 0);
    if (!list.length) {
      $('tkList').innerHTML = '<div class="empty">لا توجد مهام لك اليوم.<br>يضيفها المسؤول في ورقة «المهمات» بالجدول.</div>';
      return;
    }
    $('tkList').innerHTML = list.map(function (t) {
      return '<div class="task ' + t.status + '">' +
        '<div class="tk-main"><div class="tk-text" dir="auto">' + E(t.text) + '</div>' +
        (t.note ? '<div class="tk-note">' + E(t.note) + '</div>' : '') + '</div>' +
        '<div class="tk-btns">' +
        '<button type="button" class="tbtn doing' + (t.status === 'doing' ? ' on' : '') + '" data-id="' + E(t.id) + '" data-st="doing">' + ico('clock', 'sm') + 'قيد التنفيذ</button>' +
        '<button type="button" class="tbtn ok' + (t.status === 'done' ? ' on' : '') + '" data-id="' + E(t.id) + '" data-st="done">' + ico('check', 'sm') + 'تمّت</button>' +
        '</div></div>';
    }).join('');
  }

  function updateTaskUI() {
    var c = RM.tasks.counts();
    var left = c.total ? c.pending : 0;
    ['navTaskBadge', 'menuBadge'].forEach(function (id) {
      $(id).hidden = left === 0;
      $(id).textContent = left;
    });
    var strip = $('taskStrip');
    strip.hidden = left === 0;
    if (left) $('taskStripText').textContent = 'مهامك اليوم: ' + c.done + ' من ' + c.total + ' مكتملة — بقي ' + left;
    if (S.route === 'tasks') renderTasks();
  }

  /* ---------------------------- المزامنة ---------------------------- */
  function renderConn() {
    var on = S.online;
    $('stText').textContent = on ? 'متصل بالإنترنت' : 'غير متصل (وضع بدون إنترنت)';
    $('stIcon').innerHTML = '<use href="#i-' + (on ? 'wifi' : 'wifioff') + '"/>';
    $('sbStatus').classList.toggle('offline', !on);
    $('mDot').classList.toggle('off', !on);
    $('stSync').textContent = S.lastSync ? U.fmtDateTime(S.lastSync) : 'لم تتم بعد';
    $('syConn').textContent = on ? 'متصل' : 'غير متصل';
    $('syLast').textContent = S.lastSync ? U.fmtDateTime(S.lastSync) : 'لم تتم بعد';
    $('syCount').textContent = S.products.length;
  }

  async function renderSync() {
    renderConn();
    var log = (await RM.db.getMeta('syncLog')) || [];
    $('syLog').innerHTML = log.length ? log.map(function (l) {
      return '<div class="li ' + (l.ok ? 'ok' : 'err') + '">' + ico(l.ok ? 'ok' : 'x') +
        '<b>' + (l.ok ? 'نجحت — ' + l.count + ' منتج' : 'فشلت — ' + E(errText(l.error))) + '</b>' +
        '<span>' + E(U.fmtDateTime(l.at)) + '</span></div>';
    }).join('') : '<div class="empty">لا توجد عمليات مزامنة مسجلة.</div>';
  }

  function setSyncing(on) {
    $('mDot').classList.toggle('busy', on);
    $('mSync').classList.toggle('spinning', on);
    $('syIcon').classList.toggle('spin', on);
    $('syncNow').disabled = on;
    $('syBtnText').textContent = on ? 'جاري المزامنة…' : 'مزامنة الآن';
  }

  async function onSyncEvent(e) {
    var d = e.detail || {};
    if (d.phase === 'start') { setSyncing(true); return; }
    setSyncing(false);
    if (d.phase === 'done') {
      await loadProducts();
      await RM.tasks.reload();
      renderChips(); renderProducts(); renderConn();
      refreshCartNames();
      $('syMsg').className = 'sy-msg ok';
      $('syMsg').textContent = 'تمت المزامنة: ' + d.count + ' منتج.';
      if (d.manual) toast('تمت المزامنة: ' + d.count + ' منتج');
      if (S.route === 'sync') renderSync();
    } else if (d.phase === 'error') {
      if (d.error === 'unauthorized') { logout(errText('unauthorized')); return; }
      $('syMsg').className = 'sy-msg err';
      $('syMsg').textContent = errText(d.error);
      if (d.manual) toast(errText(d.error), true);
      if (S.route === 'sync') renderSync();
    }
  }

  // تحديث أسماء/فئات المنتجات في السلة إن تغيّرت في الجدول
  function refreshCartNames() {
    var changed = false;
    RM.cart.state.items.forEach(function (i) {
      var p = S.byCode[i.code];
      if (p && (p.name !== i.name || p.category !== i.category)) { i.name = p.name; i.category = p.category; changed = true; }
    });
    if (changed) { RM.cart.persist(); document.dispatchEvent(new CustomEvent('rm:cart')); }
  }

  /* ---------------------------- الإعدادات ---------------------------- */
  async function renderSettings() {
    var s = await RM.settings.get();
    $('stUser').textContent = S.sess ? (S.sess.name + ' (' + S.sess.username + ')') : '—';
    $('stVer').textContent = C.VERSION;
    $('sReceiver').value = s.receiver;
    $('sWhatsapp').value = s.whatsapp;
    $('sTheme').value = getTheme();
  }

  /* ---------------------------- الوضع الداكن ---------------------------- */
  function getTheme() { try { return localStorage.getItem('rm_theme') || 'auto'; } catch (e) { return 'auto'; } }
  function applyTheme(t) {
    var dark = t === 'dark' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', dark ? '#0b1a13' : '#064E32');
  }

  /* ---------------------------- المخزن: صندوق الطلبيات ---------------------------- */
  var WH = { list: [], filter: '', days: 7, q: '', timer: null, seen: null, offline: false };
  var WH_ST = ['new', 'preparing', 'ready'];

  function isWH() { return !!(S.sess && S.sess.role === 'warehouse'); }

  async function whLoad(silent) {
    var r = await RM.sync.call('allOrders', { days: WH.days });
    if (r && r.ok) {
      WH.offline = false;
      WH.list = r.orders;
      try { await RM.db.setMeta('wh:orders:' + WH.days, r.orders); } catch (e) { /* لا شيء */ }
      var fresh = WH.list.filter(function (o) { return o.status === 'new'; }).map(function (o) { return o.id; });
      if (WH.seen && !silent) { /* لا شيء */ }
      if (WH.seen) {
        var added = fresh.filter(function (id) { return WH.seen.indexOf(id) === -1; });
        if (added.length) {
          toast('وصلت ' + added.length + ' طلبية جديدة');
          try { if (navigator.vibrate) navigator.vibrate(200); } catch (e) { /* لا شيء */ }
        }
      }
      WH.seen = fresh;
      updateWhBadge();
    } else {
      WH.offline = true;
      var c = await RM.db.getMeta('wh:orders:' + WH.days);
      if (Array.isArray(c) && !WH.list.length) WH.list = c;
      if (!silent) toast(r && r.error === 'forbidden' ? 'هذا الحساب ليس حساب المخزن.' : 'تعذّر الاتصال بالخادم. تُعرض آخر نسخة محفوظة.', true);
    }
    if (S.route === 'inbox') renderInbox();
  }

  function updateWhBadge() {
    var n = WH.list.filter(function (o) { return o.status === 'new'; }).length;
    ['navInboxBadge', 'menuBadge'].forEach(function (id) {
      var el = $(id); if (!el) return;
      if (id === 'menuBadge' && !isWH()) return;
      el.hidden = n === 0; el.textContent = n;
    });
  }

  function whStart() {
    whStop();
    WH.seen = null;
    whLoad(true);
    WH.timer = setInterval(function () { if (document.visibilityState !== 'hidden' && S.online) whLoad(true); }, 30000);
  }
  function whStop() { if (WH.timer) { clearInterval(WH.timer); WH.timer = null; } }

  function renderInbox() {
    var all = WH.list;
    var cnt = { '': all.length, new: 0, preparing: 0, ready: 0 };
    all.forEach(function (o) { if (cnt[o.status] !== undefined) cnt[o.status]++; });
    $('whTabs').innerHTML = [['', 'الكل'], ['new', 'جديدة'], ['preparing', 'قيد التحضير'], ['ready', 'جاهزة']].map(function (t) {
      return '<button type="button" class="chip' + (WH.filter === t[0] ? ' active' : '') + '" data-f="' + t[0] + '">' + t[1] + ' <b>' + cnt[t[0]] + '</b></button>';
    }).join('');
    $('whDays').value = String(WH.days);
    var q = U.norm(WH.q);
    var list = all.filter(function (o) {
      return (!WH.filter || o.status === WH.filter) &&
        (!q || U.norm(o.number + ' ' + o.worker + ' ' + o.date).indexOf(q) !== -1);
    });
    $('whOff').hidden = !WH.offline;
    var box = $('whBody');
    if (!list.length) { box.innerHTML = '<div class="empty">لا توجد طلبيات' + (all.length ? ' مطابقة.' : ' في هذه المدة.') + '</div>'; return; }
    var qtyOf = function (o) { return o.items.reduce(function (s, i) { return s + Number(i.qty || 0); }, 0); };
    box.innerHTML = list.map(function (o) {
      return '<div class="wh-card st-' + o.status + '" data-id="' + E(o.id) + '">' +
        '<div class="wh-top"><b class="num">' + E(o.number) + '</b><span class="pill ' + o.status + '">' + RM.orders.statusLabel(o.status) + '</span></div>' +
        '<div class="wh-meta"><span>' + ico('user', 'sm') + E(o.worker) + '</span><span>' + ico('cal', 'sm') + E(o.date) + ' ' + E(o.time || '') + '</span>' +
        '<span>' + o.items.length + ' منتج · ' + fmtQty(qtyOf(o)) + '</span></div>' +
        (o.note ? '<div class="wh-note">' + ico('pencil', 'sm') + E(o.note) + '</div>' : '') +
        '<div class="wh-acts">' + whButtons(o) + '</div></div>';
    }).join('');
  }

  function whButtons(o) {
    var b = '';
    if (o.status === 'new') b += '<button class="btn btn-orange" data-ws="preparing" data-id="' + E(o.id) + '">بدء التحضير</button>';
    if (o.status === 'preparing') b += '<button class="btn btn-green" data-ws="ready" data-id="' + E(o.id) + '">' + ico('check') + 'جاهزة</button>';
    if (o.status === 'ready') b += '<button class="btn btn-soft" data-ws="preparing" data-id="' + E(o.id) + '">إرجاع للتحضير</button>';
    if (o.status !== 'new') b += '<button class="btn btn-danger-soft" data-ws="new" data-id="' + E(o.id) + '">إرجاع لمرسلة</button>';
    b += '<button class="btn btn-outline" data-wopen="' + E(o.id) + '">' + ico('eyeopen') + 'المحتوى</button>';
    return b;
  }

  async function whSetStatus(id, st) {
    var o = WH.list.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    var r = await RM.sync.call('setStatus', { id: id, status: st });
    if (r && r.ok) { o.status = st; toast('تم تغيير الحالة: ' + RM.orders.statusLabel(st)); whLoad(true); renderInbox(); updateWhBadge(); }
    else toast(r && r.error === 'not_found' ? 'الطلبية غير موجودة في الجدول.' : 'تعذّر تغيير الحالة (تحقق من الإنترنت).', true);
  }

  function whOpen(id) {
    var o = WH.list.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    var h = '<div class="dl"><div><span>الطلبية</span><b>' + E(o.number) + '</b></div>' +
      '<div><span>الحالة</span><b>' + pill(o) + '</b></div>' +
      '<div><span>العامل</span><b>' + E(o.worker) + '</b></div>' +
      '<div><span>التاريخ والوقت</span><b>' + E(o.date) + ' ' + E(o.time || '') + '</b></div>' +
      '<div><span>الجهة المستلمة</span><b>' + E(o.receiver || '—') + '</b></div>' +
      '<div><span>آخر تحديث</span><b>' + E(o.statusAt || '—') + (o.statusBy ? ' · ' + E(o.statusBy) : '') + '</b></div></div>' +
      '<div class="tablewrap" style="overflow-x:auto"><table class="ltable"><thead><tr><th>الكود</th><th>المنتج</th><th>الكمية</th><th>ملاحظة</th></tr></thead><tbody>' +
      o.items.map(function (i) {
        return '<tr><td class="num">' + E(i.code) + '</td><td style="text-align:right" dir="auto">' + E(i.name) + '</td><td><b>' + fmtQty(i.qty) + '</b></td><td>' + E(i.note || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (o.note ? '<div class="notebox" style="margin-top:12px"><label>ملاحظات الطلبية</label><div>' + E(o.note) + '</div></div>' : '') +
      '<div class="modal-actions">' + whButtons(o) + '</div>';
    openModal('طلبية ' + o.number, h, function (body) {
      body.onclick = async function (e) {
        var b = e.target.closest('[data-ws]');
        if (!b) return;
        closeModal();
        await whSetStatus(b.getAttribute('data-id'), b.getAttribute('data-ws'));
      };
    });
  }

  /* ---------------------------- الإحصائيات (لكل المستخدمين) ---------------------------- */
  var ST = { days: 30, by: 'qty', data: null, offline: false };

  async function loadStats() {
    $('stBody').innerHTML = '<div class="empty">جاري التحميل…</div>';
    var r = await RM.sync.call('stats', { days: ST.days });
    var key = 'stats:' + ST.days;
    if (r && r.ok) { ST.data = r; ST.offline = false; try { await RM.db.setMeta(key, r); } catch (e) { /* لا شيء */ } }
    else {
      var c = await RM.db.getMeta(key);
      ST.data = c && c.ok ? c : null; ST.offline = true;
    }
    renderStats();
  }

  function barRows(rows, valKey, fmt, cls) {
    var max = rows.reduce(function (m, r) { return Math.max(m, r[valKey]); }, 0) || 1;
    return '<div class="hbars">' + rows.map(function (r) {
      return '<div class="hb"><div class="hb-l" dir="auto">' + E(r.name) + '</div>' +
        '<div class="hb-t"><i class="' + (cls || '') + '" style="width:' + Math.max(3, Math.round(r[valKey] * 100 / max)) + '%"></i></div>' +
        '<b class="hb-v">' + fmt(r[valKey]) + '</b></div>';
    }).join('') + '</div>';
  }

  function renderStats() {
    var d = ST.data, box = $('stBody');
    qa('#stDays [data-d]').forEach(function (b) { b.classList.toggle('active', Number(b.getAttribute('data-d')) === ST.days); });
    qa('#stBy [data-by]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-by') === ST.by); });
    if (!d) { box.innerHTML = '<div class="empty">' + (RM.sync.configured() ? 'تعذّر تحميل الإحصائيات. تحقق من الإنترنت.' : 'اربط التطبيق بالجدول أولاً.') + '</div>'; return; }
    var h = ST.offline ? '<div class="offline-note">لا يوجد اتصال — تُعرض آخر نسخة محفوظة.</div>' : '';
    h += '<div class="stat-tiles"><div><span>الطلبيات</span><b>' + d.totals.orders + '</b></div>' +
      '<div><span>إجمالي الكمية</span><b>' + fmtQty(d.totals.qty) + '</b></div>' +
      '<div><span>منتجات مختلفة</span><b>' + d.totals.products + '</b></div></div>';
    if (!d.totals.orders) { box.innerHTML = h + '<div class="empty">لا توجد طلبيات مرسلة في هذه المدة بعد.</div>'; return; }
    var by = ST.by;
    var top = d.products.slice().sort(function (a, b) { return b[by] - a[by] || b.qty - a.qty; }).slice(0, 10)
      .map(function (p) { return { name: p.name, v: p[by] }; });
    h += '<div class="stat-card"><h3>أكثر المنتجات طلباً (' + (by === 'qty' ? 'حسب الكمية' : 'حسب عدد مرات الطلب') + ')</h3>' +
      barRows(top, 'v', function (n) { return by === 'qty' ? fmtQty(n) : n + '×'; }) + '</div>';
    // الطلبيات حسب اليوم
    var days = d.byDay.slice(-14);
    var mx = days.reduce(function (m, x) { return Math.max(m, x.orders); }, 0) || 1;
    h += '<div class="stat-card"><h3>عدد الطلبيات في اليوم</h3><div class="cols">' + days.map(function (x) {
      return '<div class="col"><b>' + x.orders + '</b><i style="height:' + Math.max(4, Math.round(x.orders * 100 / mx)) + 'px"></i><span>' + E(x.date.slice(5)) + '</span></div>';
    }).join('') + '</div></div>';
    // الفئات
    if (d.categories.length) {
      h += '<div class="stat-card"><h3>الكمية حسب الفئة</h3>' + barRows(d.categories.slice(0, 8), 'qty', fmtQty, 'alt') + '</div>';
    }
    // منتجات لم تُطلب
    var seen = {};
    d.products.forEach(function (p) { seen[p.code] = 1; });
    var never = S.products.filter(function (p) { return !seen[p.code]; });
    if (never.length && d.products.length < 200) {
      h += '<div class="stat-card"><h3>منتجات لم تُطلب في هذه المدة (' + never.length + ')</h3><div class="never">' +
        never.slice(0, 40).map(function (p) { return '<span dir="auto">' + E(p.name) + '</span>'; }).join('') +
        (never.length > 40 ? '<span class="more">+' + (never.length - 40) + '</span>' : '') + '</div></div>';
    }
    box.innerHTML = h;
  }

  /* جلب حالات الطلبيات من الجدول مع تنبيه عند تغيّرها */
  var pulling = false;
  async function pullOrders() {
    if (pulling || !S.sess || isWH() || !S.online) return;
    pulling = true;
    try {
      var before = {};
      (await RM.orders.list()).forEach(function (o) { before[o.number] = o.status; });
      var r = await RM.sync.pullMyOrders();
      if (r && r.ok) {
        (await RM.orders.list()).forEach(function (o) {
          if (before[o.number] && before[o.number] !== o.status && RM.orders.isSent(o)) toast('الطلبية ' + o.number + ': ' + RM.orders.statusLabel(o.status));
        });
      }
    } finally { pulling = false; }
  }

  /* ---------------------------- التنقل ---------------------------- */
  var ROUTES = ['home', 'products', 'new', 'history', 'tasks', 'stats', 'inbox', 'sync', 'settings'];
  var WH_ROUTES = ['inbox', 'stats', 'tasks', 'sync', 'settings'];
  function currentRoute() {
    var r = (location.hash || '').replace(/^#\/?/, '');
    if (isWH()) return WH_ROUTES.indexOf(r) !== -1 ? r : 'inbox';
    return ROUTES.indexOf(r) !== -1 && r !== 'inbox' ? r : 'home';
  }

  function showRoute() {
    if (!S.sess) return;
    var r = currentRoute();
    S.route = r;
    var viewId = (r === 'home' || r === 'products') ? 'products' : r;
    qa('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + viewId); });
    qa('#nav a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-route') === r); });
    $('hero').hidden = r !== 'home';
    $('fab').hidden = viewId !== 'products';
    closeMenu(); closeDrawer(); $('userDrop').hidden = true;
    window.scrollTo(0, 0);
    if (r === 'new') renderOrderView();
    else if (r === 'history') { S.hPage = 1; renderHistory(); pullOrders(); }
    else if (r === 'tasks') renderTasks();
    else if (r === 'stats') loadStats();
    else if (r === 'inbox') { renderInbox(); whLoad(true); }
    else if (r === 'sync') renderSync();
    else if (r === 'settings') renderSettings();
    else { renderConn(); }
  }

  function openMenu() { $('app').classList.add('menu-open'); $('scrim').hidden = false; }
  function closeMenu() { $('app').classList.remove('menu-open'); $('scrim').hidden = true; }

  /* ---------------------------- الدخول والخروج ---------------------------- */
  function showLogin(msg) {
    $('app').hidden = true;
    $('loginScreen').hidden = false;
    $('lgPass').value = '';
    $('lgError').textContent = msg || '';
    setLoginBusy(false);
    document.title = C.APP_NAME + ' | تسجيل الدخول';
  }

  function setLoginBusy(on) {
    $('lgBtn').disabled = on;
    $('lgBtnText').textContent = on ? 'جاري التحقق…' : 'تسجيل الدخول';
  }

  async function onLogin(e) {
    e.preventDefault();
    var u = $('lgUser').value.trim(), p = $('lgPass').value;
    if (!u || !p) { $('lgError').textContent = 'أدخل اسم المستخدم وكلمة المرور.'; return; }
    $('lgError').textContent = '';
    setLoginBusy(true);
    var r;
    try { r = await RM.sync.login(u, p, $('lgRemember').checked); }
    catch (err) { r = { ok: false, error: 'network' }; }
    if (!r || !r.ok) {
      setLoginBusy(false);
      $('lgError').textContent = errText(r && r.error) + (r && r.error === 'offline' ? ' تسجيل الدخول الأول يحتاج إنترنت.' : '');
      return;
    }
    await startApp(RM.auth.get());
  }

  async function logout(msg) {
    try { await RM.cart.flush(); } catch (e) { /* لا شيء */ }
    RM.sync.stop();
    RM.tasks.stop();
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    whStop(); WH.list = []; WH.seen = null;
    RM.auth.clear();
    S.sess = null;
    $('app').classList.remove('role-wh');
    closeDrawer(); closeMenu(); closeModal();
    showLogin(msg || '');
  }

  var pollTimer = null;
  function startOrderPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () { if (document.visibilityState !== 'hidden' && S.sess) pullOrders(); }, 30000);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') pullOrders(); });

  async function startApp(sess) {
    S.sess = sess;
    $('app').classList.toggle('role-wh', sess.role === 'warehouse');
    await RM.cart.init(sess);
    await RM.tasks.init(sess);
    await loadProducts();
    $('loginScreen').hidden = true;
    $('app').hidden = false;
    document.title = C.APP_NAME + ' | ' + C.APP_SUBTITLE;
    $('userName').textContent = sess.name || sess.username;
    $('tbDate').textContent = U.fmtDateLong(new Date());
    S.query = ''; S.cat = ''; $('q').value = '';
    S.limit = PAGE;
    renderChips(); renderProducts(); renderCartAreas(); renderConn();
    if (!location.hash || (isWH() && currentRoute() !== (location.hash || '').replace(/^#\/?/, ''))) location.hash = isWH() ? '#/inbox' : '#/home';
    showRoute();
    updateTaskUI();
    var left = RM.tasks.counts();
    if (left.total && left.pending) toast('عندك ' + left.pending + ' مهام غير مكتملة اليوم');
    if (isWH()) { whStart(); } else { whStop(); startOrderPoll(); }
    RM.sync.start();
    if (RM.sync.configured() && S.online) RM.sync.syncProducts({});
  }

  /* ---------------------------- ربط الأحداث ---------------------------- */
  function bind() {
    // الدخول
    $('loginForm').addEventListener('submit', onLogin);
    $('lgEye').addEventListener('click', function () {
      var p = $('lgPass'), show = p.type === 'password';
      p.type = show ? 'text' : 'password';
      $('lgEye').innerHTML = ico(show ? 'eyeoff' : 'eye');
    });
    $('lgForgot').addEventListener('click', function () {
      openModal('نسيت كلمة المرور؟', '<p style="font-weight:600;line-height:1.9">كلمات المرور يحددها المسؤول فقط. تواصل مع المسؤول ليعطيك كلمة مرور جديدة.</p>' +
        '<div class="modal-actions"><button class="btn btn-green" data-cancel>حسناً</button></div>', function (b) {
        b.querySelector('[data-cancel]').onclick = closeModal;
      });
    });

    // القائمة والرأس
    $('menuBtn').addEventListener('click', openMenu);
    $('scrim').addEventListener('click', closeMenu);
    $('userBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      var d = $('userDrop');
      d.hidden = !d.hidden;
      $('userBtn').setAttribute('aria-expanded', String(!d.hidden));
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.tb-user')) $('userDrop').hidden = true; });
    qa('[data-go]').forEach(function (b) { b.addEventListener('click', function () { location.hash = '#/' + b.getAttribute('data-go'); }); });
    $('logoutBtn').addEventListener('click', function () { logout(); });
    $('sLogout').addEventListener('click', function () { logout(); });
    window.addEventListener('hashchange', showRoute);

    // النافذة
    $('mClose').addEventListener('click', closeModal);
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeModal(); closeDrawer(); closeMenu(); $('oResults').hidden = true; }
    });

    // المنتجات
    $('q').addEventListener('input', function () { S.query = this.value; S.limit = PAGE; renderProducts(); });
    $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } });
    $('qBtn').addEventListener('click', function () { S.query = $('q').value; S.limit = PAGE; renderProducts(); });
    $('chips').addEventListener('click', function (e) {
      var c = e.target.closest('[data-cat]');
      if (!c) return;
      S.cat = c.getAttribute('data-cat'); S.limit = PAGE;
      renderChips(); renderProducts();
    });
    $('sortBtn').addEventListener('click', function () { S.sort = S.sort === 'name' ? 'code' : 'name'; renderProducts(); });
    $('moreBtn').addEventListener('click', function () { S.limit += PAGE; renderProducts(); });
    $('products').addEventListener('click', onProductsClick);
    $('products').addEventListener('input', function (e) {
      if (e.target.classList.contains('qin')) { /* قيمة الكمية تُقرأ عند الإضافة */ }
    });

    // السلة (اللوحة + الدرج)
    [$('cartPanel'), $('drawerBody')].forEach(function (el) {
      el.addEventListener('click', cartClick);
      el.addEventListener('input', cartInput);
      el.addEventListener('change', cartChange);
    });
    $('fab').addEventListener('click', openDrawer);
    $('drawerScrim').addEventListener('click', closeDrawer);
    $('grip').addEventListener('click', closeDrawer);
    document.addEventListener('rm:cart', function () {
      renderCartAreas(); markInCart();
      if (S.route === 'new') renderOrderTable();
      updateTotals();
    });

    // صفحة الطلبية
    $('oBody').addEventListener('click', cartClick);
    $('oBody').addEventListener('input', function (e) {
      var t = e.target;
      if (t.classList.contains('note-in')) RM.cart.setItemNote(t.getAttribute('data-code'), t.value);
      else cartInput(e);
    });
    $('oBody').addEventListener('change', cartChange);
    $('oDate').addEventListener('change', function () { RM.cart.setField('date', this.value || U.todayISO()); });
    $('oReceiver').addEventListener('input', function () { RM.cart.setField('receiver', this.value.trim()); });
    $('oNote').addEventListener('input', function () {
      RM.cart.setField('note', this.value);
      qa('.cart-note').forEach(function (t) { t.value = $('oNote').value; });
    });
    $('oAddBtn').addEventListener('click', openPicker);
    $('oq').addEventListener('input', showResults);
    $('oqBtn').addEventListener('click', function () { $('oq').focus(); showResults(); });
    $('oq').addEventListener('keydown', function (e) {
      var items = qa('#oResults [data-pick]');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        oSel = (oSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach(function (b, i) { b.classList.toggle('on', i === oSel); });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items.length) pickFromResults(items[Math.max(0, oSel)].getAttribute('data-pick'));
      }
    });
    $('oResults').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]');
      if (b) pickFromResults(b.getAttribute('data-pick'));
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.osearch')) $('oResults').hidden = true; });
    qa('.actions4').forEach(function (a) { a.addEventListener('click', onOrderActions); });
    $('recentBody').addEventListener('click', function (e) {
      var o = e.target.closest('[data-open]');
      if (o) openOrder(o.getAttribute('data-open'));
    });

    // السجل
    $('hq').addEventListener('input', function () { S.hPage = 1; renderHistory(); });
    $('hStatus').addEventListener('change', function () { S.hPage = 1; renderHistory(); });
    $('histBody').addEventListener('click', async function (e) {
      var hp = e.target.closest('[data-hp]');
      if (hp) { if (!hp.disabled) { S.hPage = Number(hp.getAttribute('data-hp')); renderHistory(); } return; }
      var pr = e.target.closest('[data-hprint]');
      if (pr) {
        var o = await RM.orders.get(pr.getAttribute('data-hprint'));
        if (o) orderAction('print', o);
        return;
      }
      var op = e.target.closest('[data-open]');
      if (op) openOrder(op.getAttribute('data-open'));
    });

    // المهام
    $('tkList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-st]');
      if (!b) return;
      var id = b.getAttribute('data-id'), st = b.getAttribute('data-st');
      var cur = RM.tasks.get().filter(function (t) { return t.id === id; })[0];
      RM.tasks.set(id, cur && cur.status === st ? 'todo' : st);
    });
    document.addEventListener('rm:tasks', updateTaskUI);
    document.addEventListener('rm:orders', function () { refreshOrderViews(); });

    // المزامنة
    $('syncNow').addEventListener('click', function () { RM.sync.syncProducts({ manual: true }); });
    $('mSync').addEventListener('click', function () { RM.sync.syncProducts({ manual: true }); });
    document.addEventListener('rm:sync', onSyncEvent);
    window.addEventListener('online', function () { S.online = true; renderConn(); });
    window.addEventListener('offline', function () { S.online = false; renderConn(); });

    // المخزن
    $('whTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-f]'); if (b) { WH.filter = b.getAttribute('data-f'); renderInbox(); } });
    $('whDays').addEventListener('change', function () { WH.days = Number(this.value) || 7; whLoad(false); });
    $('whQ').addEventListener('input', function () { WH.q = this.value; renderInbox(); });
    $('whRefresh').addEventListener('click', function () { whLoad(false); });
    $('whBody').addEventListener('click', function (e) {
      var s = e.target.closest('[data-ws]'), o = e.target.closest('[data-wopen]');
      if (s) whSetStatus(s.getAttribute('data-id'), s.getAttribute('data-ws'));
      else if (o) whOpen(o.getAttribute('data-wopen'));
      else { var c = e.target.closest('.wh-card'); if (c) whOpen(c.getAttribute('data-id')); }
    });
    // الإحصائيات
    $('stDays').addEventListener('click', function (e) { var b = e.target.closest('[data-d]'); if (b) { ST.days = Number(b.getAttribute('data-d')); loadStats(); } });
    $('stBy').addEventListener('click', function (e) { var b = e.target.closest('[data-by]'); if (b) { ST.by = b.getAttribute('data-by'); renderStats(); } });

    $('sTheme').addEventListener('change', function () {
      try { localStorage.setItem('rm_theme', this.value); } catch (e) { /* لا شيء */ }
      applyTheme(this.value);
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onMq = function () { if (getTheme() === 'auto') applyTheme('auto'); };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
    }
    // الإعدادات
    $('sSave').addEventListener('click', async function () {
      var rec = $('sReceiver').value.trim() || C.DEFAULT_RECEIVER;
      await RM.settings.set({ receiver: rec, whatsapp: $('sWhatsapp').value.trim() });
      if (!RM.cart.count()) RM.cart.setField('receiver', rec);
      toast('تم حفظ الإعدادات');
    });
    $('sClearOrders').addEventListener('click', async function () {
      var ok = await confirmBox('حذف سجل الطلبيات', 'سيتم حذف كل طلبياتك المحفوظة على هذا الجهاز نهائياً. متابعة؟', 'حذف', true);
      if (!ok) return;
      var list = await RM.orders.list();
      for (var i = 0; i < list.length; i++) await RM.orders.remove(list[i].number);
      RM.cart.setField('number', null);
      toast('تم حذف سجل الطلبيات');
    });

    // تثبيت التطبيق
    var deferred = null;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); deferred = e; $('installBtn').hidden = false;
    });
    $('installBtn').addEventListener('click', async function () {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (e) { /* لا شيء */ }
      deferred = null; $('installBtn').hidden = true;
    });
    window.addEventListener('appinstalled', function () { $('installBtn').hidden = true; });
  }

  /* ---------------------------- الإقلاع ---------------------------- */
  async function boot() {
    applyTheme(getTheme());
    bindImages();
    bind();
    $('stVer').textContent = C.VERSION;
    try { await RM.db.open(); } catch (e) { /* ذاكرة مؤقتة كبديل */ }
    var sess = RM.auth.get();
    if (sess && sess.username) {
      try { await startApp(sess); } catch (e) { showLogin('تعذّر فتح التطبيق: ' + (e && e.message ? e.message : '')); }
    } else {
      showLogin('');
    }
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('service-worker.js').catch(function () { /* لا شيء */ });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
