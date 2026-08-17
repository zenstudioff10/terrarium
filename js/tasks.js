/* tasks.js — the Tasks tab: a checklist of work still to do.

   A task is an intention, not a fact. Ticking one changes nothing in the
   ledger; only "log it" writes time, and only once. That is the same rule
   js/plan.js states at the top of itself, and it is what keeps the record a
   record of what happened rather than of what you meant to happen.

   Tasks live at the root of the store, not under a day — a checklist that
   emptied itself at 06:00 would not be a checklist. */
(function (TM) {
  'use strict';

  var T = TM.time;
  var S = TM.store;

  var el = {};
  var onChange = function () {};

  /* The open editor is held here rather than in the DOM. refresh() rebuilds
     every panel every 15 seconds, so an editor built straight into the list
     gets torn out from under you mid-sentence — the exact bug the entry editor
     hit in js/log.js. This carries the half-typed values too, so a rebuild puts
     them back untouched. */
  var editing = null;

  function init(changed) {
    onChange = changed || onChange;

    el.form = document.getElementById('taskForm');
    el.label = document.getElementById('taskLabel');
    el.start = document.getElementById('taskStart');
    el.dur = document.getElementById('taskDur');
    el.list = document.getElementById('tasks');
    el.clear = document.getElementById('taskClear');
    el.count = document.getElementById('taskCount');

    el.form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var label = el.label.value.trim();
      if (!label) { flash(el.label); el.label.focus(); return; }

      // Both times are optional — "ring the dentist" is a real checklist item
      // with no clock attached. Given, they must parse.
      var startMin = null;
      if (el.start.value.trim() !== '') {
        startMin = T.parseClock(el.start.value);
        if (startMin == null) { flash(el.start); el.start.focus(); return; }
      }
      var min = null;
      if (el.dur.value.trim() !== '') {
        min = T.parseDuration(el.dur.value);
        if (!min) { flash(el.dur); el.dur.focus(); return; }
      }

      S.addTask({ label: label, startMin: startMin, min: min });
      el.label.value = '';
      el.start.value = '';
      el.dur.value = '';
      el.label.focus();
      onChange();
    });

    el.clear.addEventListener('click', function () {
      var gone = S.clearDoneTasks();
      if (!gone.length) return;
      TM.log.offerUndo(
        'Cleared ' + gone.length + (gone.length === 1 ? ' done task' : ' done tasks'),
        function () { S.restoreTasks(gone); onChange(); }
      );
      onChange();
    });
  }

  function flash(node) {
    node.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' },
       { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
      { duration: 240, easing: 'ease-in-out' }
    );
  }

  /* ── the state of a task's plan block ───────────────── */

  /** True only if the block this task made is still in today's plan. Trusting
      the stored flag alone would strand a task on "already planned" after you
      deleted the block, with no way back. */
  function isPlanned(task, key, day) {
    if (!task.planId || task.plannedOn !== key) return false;
    var plans = (day && day.plans) || [];
    for (var i = 0; i < plans.length; i++) {
      if (plans[i].id === task.planId) return true;
    }
    return false;
  }

  function canPlan(task) {
    return task.startMin != null && task.min != null && !task.done;
  }

  /* ── rendering ──────────────────────────────────────── */

  function render(key, day) {
    var all = S.tasks();

    // Outstanding first, by start time, untimed last. Then the done ones,
    // most recently finished at the top of their group.
    var rows = all.slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.done) return (b.doneAt || '') < (a.doneAt || '') ? -1 : 1;
      if (a.startMin == null && b.startMin == null) return 0;
      if (a.startMin == null) return 1;
      if (b.startMin == null) return -1;
      return a.startMin - b.startMin;
    });

    var list = el.list;
    while (list.firstChild) list.removeChild(list.firstChild);

    var open = 0, done = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].done) done++; else open++;
      var node = taskRow(rows[i], key, day);
      list.appendChild(node);
      // survive the tick that rebuilt this list
      if (editing && editing.id === rows[i].id) openEditor(node, rows[i], false);
    }

    if (done) el.clear.removeAttribute('hidden');
    else el.clear.setAttribute('hidden', '');

    if (open) {
      el.count.textContent = open;
      el.count.removeAttribute('hidden');
    } else {
      el.count.setAttribute('hidden', '');
    }
  }

  function taskRow(task, key, day) {
    var li = document.createElement('li');
    li.className = 'task';
    if (task.done) li.classList.add('is-done');

    var row = document.createElement('div');
    row.className = 'task__row';

    var tick = document.createElement('button');
    tick.type = 'button';
    tick.className = 'task__tick';
    tick.setAttribute('role', 'checkbox');
    tick.setAttribute('aria-checked', task.done ? 'true' : 'false');
    tick.setAttribute('aria-label', (task.done ? 'Mark not done: ' : 'Mark done: ') + (task.label || 'task'));
    tick.addEventListener('click', function (ev) {
      ev.stopPropagation();
      S.setTaskDone(task.id, !task.done);
      onChange();
    });

    var body = document.createElement('span');
    body.className = 'task__body';
    body.setAttribute('role', 'button');
    body.setAttribute('tabindex', '0');
    body.title = 'Edit this task';

    var label = document.createElement('span');
    label.className = 'task__label';
    label.textContent = task.label || 'untitled';
    body.appendChild(label);

    var when = document.createElement('span');
    when.className = 'task__when';
    when.textContent = timeLabel(task);
    body.appendChild(when);

    var openEdit = function () { toggleEditor(li, task); };
    body.addEventListener('click', openEdit);
    body.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEdit(); }
    });

    var act = document.createElement('span');
    act.className = 'task__act';
    act.appendChild(actionFor(task, key, day));

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'task__del';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Remove ' + (task.label || 'task'));
    del.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (editing && editing.id === task.id) editing = null;
      var gone = S.removeTask(task.id);
      if (gone) {
        TM.log.offerUndo('Removed "' + (gone.label || 'task') + '"',
          function () { S.restoreTasks([gone]); onChange(); });
      }
      onChange();
    });

    row.appendChild(tick);
    row.appendChild(body);
    row.appendChild(act);
    row.appendChild(del);
    li.appendChild(row);
    return li;
  }

  function timeLabel(task) {
    if (task.startMin != null && task.min != null) {
      return T.clock(task.startMin) + ' · ' + T.hm(task.min);
    }
    if (task.startMin != null) return T.clock(task.startMin);
    if (task.min != null) return T.hm(task.min);
    return '';
  }

  /** One slot on the right of the row: plan it, log it, or say why not. */
  function actionFor(task, key, day) {
    if (task.done) {
      if (task.logged) return note('logged', 'This task is already in today’s ledger');
      if (task.min == null) return note('done', 'No length set, so there is nothing to log');
      var log = document.createElement('button');
      log.type = 'button';
      log.className = 'task__btn';
      log.textContent = 'log it';
      log.setAttribute('aria-label', 'Log ' + T.hm(task.min) + ' for ' + (task.label || 'this task'));
      log.addEventListener('click', function (ev) {
        ev.stopPropagation();
        // the same path the chips and the plan rows use, so undo and the
        // toast behave identically
        TM.log.addAs('productive', task.min, task.label || '');
        S.updateTask(task.id, { logged: true });
        onChange();
      });
      return log;
    }

    if (isPlanned(task, key, day)) return note('in plan', 'Already in today’s plan');

    if (!canPlan(task)) {
      return note('', task.startMin == null
        ? 'Set a start time and a length to put this in the plan'
        : 'Set a length to put this in the plan');
    }

    var go = document.createElement('button');
    go.type = 'button';
    go.className = 'task__btn task__btn--plan';
    go.textContent = '→ plan';
    go.setAttribute('aria-label', 'Put ' + (task.label || 'this task') + ' in today’s plan at ' +
      T.clock(task.startMin));
    go.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var res = S.addPlan(S.todayKey(), {
        label: task.label,
        start: task.startMin,
        end: task.startMin + task.min,
        tag: 'productive'
      });
      S.updateTask(task.id, { plannedOn: res.key, planId: res.block.id });
      TM.log.offerUndo(
        'Planned ' + T.clock(task.startMin) + '–' + T.clock((task.startMin + task.min) % 1440),
        function () {
          S.removePlan(res.key, res.block.id);
          S.updateTask(task.id, { plannedOn: null, planId: null });
          onChange();
        }
      );
      onChange();
    });
    return go;
  }

  function note(text, title) {
    var s = document.createElement('span');
    s.className = 'task__note';
    s.textContent = text;
    if (title) s.title = title;
    return s;
  }

  /* ── editing ────────────────────────────────────────── */

  function toggleEditor(li, task) {
    if (editing && editing.id === task.id) {
      editing = null;
      closeEditors();
      return;
    }
    editing = {
      id: task.id,
      label: task.label || '',
      start: task.startMin == null ? '' : T.clock(task.startMin),
      dur: task.min == null ? '' : T.hm(task.min)
    };
    closeEditors();
    openEditor(li, task, true);
  }

  function closeEditors() {
    var open = el.list.querySelectorAll('.taskedit');
    for (var i = 0; i < open.length; i++) {
      open[i].parentNode.classList.remove('is-editing');
      open[i].remove();
    }
  }

  function openEditor(li, task, focus) {
    var form = document.createElement('form');
    form.className = 'taskedit';
    form.innerHTML =
      '<input class="taskedit__label" type="text" placeholder="what needs doing?" aria-label="Task">' +
      '<div class="taskedit__row">' +
        '<input class="taskedit__start" type="text" inputmode="numeric" placeholder="09:00" aria-label="Start time, optional">' +
        '<input class="taskedit__dur" type="text" placeholder="2h" aria-label="How long, optional">' +
        '<button type="submit" class="btn btn--solid taskedit__save">Save</button>' +
      '</div>';

    var labelEl = form.querySelector('.taskedit__label');
    var startEl = form.querySelector('.taskedit__start');
    var durEl = form.querySelector('.taskedit__dur');
    labelEl.value = editing.label;
    startEl.value = editing.start;
    durEl.value = editing.dur;

    // every keystroke goes to the state, so the next tick can rebuild it
    var bind = function (node, field) {
      node.addEventListener('input', function () {
        if (editing) editing[field] = node.value;
      });
    };
    bind(labelEl, 'label');
    bind(startEl, 'start');
    bind(durEl, 'dur');

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();

      var label = labelEl.value.trim();
      if (!label) { flash(labelEl); labelEl.focus(); return; }

      // Blank clears the time rather than leaving the old one behind, so a
      // task can lose its clock as well as gain one.
      var startMin = null;
      if (startEl.value.trim() !== '') {
        startMin = T.parseClock(startEl.value);
        if (startMin == null) { flash(startEl); startEl.focus(); return; }
      }
      var min = null;
      if (durEl.value.trim() !== '') {
        min = T.parseDuration(durEl.value);
        if (!min) { flash(durEl); durEl.focus(); return; }
      }

      S.updateTask(task.id, { label: label, startMin: startMin, min: min });
      editing = null;
      onChange();
    });

    li.classList.add('is-editing');
    li.appendChild(form);
    if (focus) { labelEl.focus(); labelEl.select(); }
  }

  TM.tasks = { init: init, render: render };
})(window.TM = window.TM || {});
