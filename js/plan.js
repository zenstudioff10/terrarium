/* plan.js — the Plan tab: routines that repeat, plans for today only.

   A block is a commitment, never an entry. Nothing here writes to the log
   unless you press "log it" on a block that has already finished, so the
   record can never fill up with work you did not actually do. */
(function (TM) {
  'use strict';

  var T = TM.time;
  var S = TM.store;

  var DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var TAG_NAME = { productive: 'Productive', wasted: 'Wasted', sleep: 'Nap' };

  var el = {};
  var onChange = function () {};
  var pickedDays = [0, 1, 2, 3, 4, 5, 6];   // only consulted under "Pick"
  var repeat = 'today';                      // today | daily | weekdays | pick
  var planTag = 'productive';

  var REPEAT_DAYS = {
    daily: [0, 1, 2, 3, 4, 5, 6],
    weekdays: [1, 2, 3, 4, 5]
  };

  function init(changed) {
    onChange = changed || onChange;

    el.summary = document.getElementById('planSummary');
    el.planList = document.getElementById('planList');
    el.planForm = document.getElementById('planForm');
    el.planStart = document.getElementById('planStart');
    el.planEnd = document.getElementById('planEnd');
    el.planLabel = document.getElementById('planLabel');
    el.routineDays = document.getElementById('routineDays');
    el.repeatOpts = document.querySelectorAll('#repeatOpts button');

    buildDayChips();
    bindTagpick(document.getElementById('planTag'), function (t) { planTag = t; });

    // The seven chips are what made the routine form twice the height of the
    // other one, so they stay out of the way until you actually pick days.
    for (var r = 0; r < el.repeatOpts.length; r++) {
      el.repeatOpts[r].addEventListener('click', function () {
        repeat = this.dataset.repeat;
        for (var j = 0; j < el.repeatOpts.length; j++) {
          el.repeatOpts[j].setAttribute('aria-checked',
            el.repeatOpts[j] === this ? 'true' : 'false');
        }
        if (repeat === 'pick') el.routineDays.removeAttribute('hidden');
        else el.routineDays.setAttribute('hidden', '');
      });
    }

    /* One form, two destinations. "Today" is a block on this day only and goes
       to the day; anything that repeats is a routine and lives at the root. */
    el.planForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var b = readForm(el.planStart, el.planEnd, el.planLabel);
      if (!b) return;

      if (repeat === 'today') {
        S.addPlan(S.todayKey(), { label: b.label, start: b.start, end: b.end, tag: planTag });
      } else {
        var days = repeat === 'pick' ? pickedDays : REPEAT_DAYS[repeat];
        if (!days || !days.length) { flash(el.routineDays); return; }
        S.addRoutine({ label: b.label, start: b.start, end: b.end, tag: planTag, days: days.slice() });
      }

      clearForm(el.planStart, el.planEnd, el.planLabel);
      onChange();
    });
  }

  /** Both times must parse and the block must actually have length. */
  function readForm(startEl, endEl, labelEl) {
    var start = T.parseClock(startEl.value);
    var end = T.parseClock(endEl.value);
    if (start == null) { flash(startEl); startEl.focus(); return null; }
    if (end == null) { flash(endEl); endEl.focus(); return null; }
    if (end <= start) { flash(endEl); endEl.focus(); return null; }
    return { start: start, end: end, label: labelEl.value.trim() };
  }

  function clearForm(startEl, endEl, labelEl) {
    startEl.value = '';
    endEl.value = '';
    labelEl.value = '';
  }

  function flash(node) {
    node.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' },
       { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
      { duration: 240, easing: 'ease-in-out' }
    );
  }

  function bindTagpick(host, set) {
    var buttons = host.querySelectorAll('.tag');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        for (var j = 0; j < buttons.length; j++) {
          buttons[j].setAttribute('aria-checked', buttons[j] === this ? 'true' : 'false');
        }
        set(this.dataset.tag);
      });
    }
  }

  function buildDayChips() {
    for (var d = 0; d < 7; d++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'daychip';
      b.dataset.day = d;
      b.textContent = DAY_INITIALS[d];
      b.setAttribute('aria-pressed', 'true');
      b.setAttribute('aria-label', DAY_NAMES[d]);
      b.addEventListener('click', function () {
        var day = +this.dataset.day;
        var at = pickedDays.indexOf(day);
        if (at === -1) pickedDays.push(day); else pickedDays.splice(at, 1);
        this.setAttribute('aria-pressed', at === -1 ? 'true' : 'false');
      });
      el.routineDays.appendChild(b);
    }
  }

  /* ── rendering ──────────────────────────────────────── */

  function render(key, day, e, nowMin) {
    renderSummary(e);
    renderBlocks(key, day, nowMin);
  }

  function renderSummary(e) {
    if (!e.committedTotal) {
      el.summary.textContent = 'Nothing booked today. Every hour left is yours.';
      return;
    }
    el.summary.textContent = T.hm(e.committedTotal) + ' booked today · ' +
      (e.committedAhead > 0 ? T.hm(e.committedAhead) + ' still ahead' : 'all of it behind you');
  }

  /* Both kinds in one list, in the order the day will meet them. A routine is
     told apart by carrying its days rather than by living under its own
     heading — two lists, two forms and two tag pickers were three copies of the
     same idea, and the panel was mostly form. */
  function renderBlocks(key, day, nowMin) {
    var list = el.planList;
    while (list.firstChild) list.removeChild(list.firstChild);

    var todayWeekday = T.weekdayOf(S.todayKey());
    var rows = [];

    var routines = S.routines();
    for (var i = 0; i < routines.length; i++) {
      var r = routines[i];
      var appliesToday = (r.days || []).indexOf(todayWeekday) !== -1;
      rows.push({
        block: r,
        opts: {
          nowMin: nowMin,
          dim: !appliesToday,
          days: r.days,
          onLog: appliesToday ? logBlock(r) : null,
          onRemove: function (id) { return function () { S.removeRoutine(id); onChange(); }; }(r.id)
        }
      });
    }

    var plans = (day && day.plans) || [];
    for (var j = 0; j < plans.length; j++) {
      var p = plans[j];
      rows.push({
        block: p,
        opts: {
          nowMin: nowMin,
          onLog: logBlock(p),
          onRemove: function (id) { return function () { S.removePlan(key, id); onChange(); }; }(p.id)
        }
      });
    }

    rows.sort(function (a, b) { return a.block.start - b.block.start; });
    for (var k = 0; k < rows.length; k++) list.appendChild(blockRow(rows[k].block, rows[k].opts));
  }

  /** "log it" runs the same path the quick-add chips use, so the undo toast
      and the entry list behave exactly as they do everywhere else. */
  function logBlock(block) {
    return function () {
      TM.log.addAs(block.tag || 'productive', block.end - block.start, block.label);
    };
  }

  function blockRow(block, opts) {
    var li = document.createElement('li');
    li.className = 'planrow';
    li.dataset.tag = block.tag || 'productive';

    var past = TM.schedule.isPast(block, opts.nowMin);
    var now = TM.schedule.isNow(block, opts.nowMin);
    if (past) li.classList.add('is-past');
    if (now) li.classList.add('is-now');
    if (opts.dim) li.classList.add('is-otherday');

    var when = document.createElement('span');
    when.className = 'planrow__when';
    when.textContent = T.clock(block.start) + '–' + T.clock(block.end % 1440);

    var label = document.createElement('span');
    label.className = 'planrow__label';
    var sw = document.createElement('i');
    sw.className = 'swatch';
    label.appendChild(sw);
    label.appendChild(document.createTextNode(block.label || TAG_NAME[block.tag || 'productive']));
    label.title = (block.label || TAG_NAME[block.tag || 'productive']) +
      ' · ' + T.hm(block.end - block.start);

    li.appendChild(when);
    li.appendChild(label);

    if (opts.days) {
      var days = document.createElement('span');
      days.className = 'planrow__days';
      days.textContent = daysLabel(opts.days);
      days.title = 'Repeats ' + daysTitle(opts.days);
      li.appendChild(days);
    }

    var act = document.createElement('span');
    act.className = 'planrow__act';
    if (past && opts.onLog) {
      var log = document.createElement('button');
      log.type = 'button';
      log.className = 'planrow__log';
      log.textContent = 'log it';
      log.setAttribute('aria-label', 'Log ' + T.hm(block.end - block.start) + ' for ' + (block.label || 'this block'));
      log.addEventListener('click', opts.onLog);
      act.appendChild(log);
    } else if (now) {
      var badge = document.createElement('span');
      badge.className = 'planrow__now';
      badge.textContent = 'now';
      act.appendChild(badge);
    }
    li.appendChild(act);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'planrow__del';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Remove ' + (block.label || 'block'));
    del.addEventListener('click', opts.onRemove);
    li.appendChild(del);

    return li;
  }

  /** Kept short on purpose: this sits in a fixed narrow column beside the
      label, and a long string here squeezes the label out of the row. */
  function daysLabel(days) {
    if (!days || days.length === 7) return 'daily';
    if (days.length === 5 && [1, 2, 3, 4, 5].every(function (d) { return days.indexOf(d) !== -1; })) {
      return 'M–F';
    }
    return days.slice().sort().map(function (d) { return DAY_INITIALS[d]; }).join('');
  }

  function daysTitle(days) {
    if (!days || days.length === 7) return 'every day';
    return days.slice().sort().map(function (d) { return DAY_NAMES[d]; }).join(', ');
  }

  TM.plan = { init: init, render: render };
})(window.TM = window.TM || {});
