/* app.js — boot, the tick, and everything that writes the middle column. */
(function (TM) {
  'use strict';

  var T = TM.time;
  var S = TM.store;
  var E = TM.energy;

  var el = {};
  var shown = {};        // last figure painted, per readout, for easing
  var anims = {};

  function $(id) { return document.getElementById(id); }

  function boot() {
    el.stampDay = $('stampDay');
    el.stampClock = $('stampClock');
    el.ledProductive = $('ledProductive');
    el.ledWasted = $('ledWasted');
    el.ledNap = $('ledNap');
    el.ledUntracked = $('ledUntracked');
    el.rowProductive = document.querySelector('.lrow[data-k="productive"]');
    el.rowWasted = document.querySelector('.lrow[data-k="wasted"]');
    el.rowNap = document.querySelector('.lrow[data-k="sleep"]');
    el.rowUntracked = document.querySelector('.lrow[data-k="untracked"]');
    el.budgetVal = $('budgetVal');
    el.budgetNote = $('budgetNote');
    el.leftNum = $('leftNum');
    el.leftSub = $('leftSub');
    el.grownNum = $('grownNum');
    el.grownSub = $('grownSub');
    el.ceilingVal = $('ceilingVal');
    el.centre = document.querySelector('.stagecentre');
    el.ceilingBreak = $('ceilingBreak');
    el.verdict = $('verdict');
    el.nudge = $('nudge');
    el.nudgeAct = $('nudgeAct');
    el.nudgeHide = $('nudgeHide');
    /* Scoped to [data-end], not to the class. `.windowend__opts` is the shared
       radiogroup styling — the daily target and the plant picker use it too —
       so the bare class selector swept up their buttons, blanked their checked
       state on every tick, and would have called setWindowEnd(NaN) the moment
       one was clicked. */
    el.windowOpts = document.querySelectorAll('.windowend__opts button[data-end]');
    el.windowNote = $('windowNote');
    el.freeNum = $('freeNum');
    el.readoutPair = document.querySelector('.readout--pair');
    el.tabs = document.querySelectorAll('.tabs button');
    el.views = { today: $('viewToday'), record: $('viewRecord') };
    el.bookTabs = document.querySelectorAll('.booktabs button');
    el.books = { log: $('bookLog'), plan: $('bookPlan'), tasks: $('bookTasks') };

    for (var t = 0; t < el.tabs.length; t++) {
      el.tabs[t].addEventListener('click', function () { showView(this.dataset.view); });
    }
    for (var b = 0; b < el.bookTabs.length; b++) {
      el.bookTabs[b].addEventListener('click', function () { showBook(this.dataset.book); });
    }

    for (var i = 0; i < el.windowOpts.length; i++) {
      el.windowOpts[i].addEventListener('click', function () {
        S.setWindowEnd(S.todayKey(), +this.dataset.end);
        refresh();
      });
    }

    el.themeOpts = document.querySelectorAll('#themePick button');
    for (var h = 0; h < el.themeOpts.length; h++) {
      el.themeOpts[h].addEventListener('click', function () {
        S.setTheme(this.dataset.theme);
        refresh();
      });
    }

    el.nudgeAct.addEventListener('click', function () {
      // hand the gap straight to the quick-add rather than only naming it
      showView('today');
      showBook('log');
      TM.log.prefill(nudgeGap);
      snoozedAt = nudgeGap;
      refresh();
    });
    el.nudgeHide.addEventListener('click', function () {
      snoozedAt = nudgeGap;
      refresh();
    });

    el.keysOpts = document.querySelectorAll('#keysOpts button');
    for (var kb = 0; kb < el.keysOpts.length; kb++) {
      el.keysOpts[kb].addEventListener('click', function () {
        S.setShowKeys(this.dataset.keys === 'on');
        refresh();
      });
    }

    el.speciesOpts = document.querySelectorAll('#speciesOpts button');
    for (var sp = 0; sp < el.speciesOpts.length; sp++) {
      el.speciesOpts[sp].addEventListener('click', function () {
        S.setSpecies(this.dataset.species);
        TM.plant.setSpecies(this.dataset.species);
        refresh();
      });
    }

    el.targetOpts = document.querySelectorAll('#targetOpts button');
    for (var g = 0; g < el.targetOpts.length; g++) {
      el.targetOpts[g].addEventListener('click', function () {
        S.setTarget(+this.dataset.target);
        refresh();
      });
    }

    S.load();
    // before anything renders, so a saved dark theme never flashes light first
    setDusk(T.phase(T.minuteOfDay(new Date()), T.endOf(S.getDay(S.todayKey()))));
    TM.plant.init(S.settings().species);
    TM.log.init(refresh);
    TM.plan.init(refresh);
    TM.tasks.init(refresh);
    TM.dashboard.init();

    labelShortcuts();
    bindDaySetup();
    bindKeys();
    refresh();

    /* The page is fully built behind the splash, so stepping inside reveals
       something finished rather than starting the work. The arrival animation
       runs as the door fades, which is what makes the two read as one motion
       instead of a screen swapping for another. */
    TM.splash.init(function () { arrive(el.views[view]); });

    setInterval(refresh, 15000);
  }

  /* Day setup is a real <details> so it brings its own keyboard and
     screen-reader behaviour. It has to stay open and uncollapsible on a wide
     screen, and CSS cannot force that — Chrome hides the contents through a UA
     slot rather than a rule you can override — so the attribute is driven from
     the same media query the stylesheet uses. */
  function bindDaySetup() {
    var box = $('daySetup');
    if (!box) return;
    var narrow = window.matchMedia('(max-width: 700px)');
    var sync = function () { box.open = !narrow.matches; };
    if (narrow.addEventListener) narrow.addEventListener('change', sync);
    else if (narrow.addListener) narrow.addListener(sync);
    sync();
  }

  /* ── views ──────────────────────────────────────────── */

  var view = 'today';

  function showView(next) {
    view = next;
    for (var i = 0; i < el.tabs.length; i++) {
      el.tabs[i].setAttribute('aria-selected', el.tabs[i].dataset.view === next ? 'true' : 'false');
    }
    for (var k in el.views) {
      if (!el.views.hasOwnProperty(k)) continue;
      if (k === next) el.views[k].removeAttribute('hidden');
      else el.views[k].setAttribute('hidden', '');
    }
    window.scrollTo(0, 0);
    // the record is only rebuilt when it is actually on screen
    if (next === 'record') TM.dashboard.render();
    arrive(el.views[next]);
  }

  /* The page used to snap into existence. Retriggering an animation needs the
     class gone and the layout flushed before it goes back on, or the browser
     coalesces the two and nothing plays. prefers-reduced-motion blanks the
     keyframes in base.css, so this stays a no-op there. */
  function arrive(host) {
    if (!host) return;
    host.classList.remove('is-arriving');
    void host.offsetWidth;
    host.classList.add('is-arriving');
  }

  function showBook(next) {
    for (var i = 0; i < el.bookTabs.length; i++) {
      el.bookTabs[i].setAttribute('aria-selected', el.bookTabs[i].dataset.book === next ? 'true' : 'false');
    }
    for (var k in el.books) {
      if (!el.books.hasOwnProperty(k)) continue;
      if (k === next) el.books[k].removeAttribute('hidden');
      else el.books[k].setAttribute('hidden', '');
    }
  }

  /* ── the tick ───────────────────────────────────────── */

  function refresh() {
    var now = new Date();
    var nowMin = T.minuteOfDay(now);
    var key = T.dayKey(now);
    var day = S.getDay(key);
    var blocks = TM.schedule.blocksFor(key, day, S.routines());
    var e = E.compute(day, nowMin, blocks, S.settings().targetMin);

    setDusk(e.phase);
    setLight(e);
    // the light behind the shelf takes its tint from how the day is going —
    // the same four states the foliage already uses, nothing new computed
    el.centre.dataset.state = e.state;
    renderStamp(now, nowMin);
    renderLedger(e);
    renderReadout(e);
    renderNudge(e);

    TM.plant.renderLeft(e);
    TM.plant.renderGrown(e);
    TM.plant.renderStrip(day, e, nowMin, blocks);
    TM.log.render(key, day);
    TM.plan.render(key, day, e, nowMin);
    TM.tasks.render(key, day);
    if (view === 'record') TM.dashboard.render();
  }

  /* On 'auto' the page still follows the window rather than the machine: it is
     daylight while your hours are open and dusk once they close. 'light' and
     'dark' pin it. The attribute has always had a manual value the CSS knows
     about; nothing used to set it. */
  function setDusk(phase) {
    var theme = S.settings().theme || 'auto';
    document.body.dataset.dusk =
      theme === 'dark' ? '1' :
      theme === 'light' ? '0' :
      (phase === 'closed' ? 'auto' : '0');

    for (var i = 0; i < el.themeOpts.length; i++) {
      el.themeOpts[i].setAttribute('aria-checked',
        el.themeOpts[i].dataset.theme === theme ? 'true' : 'false');
    }
  }

  /* The sun crosses the page as the day does: it rises to its height around
     midday, and warms toward amber at both ends. Only position and brightness
     move — the colours belong to the palette, which snaps at 20:00. */
  function setLight(e) {
    var p = e.window > 0 ? Math.min(1, Math.max(0, e.elapsed / e.window)) : 1;
    var arc = Math.sin(p * Math.PI);
    var s = document.body.style;
    s.setProperty('--sun-x', (12 + 76 * p).toFixed(1) + '%');
    s.setProperty('--sun-y', (40 - 24 * arc).toFixed(1) + '%');
    s.setProperty('--sun-warm', (Math.abs(2 * p - 1)).toFixed(3));
    s.setProperty('--sun-lift', arc.toFixed(3));
  }

  function renderStamp(now, nowMin) {
    el.stampDay.textContent = T.dayLabel(T.dayKey(now));
    el.stampClock.textContent = T.clock(nowMin);
  }

  /* ── left column ────────────────────────────────────── */

  function renderLedger(e) {
    el.ledProductive.textContent = T.hm(e.productive);
    el.ledWasted.textContent = T.hm(e.wasted);
    el.ledNap.textContent = T.hm(e.napMin);
    el.ledUntracked.textContent = T.hm(e.untracked);

    // Each row carries its share of the usable day, so the shape of it is
    // readable without reading four numbers.
    var share = function (row, mins) {
      var pct = e.usable > 0 ? Math.min(1, mins / e.usable) : 0;
      row.style.setProperty('--share', (pct * 100).toFixed(1) + '%');
      row.classList.toggle('is-empty', mins <= 0);
    };
    share(el.rowProductive, e.productive);
    share(el.rowWasted, e.wasted);
    share(el.rowNap, e.napMin);
    share(el.rowUntracked, e.untracked);

    for (var s = 0; s < el.speciesOpts.length; s++) {
      el.speciesOpts[s].setAttribute('aria-checked',
        el.speciesOpts[s].dataset.species === (S.settings().species || 'fern') ? 'true' : 'false');
    }

    var keysOn = !!S.settings().showKeys;
    document.body.dataset.keys = keysOn ? 'on' : 'off';
    for (var kk = 0; kk < el.keysOpts.length; kk++) {
      el.keysOpts[kk].setAttribute('aria-checked',
        (el.keysOpts[kk].dataset.keys === 'on') === keysOn ? 'true' : 'false');
    }

    el.budgetVal.textContent = T.hours(e.usable) + 'h';

    var bits = [T.clock(e.startMin) + ' to ' + T.clock(e.endMin % 1440)];
    if (e.sleptIn > 0) bits.push('slept ' + T.hm(e.sleptIn) + ' past 06:00');
    if (e.napMin > 0) bits.push(T.hm(e.napMin) + ' napped');
    el.budgetNote.textContent = bits.join(' · ');

    // window-end presets
    for (var i = 0; i < el.windowOpts.length; i++) {
      var on = +el.windowOpts[i].dataset.end === e.endMin;
      el.windowOpts[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    // only worth saying when it applies — an empty note collapses away
    for (var g = 0; g < el.targetOpts.length; g++) {
      el.targetOpts[g].setAttribute('aria-checked',
        +el.targetOpts[g].dataset.target === e.target ? 'true' : 'false');
    }

    el.windowNote.textContent = e.nightSpan > 0
      ? '+' + T.hm(e.nightSpan) + ' tonight only. Tomorrow opens back at 20:00.'
      : '';
  }

  /* ── centre column ──────────────────────────────────── */

  function renderReadout(e) {
    animateNumber('left', el.leftNum, e.clockLeft / 60);
    animateNumber('free', el.freeNum, e.freeLeft / 60);
    animateNumber('grown', el.grownNum, e.productive / 60);

    /* "free" only differs from "hours left" once something is booked, and
       nothing usually is — so the pair printed the same numeral twice, side by
       side, at two different sizes. It splits when there is a difference to
       show and collapses when there is not. */
    el.readoutPair.classList.toggle('is-split', e.committedAhead > 0);

    /* Terse when the pair splits: the long form wrapped to two lines there and
       pushed the whole centre column past the fold. */
    el.leftSub.textContent = e.phase === 'closed'
      ? 'the window has closed'
      : (e.committedAhead > 0
          ? T.hm(e.committedAhead) + ' booked · ' + T.hm(e.elapsed) + ' gone'
          : T.hm(e.elapsed) + ' of the window gone');

    // Progress against the target, not a second copy of the wasted/unlogged
    // figures — those already appear on the ceiling line below.
    if (e.target > 0) {
      el.grownSub.textContent = e.targetMet
        ? 'target met · ' + T.hours(e.target) + 'h'
        : 'of ' + T.hours(e.target) + 'h · ' + T.hm(e.targetLeft) + ' to go';
    } else {
      el.grownSub.textContent = e.wasted || e.untracked
        ? T.hm(e.wasted) + ' wasted · ' + T.hm(e.untracked) + ' unlogged'
        : 'nothing lost yet';
    }

    // The ceiling is what the two figures add up to: the most productive hours
    // you can still end the day on. Working holds it; wasting drops it 1:1.
    // eased like the other three, so logging visibly moves it rather than
    // swapping one number for another between frames
    animateNumber('ceiling', el.ceilingVal, e.ceiling / 60, 'h');

    /* One status line, not four. What was here — "−16h 34m unlogged off 18.0h"
       — is already the fourth row of the ledger and the grey band in the
       right-hand jar, so it was being said three times. What is left is the one
       thing the ceiling actually decides: whether the target is still on. */
    var bits = [];
    // Once the window has shut, nothing is reachable and the verdict has
    // already said how the day went — "Window closed" over "still reachable"
    // read as a contradiction.
    if (e.target > 0 && e.phase !== 'closed') {
      if (e.targetMet) bits.push(T.hours(e.target) + 'h target met');
      else bits.push(T.hours(e.target) + 'h target · ' +
        (e.targetReachable ? 'still reachable' : 'out of reach'));
    }
    if (e.productiveLate >= 1) bits.push(T.hm(e.productiveLate) + ' of it after 20:00');
    el.ceilingBreak.textContent = bits.join('  ·  ');

    el.verdict.textContent = E.verdict(e);
  }

  /* ── the nudge ──────────────────────────────────────── */

  /* A log only tells the truth while you keep feeding it, and the moment you
     stop is exactly the moment nothing reminds you. So once the log has been
     quiet for a stretch the page says so, quietly, and offers to take the gap.

     Dismissing it snoozes on the size of the gap, not the clock: it comes back
     only after another hour has gone unaccounted, so it can never nag twice
     about the same silence. */
  var IDLE_MIN = 90;
  var snoozedAt = 0;
  var nudgeGap = 0;

  function renderNudge(e) {
    var gap = Math.round(e.idleMin);
    nudgeGap = gap;

    var floor = snoozedAt ? snoozedAt + 60 : IDLE_MIN;
    var due = e.phase !== 'closed' && gap >= floor;
    if (!due) {
      el.nudge.setAttribute('hidden', '');
      // the day rolled over, or the gap was closed — arm it again
      if (gap < snoozedAt) snoozedAt = 0;
      return;
    }

    el.nudgeAct.textContent = e.lastLogMin == null
      ? T.hm(gap) + ' in and nothing logged yet — account for it'
      : 'Nothing logged for ' + T.hm(gap) + ' — account for it';
    el.nudge.removeAttribute('hidden');
  }

  /** Ease each figure rather than snapping it — the numbers are the page. */
  function animateNumber(key, node, target, suffix) {
    var from = shown[key];
    var tail = suffix || '';

    if (from == null || Math.abs(target - from) < 0.05) {
      shown[key] = target;
      node.textContent = target.toFixed(1) + tail;
      return;
    }

    var start = performance.now();
    var dur = 700;

    if (anims[key]) cancelAnimationFrame(anims[key]);
    var step = function (t) {
      var k = Math.min(1, (t - start) / dur);
      var eased = 1 - Math.pow(1 - k, 3);
      node.textContent = (from + (target - from) * eased).toFixed(1) + tail;
      if (k < 1) anims[key] = requestAnimationFrame(step);
      else { shown[key] = target; anims[key] = null; }
    };
    anims[key] = requestAnimationFrame(step);
  }

  /* ── keyboard ───────────────────────────────────────── */

  /* With the pills hidden the shortcut is invisible, so it moves into the
     button's own tooltip rather than disappearing entirely. */
  function labelShortcuts() {
    var marked = document.querySelectorAll('.tag kbd, .chip kbd, #timerBtn kbd');
    for (var i = 0; i < marked.length; i++) {
      var host = marked[i].parentNode;
      var key = marked[i].textContent.trim();
      if (!key) continue;
      // Take the label by removing the kbd from a copy — a string replace of
      // the key strips the first matching letter out of the word instead
      // ("Productive" + "P" came back as "roductive").
      var copy = host.cloneNode(true);
      var stray = copy.querySelector('kbd');
      if (stray) stray.remove();
      host.title = copy.textContent.trim() + ' · press ' + key.toUpperCase();
    }
  }

  function bindKeys() {
    document.addEventListener('keydown', function (ev) {
      var t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        TM.log.undo();
        return;
      }
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      switch (ev.key.toLowerCase()) {
        case 'p': TM.log.setTag('productive'); break;
        case 'w': TM.log.setTag('wasted'); break;
        case 's': TM.log.setTag('sleep'); break;
        case '1': TM.log.add(15, ''); break;
        case '2': TM.log.add(30, ''); break;
        case '3': TM.log.add(60, ''); break;
        case 't': TM.log.toggleTimer(); break;
        default: return;
      }
      ev.preventDefault();
    });
  }

  TM.app = { refresh: refresh };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.TM = window.TM || {});
