/* tasks.js — مهمات العامل اليومية (تأتي من ورقة «المهمات» وتتصفّر كل يوم بعد الساعة 1 صباحاً) */
(function () {
  'use strict';
  var RM = (window.RM = window.RM || {});
  var U = RM.util;

  var RESET_HOUR = 1; // بداية اليوم الجديد: الساعة 1 صباحاً
  var user = '';
  var list = [];
  var state = { day: '', states: {} };
  var timer = null;

  function dayKey() {
    var d = new Date(Date.now() - RESET_HOUR * 3600000);
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1, 2) + '-' + U.pad(d.getDate(), 2);
  }

  function emit() { document.dispatchEvent(new CustomEvent('rm:tasks')); }
  function persist() { return user ? RM.db.setMeta('taskstate:' + user, state) : Promise.resolve(); }

  // يعيد true إن بدأ يوم جديد (فتُمسح الحالات)
  function rollover() {
    var k = dayKey();
    if (state.day === k) return false;
    state = { day: k, states: {} };
    persist();
    return true;
  }

  var tasks = {
    RESET_HOUR: RESET_HOUR,
    dayKey: dayKey,

    init: function (sess) {
      user = sess.username;
      return Promise.all([RM.db.getMeta('tasks:' + user), RM.db.getMeta('taskstate:' + user)]).then(function (r) {
        list = Array.isArray(r[0]) ? r[0] : [];
        state = r[1] && typeof r[1] === 'object' && r[1].states ? r[1] : { day: '', states: {} };
        rollover();
        clearInterval(timer);
        timer = setInterval(function () { if (rollover()) emit(); }, 60000);
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible' && user && rollover()) emit();
        });
      });
    },

    stop: function () { clearInterval(timer); user = ''; list = []; state = { day: '', states: {} }; },

    // بعد المزامنة: نعيد قراءة قائمة المهمات
    reload: function () {
      if (!user) return Promise.resolve();
      return RM.db.getMeta('tasks:' + user).then(function (l) { list = Array.isArray(l) ? l : []; emit(); });
    },

    get: function () {
      rollover();
      return list.map(function (t) {
        return { id: t.id, text: t.text, note: t.note, status: state.states[t.id] || 'todo' };
      });
    },

    // status: 'todo' | 'doing' | 'done'
    set: function (id, status) {
      rollover();
      if (status === 'todo') delete state.states[id];
      else state.states[id] = status;
      persist();
      emit();
      // تسجيل في الجدول: من بدأ ومتى كمّل
      var item = list.filter(function (x) { return x.id === id; })[0];
      if (RM.sync && RM.sync.enqueue) {
        RM.sync.enqueue({
          key: 'task:' + state.day + '|' + id, kind: 'task', action: 'taskStatus',
          payload: { day: state.day, taskId: id, text: item ? item.text : '', status: status, at: Date.now() }
        });
      }
    },

    counts: function () {
      var l = tasks.get(), done = 0, doing = 0;
      l.forEach(function (t) { if (t.status === 'done') done++; else if (t.status === 'doing') doing++; });
      return { total: l.length, done: done, doing: doing, pending: l.length - done };
    }
  };

  RM.tasks = tasks;
})();
