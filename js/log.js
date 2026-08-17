/* log.js — everything on the right-hand panel: tags, chips, the timer,
   the entry list, and the undo that makes all of it safe to use quickly. */
(function (TM) {
  'use strict';

  var T = TM.time;
  var S = TM.store;

  var TAG_NAME = { productive: 'Productive', wasted: 'Wasted', sleep: 'Nap' };

  var el = {};
  var currentTag = 'productive';
  var onChange = function () {};
  var timerTick = null;
  var undoAction = null;
  var toastTimer = null;

  function init(changed) {
    onChange = changed || onChange;

    el.tags = document.querySelectorAll('.tag');
    el.chips = document.querySelectorAll('.chip');
    el.customForm = document.getElementById('customForm');
    el.customDur = document.getElementById('customDur');
    el.customLabel = document.getElementById('customLabel');
    el.customAt = document.getElementById('customAt');
    el.entries = document.getElementById('entries');
    el.timer = document.getElementById('timer');
    el.timerTime = document.getElementById('timerTime');
    el.timerTag = document.getElementById('timerTag');
    el.timerBtn = document.getElementById('timerBtn');
    el.nightForm = document.getElementById('nightSleepForm');
    el.nightInput = document.getElementById('nightSleepInput');
    el.wakeInput = document.getElementById('wakeInput');
    el.toast = document.getElementById('toast');
    el.toastMsg = document.getElementById('toastMsg');
    el.toastUndo = document.getElementById('toastUndo');

    for (var i = 0; i < el.tags.length; i++) {
      el.tags[i].addEventListener('click', function () { setTag(this.dataset.tag); });
    }
    for (var j = 0; j < el.chips.length; j++) {
      el.chips[j].addEventListener('click', function () { add(+this.dataset.min, ''); });
    }

    el.customForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var min = T.parseDuration(el.customDur.value);
      if (!min) {
        el.customDur.focus();
        el.customDur.select();
        flash(el.customDur);
        return;
      }
      /* Blank means now. A time backfills it — the entry lands on whichever
         ledger day owns that clock reading, so a 01:00 logged at breakfast
         goes to last night rather than this morning. */
      var at = null;
      var raw = el.customAt.value.trim();
      if (raw !== '') {
        var when = T.parseClock(raw);
        if (when == null) { flash(el.customAt); el.customAt.focus(); return; }
        at = T.stampAt(S.todayKey(), T.ledgerMinute(when)).toISOString();
      }

      addAs(currentTag, min, el.customLabel.value, at);
      el.customDur.value = '';
      el.customLabel.value = '';
      el.customAt.value = '';
    });

    el.nightForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var key = S.todayKey();

      var slept = el.nightInput.value.trim();
      var min = T.parseDuration(slept);
      if (!min && slept !== '') { flash(el.nightInput); return; }

      var woke = el.wakeInput.value.trim();
      var wake = woke === '' ? null : T.parseClock(woke);
      if (woke !== '' && wake == null) { flash(el.wakeInput); return; }

      S.setNightSleep(key, min);
      S.setWakeTime(key, wake);
      el.nightInput.blur();
      el.wakeInput.blur();
      onChange();
    });

    el.timerBtn.addEventListener('click', toggleTimer);
    el.toastUndo.addEventListener('click', runUndo);

    setTag(currentTag);
    syncTimer();
  }

  function flash(node) {
    node.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' },
       { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
      { duration: 240, easing: 'ease-in-out' }
    );
  }

  function setTag(tag) {
    currentTag = tag;
    for (var i = 0; i < el.tags.length; i++) {
      el.tags[i].setAttribute('aria-checked', el.tags[i].dataset.tag === tag ? 'true' : 'false');
    }
  }

  function tag() { return currentTag; }

  /** Drop a length into the quick-add and put the cursor where it can be
      changed — the nudge uses this so the gap it names is one keystroke from
      being logged. */
  function prefill(minutes) {
    el.customDur.value = T.hm(Math.max(1, Math.round(minutes)));
    el.customLabel.focus();
  }

  /* ── adding and removing ────────────────────────────── */

  function add(minutes, label) {
    addAs(currentTag, minutes, label);
  }

  /** Same path as the quick-add chips, but with the tag named explicitly —
      the Plan tab's "log it" uses this so undo and the toast behave the same. */
  function addAs(tag, minutes, label, at) {
    var res = S.addEntry(tag, minutes, label, at);
    offerUndo(
      TAG_NAME[res.entry.tag] + ' · ' + T.hm(res.entry.min) + ' logged',
      function () { S.removeEntry(res.key, res.entry.id); onChange(); }
    );
    onChange();
  }

  function remove(key, id) {
    if (editing && editing.id === id) editing = null;
    var gone = S.removeEntry(key, id);
    if (!gone) return;
    offerUndo(
      'Removed ' + T.hm(gone.min),
      function () { S.restoreEntry(key, gone); onChange(); }
    );
    onChange();
  }

  /* ── undo ───────────────────────────────────────────── */

  function offerUndo(message, action) {
    undoAction = action;
    el.toastMsg.textContent = message;
    // some notices have nothing to take back
    if (action) el.toastUndo.removeAttribute('hidden');
    else el.toastUndo.setAttribute('hidden', '');
    el.toast.removeAttribute('hidden');
    // next frame, so the transition has a from-state to run from
    requestAnimationFrame(function () { el.toast.classList.add('is-up'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
  }

  function hideToast() {
    el.toast.classList.remove('is-up');
    undoAction = null;
    setTimeout(function () {
      if (!el.toast.classList.contains('is-up')) el.toast.setAttribute('hidden', '');
    }, 320);
  }

  function runUndo() {
    if (undoAction) undoAction();
    hideToast();
  }

  /* ── the timer ──────────────────────────────────────── */

  /* A timer left running overnight used to be written as one entry — its whole
     span, stamped at the moment you stopped, landing entirely on the stop day.
     That could be a single block longer than the window itself, silently
     wrecking that day's ceiling and untracked figures.

     So the span is split across the ledger days it actually crossed and each
     piece clipped to that day's own window. Hours outside a window were never
     tracked hours, and are simply not written. */
  function timerSegments(active, endMs) {
    var startMs = new Date(active.startedAt).getTime();
    if (!(endMs > startMs)) return [];

    var out = [];
    var key = T.dayKey(new Date(startMs));
    var lastKey = T.dayKey(new Date(endMs));

    for (var guard = 0; guard < 40; guard++) {
      var day = S.getDay(key);
      var winA = T.stampAt(key, T.startOf(day)).getTime();
      var winB = T.stampAt(key, T.endOf(day)).getTime();
      var a = Math.max(startMs, winA);
      var b = Math.min(endMs, winB);
      if (b > a) {
        out.push({
          key: key,
          // floored at a minute: a quick start-stop is still a real thing you
          // did, and rounding it away would report it as time outside the window
          min: Math.max(1, Math.round((b - a) / 60000)),
          // a minute short of the edge, so a segment ending at midnight still
          // buckets into the hour it belongs to rather than wrapping
          at: new Date(b - 60000).toISOString()
        });
      }
      if (key === lastKey) break;
      key = T.shiftKey(key, 1);
    }

    return out;
  }

  function toggleTimer() {
    var active = S.state().activeTimer;
    if (active) {
      var now = Date.now();
      var raw = Math.max(0, Math.round((now - new Date(active.startedAt).getTime()) / 60000));
      var segs = timerSegments(active, now);
      S.setTimer(null);

      if (!segs.length) {
        offerUndo('Timer ran ' + T.hm(raw) + ', all of it outside your window — nothing logged', null);
      } else {
        var written = [], total = 0;
        for (var i = 0; i < segs.length; i++) {
          written.push(S.addEntry(active.tag, segs[i].min, active.label || '', segs[i].at));
          total += segs[i].min;
        }
        var msg = TAG_NAME[active.tag] + ' · ' + T.hm(total) + ' logged';
        if (segs.length > 1) msg += ' across ' + segs.length + ' days';
        if (raw - total >= 2) msg += ' · ' + T.hm(raw - total) + ' fell outside the window';
        offerUndo(msg, function () {
          for (var j = 0; j < written.length; j++) S.removeEntry(written[j].key, written[j].entry.id);
          onChange();
        });
      }
      onChange();
    } else {
      S.setTimer({ tag: currentTag, startedAt: new Date().toISOString(), label: el.customLabel.value.trim() });
    }
    syncTimer();
    onChange();
  }

  function syncTimer() {
    var active = S.state().activeTimer;
    clearInterval(timerTick);

    if (!active) {
      el.timer.setAttribute('data-running', 'false');
      el.timerTime.textContent = '00:00:00';
      el.timerTag.textContent = 'idle';
      el.timerBtn.innerHTML = 'Start<kbd>T</kbd>';
      return;
    }

    el.timer.setAttribute('data-running', 'true');
    el.timerTag.textContent = active.label ? TAG_NAME[active.tag] + ' · ' + active.label : TAG_NAME[active.tag];
    el.timerBtn.innerHTML = 'Stop<kbd>T</kbd>';

    var paint = function () {
      var ms = Date.now() - new Date(active.startedAt).getTime();
      if (ms < 0) ms = 0;
      var s = Math.floor(ms / 1000);
      el.timerTime.textContent =
        T.pad(Math.floor(s / 3600)) + ':' + T.pad(Math.floor(s / 60) % 60) + ':' + T.pad(s % 60);
    };
    paint();
    timerTick = setInterval(paint, 1000);
  }

  /* ── the entry list ─────────────────────────────────── */

  function renderEntries(key, day) {
    buildEntryList(el.entries, key, day);
  }

  /** Draws a day's entries into any container. The record uses this too, which
      is what makes a past day inspectable at all — until now `render` only ever
      ran for today and older entries could not be seen anywhere. */
  function buildEntryList(list, key, day) {
    while (list.firstChild) list.removeChild(list.firstChild);

    var entries = (day.entries || []).slice().sort(function (a, b) {
      return a.at < b.at ? 1 : -1;   // newest first
    });

    for (var i = 0; i < entries.length; i++) {
      var node = entryNode(key, entries[i]);
      list.appendChild(node);
      // survive the 15-second tick that rebuilt this list
      if (editing && editing.key === key && editing.id === entries[i].id) {
        openEditor(node, key, entries[i], false);
      }
    }
  }

  function entryNode(key, entry) {
    var li = document.createElement('li');
    li.className = 'entry';
    li.dataset.tag = entry.tag;

    var p = T.parts(new Date(entry.at));

    var at = document.createElement('span');
    at.className = 'entry__at';
    at.textContent = T.pad(p.hour) + ':' + T.pad(p.minute);

    var label = document.createElement('span');
    label.className = 'entry__label';
    var sw = document.createElement('i');
    sw.className = 'swatch';
    label.appendChild(sw);
    label.appendChild(document.createTextNode(entry.label || TAG_NAME[entry.tag]));
    label.title = entry.label || TAG_NAME[entry.tag];

    var min = document.createElement('span');
    min.className = 'entry__min';
    min.textContent = T.hm(entry.min);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'entry__del';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Remove ' + T.hm(entry.min) + ' ' + TAG_NAME[entry.tag]);
    del.addEventListener('click', function (ev) { ev.stopPropagation(); remove(key, entry.id); });

    var row = document.createElement('div');
    row.className = 'entry__row';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.title = 'Edit this entry';
    row.appendChild(at);
    row.appendChild(label);
    row.appendChild(min);
    row.appendChild(del);

    var open = function () { toggleEditor(li, key, entry); };
    row.addEventListener('click', open);
    row.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
    });

    li.appendChild(row);
    return li;
  }

  /* An entry used to be write-once: the only correction was deleting it and
     typing it again, which also lost its original time.

     The open editor is held as state rather than as DOM, because the page
     re-renders itself every 15 seconds — building it straight into the list
     meant the tick tore it out from under you mid-sentence. `editing` also
     carries the half-typed values, so a rebuild puts them back untouched. */
  var editing = null;

  function toggleEditor(li, key, entry) {
    if (editing && editing.key === key && editing.id === entry.id) {
      editing = null;
      closeEditors();
      return;
    }
    var p = T.parts(new Date(entry.at));
    editing = {
      key: key,
      id: entry.id,
      time: T.clock(p.hour * 60 + p.minute),
      dur: T.hm(entry.min),
      label: entry.label || '',
      tag: entry.tag
    };
    closeEditors();
    openEditor(li, key, entry, true);
  }

  function closeEditors() {
    var open = document.querySelectorAll('.editor');
    for (var i = 0; i < open.length; i++) {
      open[i].parentNode.classList.remove('is-editing');
      open[i].remove();
    }
  }

  function openEditor(li, key, entry, focus) {
    var form = document.createElement('form');
    form.className = 'editor';
    form.innerHTML =
      '<div class="editor__row">' +
        '<input class="editor__time" type="text" inputmode="numeric" aria-label="Time">' +
        '<input class="editor__dur" type="text" aria-label="How long">' +
        '<input class="editor__label" type="text" placeholder="what was it?" aria-label="Label">' +
      '</div>' +
      '<div class="editor__row editor__row--acts">' +
        '<div class="tagpick tagpick--mini editor__tags" role="radiogroup" aria-label="Kind of time">' +
          '<button type="button" class="tag" data-tag="productive" role="radio">Productive</button>' +
          '<button type="button" class="tag" data-tag="wasted" role="radio">Wasted</button>' +
          '<button type="button" class="tag" data-tag="sleep" role="radio">Nap</button>' +
        '</div>' +
        '<button type="submit" class="btn btn--solid editor__save">Save</button>' +
      '</div>';

    var timeEl = form.querySelector('.editor__time');
    var durEl = form.querySelector('.editor__dur');
    var labelEl = form.querySelector('.editor__label');
    timeEl.value = editing.time;
    durEl.value = editing.dur;
    labelEl.value = editing.label;

    // every keystroke goes to the state, so the next tick can rebuild it
    var bind = function (node, field) {
      node.addEventListener('input', function () {
        if (editing) editing[field] = node.value;
      });
    };
    bind(timeEl, 'time');
    bind(durEl, 'dur');
    bind(labelEl, 'label');

    var tags = form.querySelectorAll('.tag');
    for (var t = 0; t < tags.length; t++) {
      (function (btn) {
        btn.setAttribute('aria-checked', btn.dataset.tag === editing.tag ? 'true' : 'false');
        btn.addEventListener('click', function () {
          editing.tag = btn.dataset.tag;
          for (var u = 0; u < tags.length; u++) {
            tags[u].setAttribute('aria-checked', tags[u] === btn ? 'true' : 'false');
          }
        });
      }(tags[t]));
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var mins = T.parseDuration(durEl.value);
      if (!mins) { flash(durEl); durEl.focus(); return; }
      var when = T.parseClock(timeEl.value);
      if (when == null) { flash(timeEl); timeEl.focus(); return; }

      var before = { min: entry.min, label: entry.label, tag: entry.tag, at: entry.at };
      var res = S.updateEntry(key, entry.id, {
        min: mins,
        label: labelEl.value,
        tag: editing.tag,
        at: T.stampAt(key, T.ledgerMinute(when)).toISOString()
      });
      editing = null;
      if (res) {
        offerUndo('Entry changed', function () {
          S.updateEntry(res.key, entry.id, before);
          onChange();
        });
      }
      onChange();
    });

    li.classList.add('is-editing');
    li.appendChild(form);
    if (focus) { timeEl.focus(); timeEl.select(); }
  }

  function renderNightSleep(day) {
    if (document.activeElement !== el.nightInput) {
      el.nightInput.value = day.nightSleepMin ? T.hm(day.nightSleepMin) : '';
    }
    if (document.activeElement !== el.wakeInput) {
      el.wakeInput.value = day.wakeMin != null ? T.clock(day.wakeMin) : '';
    }
  }

  function render(key, day) {
    renderEntries(key, day);
    renderNightSleep(day);
    syncTimer();
  }

  TM.log = {
    init: init,
    render: render,
    setTag: setTag,
    tag: tag,
    add: add,
    addAs: addAs,
    buildEntryList: buildEntryList,
    prefill: prefill,
    // the one toast, shared — the Tasks tab undoes through it too, so every
    // reversible action on the page behaves the same way
    offerUndo: offerUndo,
    toggleTimer: toggleTimer,
    undo: runUndo
  };
})(window.TM = window.TM || {});
