/* pdf.js — الطباعة، وتصدير PDF حقيقي (بلا مكتبات خارجية)، والمشاركة عبر واتساب */
(function () {
  'use strict';
  var RM = (window.RM = window.RM || {});
  var C = window.RM_CONFIG;
  var U = RM.util;

  var FONT = '"Cairo","Segoe UI",Tahoma,"Noto Naskh Arabic",Arial,sans-serif';
  var G = '#064E32', O = '#F59A23', BG = '#F4F7F5', LN = '#dfe8e2', MU = '#5f7468', TX = '#16231c';

  function totalQty(o) {
    return o.items.reduce(function (s, i) { return s + Number(i.qty || 0); }, 0);
  }
  function fileName(o) { return String(o.number).replace(/[^\w\-]+/g, '_') + '.pdf'; }

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = src;
    });
  }

  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('400 30px Cairo'),
      document.fonts.load('700 30px Cairo'),
      document.fonts.load('800 30px Cairo')
    ]).catch(function () { /* نكمل بالخط الاحتياطي */ });
  }

  /* ============================ رسم الصفحات على Canvas ============================ */
  function wrap(ctx, text, maxW) {
    text = String(text == null ? '' : text);
    if (!text) return [''];
    var words = text.split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW) { cur = t; return; }
      if (cur) lines.push(cur);
      if (ctx.measureText(w).width > maxW) {
        var chunk = '';
        for (var i = 0; i < w.length; i++) {
          var tt = chunk + w[i];
          if (ctx.measureText(tt).width > maxW && chunk) { lines.push(chunk); chunk = w[i]; } else chunk = tt;
        }
        cur = chunk;
      } else cur = w;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  async function renderPages(o) {
    var W = 1654, H = 2339, M = 90, FOOT = 120;
    await fontsReady();
    var logo = await loadImage(C.IMAGES.logo);
    var pages = [];
    var cv, ctx, y;

    function font(size, weight) { ctx.font = weight + ' ' + size + 'px ' + FONT; }
    function txt(s, x, yy, size, weight, color, align, dir) {
      font(size, weight);
      ctx.fillStyle = color;
      ctx.textAlign = align || 'right';
      ctx.direction = dir || 'rtl';
      ctx.fillText(String(s), x, yy);
    }
    // نصغّر الخط حتى يدخل النص في العرض
    function fit(s, maxW, size, weight) {
      font(size, weight);
      while (size > 22 && ctx.measureText(String(s)).width > maxW) { size -= 2; font(size, weight); }
      return size;
    }
    function rr(x, yy, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, yy);
      ctx.arcTo(x + w, yy, x + w, yy + h, r);
      ctx.arcTo(x + w, yy + h, x, yy + h, r);
      ctx.arcTo(x, yy + h, x, yy, r);
      ctx.arcTo(x, yy, x + w, yy, r);
      ctx.closePath();
    }

    function drawHeader() {
      ctx.fillStyle = G; ctx.fillRect(0, 0, W, 240);
      ctx.fillStyle = O; ctx.fillRect(0, 240, W, 12);
      var ls = 170, lx = W - M - ls, ly = 35;
      if (logo) {
        ctx.save(); rr(lx, ly, ls, ls, 34); ctx.clip(); ctx.drawImage(logo, lx, ly, ls, ls); ctx.restore();
      } else {
        ctx.fillStyle = '#fff'; rr(lx, ly, ls, ls, 34); ctx.fill();
      }
      txt(C.APP_NAME, lx - 34, 118, 78, 800, '#fff', 'right');
      txt('طلبية شراء', lx - 34, 180, 40, 600, O, 'right');
      // مربع رقم الطلبية
      ctx.fillStyle = '#fff'; rr(M, 50, 500, 140, 26); ctx.fill();
      txt('رقم الطلبية', M + 250, 100, 28, 600, MU, 'center');
      var ns = fit(o.number, 440, 56, 800);
      txt(o.number, M + 250, 166, ns, 800, G, 'center', 'ltr');

      // مربعات المعلومات
      var gap = 30, bw = (W - 2 * M - gap) / 2, bh = 120, top = 292;
      var boxes = [
        ['التاريخ والوقت', (o.date || '') + '   ' + (o.time || '')],
        ['العامل', o.worker || ''],
        ['الجهة المستلمة', o.receiver || '-'],
        ['عدد المنتجات / مجموع الكميات', o.items.length + ' منتج  /  ' + U.fmtQty(totalQty(o))]
      ];
      boxes.forEach(function (b, i) {
        var col = i % 2, row = Math.floor(i / 2);
        var right = W - M - col * (bw + gap);
        var bx = right - bw, by = top + row * (bh + 24);
        ctx.fillStyle = BG; rr(bx, by, bw, bh, 20); ctx.fill();
        ctx.strokeStyle = LN; ctx.lineWidth = 2; rr(bx, by, bw, bh, 20); ctx.stroke();
        txt(b[0], right - 28, by + 44, 26, 600, MU, 'right');
        var s = fit(b[1], bw - 56, 36, 700);
        txt(b[1], right - 28, by + 96, s, 700, TX, 'right');
      });
      return top + 2 * bh + 24 + 50;
    }

    function drawMiniHeader() {
      ctx.fillStyle = G; ctx.fillRect(0, 0, W, 120);
      ctx.fillStyle = O; ctx.fillRect(0, 120, W, 8);
      txt(C.APP_NAME, W - M, 78, 52, 800, '#fff', 'right');
      txt(o.number, M, 78, 46, 800, '#fff', 'left', 'ltr');
      return 170;
    }

    var COLS = [
      { k: 'idx', w: 80, a: 'c', t: '#' },
      { k: 'code', w: 180, a: 'c', t: 'كود الميزان' },
      { k: 'name', w: 520, a: 'r', t: 'اسم المنتج' },
      { k: 'cat', w: 220, a: 'r', t: 'الفئة' },
      { k: 'qty', w: 150, a: 'c', t: 'الكمية' },
      { k: 'note', w: 324, a: 'r', t: 'ملاحظة' }
    ];
    var tableW = W - 2 * M;

    function colRects() {
      var right = W - M, out = [];
      COLS.forEach(function (c) { out.push({ c: c, right: right, left: right - c.w }); right -= c.w; });
      return out;
    }

    function cellText(s, r, yy, size, weight, color, dir) {
      var pad = 14;
      if (r.c.a === 'c') txt(s, (r.left + r.right) / 2, yy, size, weight, color, 'center', dir || 'ltr');
      else txt(s, r.right - pad, yy, size, weight, color, 'right', dir || 'rtl');
    }

    function drawTableHead() {
      ctx.fillStyle = G; rr(M, y, tableW, 76, 16); ctx.fill();
      colRects().forEach(function (r) { cellText(r.c.t, r, y + 49, 28, 700, '#fff', 'rtl'); });
      y += 76;
    }

    function newPage(first) {
      cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.textBaseline = 'alphabetic';
      pages.push(cv);
      y = first ? drawHeader() : drawMiniHeader();
      drawTableHead();
    }

    newPage(true);

    o.items.forEach(function (it, idx) {
      var rects = colRects();
      font(30, 600);
      var nameLines = wrap(ctx, it.name, 520 - 28);
      font(27, 400);
      var catLines = wrap(ctx, it.category || '-', 220 - 28);
      var noteLines = wrap(ctx, it.note || '-', 324 - 28);
      var lines = Math.max(nameLines.length, catLines.length, noteLines.length);
      var rh = Math.max(84, lines * 42 + 34);
      if (y + rh > H - FOOT) newPage(false);

      if (idx % 2 === 1) { ctx.fillStyle = BG; ctx.fillRect(M, y, tableW, rh); }
      ctx.strokeStyle = LN; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(M, y + rh); ctx.lineTo(M + tableW, y + rh); ctx.stroke();

      var base = y + 54;
      cellText(String(idx + 1), rects[0], base, 28, 400, MU);
      cellText(it.code, rects[1], base, 34, 800, G);
      nameLines.forEach(function (l, i) { cellText(l, rects[2], base + i * 42, 30, 600, TX); });
      catLines.forEach(function (l, i) { cellText(l, rects[3], base + i * 42, 27, 400, MU); });
      cellText(U.fmtQty(it.qty), rects[4], base, 36, 800, TX);
      noteLines.forEach(function (l, i) { cellText(l, rects[5], base + i * 42, 27, 400, MU); });
      y += rh;
    });

    // ملخص + ملاحظات + توقيعات
    y += 40;
    var needSummary = 150;
    if (y + needSummary > H - FOOT) newPage(false);
    var bw2 = 360, bh2 = 110;
    [['عدد المنتجات', String(o.items.length)], ['مجموع الكميات', U.fmtQty(totalQty(o))]].forEach(function (b, i) {
      var right = W - M - i * (bw2 + 24);
      ctx.fillStyle = '#e4f3e9'; rr(right - bw2, y, bw2, bh2, 18); ctx.fill();
      txt(b[0], right - 24, y + 42, 26, 600, MU, 'right');
      txt(b[1], right - 24, y + 90, 44, 800, G, 'right', 'ltr');
    });
    y += bh2 + 36;

    if (o.note) {
      font(28, 400);
      var nl = wrap(ctx, o.note, tableW - 56);
      var nh = 70 + nl.length * 42;
      if (y + nh > H - FOOT) newPage(false);
      ctx.fillStyle = BG; rr(M, y, tableW, nh, 18); ctx.fill();
      ctx.strokeStyle = LN; ctx.lineWidth = 2; rr(M, y, tableW, nh, 18); ctx.stroke();
      txt('ملاحظات الطلبية', W - M - 28, y + 46, 28, 700, G, 'right');
      nl.forEach(function (l, i) { txt(l, W - M - 28, y + 96 + i * 42, 28, 400, TX, 'right'); });
      y += nh + 36;
    }

    if (y + 150 > H - FOOT) newPage(false);
    y += 50;
    [['توقيع العامل', 0], ['توقيع المستلم', 1]].forEach(function (b) {
      var right = W - M - b[1] * (tableW / 2 + 10);
      ctx.strokeStyle = MU; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(right, y + 70); ctx.lineTo(right - 520, y + 70); ctx.stroke();
      txt(b[0], right, y + 40, 26, 600, MU, 'right');
    });

    // تذييل كل صفحة
    pages.forEach(function (pc, i) {
      var c = pc.getContext('2d');
      c.strokeStyle = LN; c.lineWidth = 2;
      c.beginPath(); c.moveTo(M, H - 90); c.lineTo(W - M, H - 90); c.stroke();
      ctx = c;
      txt(C.APP_NAME + ' — ' + C.APP_SUBTITLE, W - M, H - 44, 24, 400, MU, 'right');
      txt((i + 1) + ' / ' + pages.length, M, H - 44, 24, 600, MU, 'left', 'ltr');
    });
    return { pages: pages, w: W, h: H };
  }

  /* ============================ كتابة ملف PDF ============================ */
  function canvasToJpeg(cv) {
    var d = cv.toDataURL('image/jpeg', 0.92);
    var b = atob(d.split(',')[1]);
    var u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }

  function buildPdfFile(jpegs, w, h) {
    var enc = new TextEncoder();
    var parts = [], offsets = [], len = 0;
    function push(x) {
      var u = typeof x === 'string' ? enc.encode(x) : x;
      parts.push(u); len += u.length;
    }
    function obj(n, fn) { offsets[n] = len; push(n + ' 0 obj\n'); fn(); push('endobj\n'); }

    var n = jpegs.length, PW = 595.28, PH = 841.89;
    push('%PDF-1.4\n%âãÏÓ\n');
    obj(1, function () { push('<< /Type /Catalog /Pages 2 0 R >>\n'); });
    var kids = [];
    for (var i = 0; i < n; i++) kids.push((3 + 3 * i) + ' 0 R');
    obj(2, function () { push('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\n'); });
    jpegs.forEach(function (jpg, i) {
      var pn = 3 + 3 * i, cn = pn + 1, im = pn + 2;
      obj(pn, function () {
        push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + cn + ' 0 R >>\n');
      });
      var content = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im0 Do Q\n';
      obj(cn, function () { push('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\n'); });
      obj(im, function () {
        push('<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n');
        push(jpg);
        push('\nendstream\n');
      });
    });
    var xref = len, total = 3 * n + 3;
    push('xref\n0 ' + total + '\n');
    push('0000000000 65535 f \n');
    for (var k = 1; k < total; k++) push(String(offsets[k]).padStart(10, '0') + ' 00000 n \n');
    push('trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

    var out = new Uint8Array(len), pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  async function build(o) {
    var r = await renderPages(o);
    var jpegs = r.pages.map(canvasToJpeg);
    r.pages.forEach(function (c) { c.width = 1; c.height = 1; }); // تحرير الذاكرة
    return buildPdfFile(jpegs, r.w, r.h);
  }

  /* ============================ التصدير والمشاركة ============================ */
  async function download(o) {
    var bytes = await build(o);
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fileName(o);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function whatsappText(o) {
    var L = [];
    L.push('*' + C.APP_NAME + '*');
    L.push('طلبية رقم: ' + o.number);
    L.push('التاريخ: ' + o.date + ' ' + (o.time || ''));
    L.push('العامل: ' + (o.worker || ''));
    if (o.receiver) L.push('الجهة المستلمة: ' + o.receiver);
    L.push('');
    o.items.forEach(function (i, n) {
      L.push((n + 1) + ') ' + i.name + ' (' + i.code + ') × ' + U.fmtQty(i.qty) + (i.note ? ' — ' + i.note : ''));
    });
    L.push('');
    L.push('عدد المنتجات: ' + o.items.length + ' | مجموع الكميات: ' + U.fmtQty(totalQty(o)));
    if (o.note) L.push('ملاحظات: ' + o.note);
    return L.join('\n');
  }

  // على الهاتف: نشارك ملف PDF مباشرة. وإلا نفتح واتساب بنص الطلبية كاملاً.
  async function whatsapp(o) {
    var text = whatsappText(o);
    var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (mobile && navigator.share && navigator.canShare) {
      try {
        var bytes = await build(o);
        var file = new File([bytes], fileName(o), { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'طلبية ' + o.number, text: text });
          return 'shared';
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
      }
    }
    var s = await RM.settings.get();
    var num = U.phone(s.whatsapp);
    var url = 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
    var w = window.open(url, '_blank', 'noopener');
    if (!w) window.location.href = url;
    return 'opened';
  }

  /* ============================ الطباعة (HTML) ============================ */
  function printHtml(o) {
    var e = U.esc;
    var rows = o.items.map(function (i, n) {
      return '<tr><td>' + (n + 1) + '</td><td class="c">' + e(i.code) + '</td><td>' + e(i.name) + '</td><td>' +
        e(i.category || '-') + '</td><td class="c">' + e(U.fmtQty(i.qty)) + '</td><td>' + e(i.note || '-') + '</td></tr>';
    }).join('');
    return '<div class="ph"><img src="' + e(C.IMAGES.logo) + '" alt="" onerror="this.style.display=\'none\'">' +
      '<div><b>' + e(C.APP_NAME) + '</b><span>طلبية شراء</span></div><div class="pn">' + e(o.number) + '</div></div>' +
      '<div class="pinfo"><div><span>التاريخ والوقت</span><b>' + e(o.date) + ' ' + e(o.time || '') + '</b></div>' +
      '<div><span>العامل</span><b>' + e(o.worker || '') + '</b></div>' +
      '<div><span>الجهة المستلمة</span><b>' + e(o.receiver || '-') + '</b></div>' +
      '<div><span>عدد المنتجات / مجموع الكميات</span><b>' + o.items.length + ' / ' + e(U.fmtQty(totalQty(o))) + '</b></div></div>' +
      '<table><thead><tr><th>#</th><th>كود الميزان</th><th>اسم المنتج</th><th>الفئة</th><th>الكمية</th><th>ملاحظة</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (o.note ? '<div class="pnote"><b>ملاحظات الطلبية</b><p>' + e(o.note) + '</p></div>' : '') +
      '<div class="psign"><div>توقيع العامل</div><div>توقيع المستلم</div></div>';
  }

  function print(o) {
    var area = document.getElementById('printArea');
    area.innerHTML = printHtml(o);
    var imgs = area.getElementsByTagName('img');
    var wait = imgs.length && !imgs[0].complete
      ? new Promise(function (r) { imgs[0].onload = imgs[0].onerror = r; setTimeout(r, 800); })
      : Promise.resolve();
    return wait.then(function () {
      return new Promise(function (r) { setTimeout(function () { window.print(); r(); }, 100); });
    });
  }

  RM.pdf = { build: build, download: download, whatsapp: whatsapp, whatsappText: whatsappText, print: print, fileName: fileName };
})();
