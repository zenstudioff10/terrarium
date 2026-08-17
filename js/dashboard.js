/* dashboard.js — the record over time. Every chart here is hand-built SVG
   or plain boxes; no library, no canvas. */
(function (TM) {
  'use strict';

  var T = TM.time;
  var S = TM.store;

  /* How far back each period reaches, and what one column of the rail stands
     for. A year drawn as 365 columns is unreadable, so it groups by month. */
  var PERIODS = {
    day:   { days: 1,   bucket: 'hour',  title: 'Hour by hour' },
    week:  { days: 7,   bucket: 'day',   title: 'Day by day' },
    month: { days: 30,  bucket: 'day',   title: 'Day by day' },
    year:  { days: 365, bucket: 'month', title: 'Month by month' }
  };

  var period = 'week';
  // which past day the record has opened for correction, if any
  var openDay = null;
  var el = {};

  var monthFmt = new Intl.DateTimeFormat('en-GB', { timeZone: T.TZ, month: 'short' });
  var monthYearFmt = new Intl.DateTimeFormat('en-GB', { timeZone: T.TZ, month: 'long', year: 'numeric' });
  var longFmt = new Intl.DateTimeFormat('en-GB', { timeZone: T.TZ, day: 'numeric', month: 'short', year: 'numeric' });

  function init() {
    el.totals = document.getElementById('totals');
    el.rail = document.getElementById('dayRail');
    el.railTitle = document.getElementById('railTitle');
    el.range = document.getElementById('dashRange');
    el.ratio = document.getElementById('ratio');
    el.leak = document.getElementById('leak');
    el.labels = document.getElementById('labels');
    el.periods = document.querySelectorAll('.periods button');
    el.exportBtn = document.getElementById('exportBtn');
    el.importBtn = document.getElementById('importBtn');
    el.importInput = document.getElementById('importInput');
    el.restoreBtn = document.getElementById('restoreBtn');
    el.saveState = document.getElementById('saveState');
    el.confirm = document.getElementById('importConfirm');
    el.confirmMsg = document.getElementById('importConfirmMsg');
    el.confirmGo = document.getElementById('importGo');
    el.confirmCancel = document.getElementById('importCancel');

    for (var i = 0; i < el.periods.length; i++) {
      el.periods[i].addEventListener('click', function () {
        period = this.dataset.period;
        openDay = null;          // that column may not exist in the new period
        for (var j = 0; j < el.periods.length; j++) {
          el.periods[j].classList.toggle('is-on', el.periods[j] === this);
        }
        render();
      });
    }

    el.exportBtn.addEventListener('click', doExport);
    el.importBtn.addEventListener('click', function () { el.importInput.click(); });
    el.importInput.addEventListener('change', doImport);
    el.restoreBtn.addEventListener('click', doRestore);
    el.confirmCancel.addEventListener('click', closeConfirm);
    el.confirmGo.addEventListener('click', function () {
      if (!pendingImport) return closeConfirm();
      var ok = S.applyImport(pendingImport);
      closeConfirm();
      if (!ok) window.alert('The import could not be saved. Your previous data is still under "Undo import".');
      TM.app.refresh();
      render();
    });

    // the store reports every write, so the status line is never a guess
    S.subscribe(renderSaveState);
  }

  /* ── aggregation ────────────────────────────────────── */

  function spec() { return PERIODS[period] || PERIODS.week; }

  function keysForPeriod() {
    var today = S.todayKey();
    var keys = [];
    for (var i = spec().days - 1; i >= 0; i--) keys.push(T.shiftKey(today, -i));
    return keys;
  }

  function dateOf(key) {
    var b = key.split('-');
    return new Date(Date.UTC(+b[0], +b[1] - 1, +b[2], 6));
  }

  // 06:00 through 23:00 — the widest a day can ever be, once late nights count
  var LEAK_SLOTS = 18;

  /** Which window hour a timestamp belongs to, clamped to the ends. */
  function slotFor(iso) {
    var h = T.hourOf(iso) - 6;
    return h < 0 ? 0 : (h > LEAK_SLOTS - 1 ? LEAK_SLOTS - 1 : h);
  }

  function summarise(keys) {
    var today = S.todayKey();
    var nowMin = T.minuteOfDay(new Date());

    var rows = [];
    var targetMin = S.settings().targetMin || 0;
    var tot = { productive: 0, wasted: 0, nap: 0, untracked: 0, nightSleep: 0, nightDays: 0,
                logged: 0, metTarget: 0 };
    var labels = { productive: {}, wasted: {} };
    var lastHour = 20;   // how far right the leak clock has to reach
    var leak = new Array(LEAK_SLOTS);
    for (var z = 0; z < LEAK_SLOTS; z++) leak[z] = 0;

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var day = S.getDay(key);
      var entries = day.entries || [];

      var row = { key: key, productive: 0, wasted: 0, nap: 0, nightSleep: day.nightSleepMin || 0 };
      for (var j = 0; j < entries.length; j++) {
        var e = entries[j];
        if (labels[e.tag]) {
          var name = (e.label || '').trim() || 'unlabelled';
          labels[e.tag][name] = (labels[e.tag][name] || 0) + e.min;
        }
        if (e.tag === 'productive') row.productive += e.min;
        else if (e.tag === 'wasted') {
          row.wasted += e.min;
          // clamped rather than dropped, so the hour columns always add up to
          // the same total the ledger shows
          leak[slotFor(e.at)] += e.min;
        }
        else if (e.tag === 'sleep') row.nap += e.min;
      }

      // each day is measured against the window it actually had
      var endMin = T.endOf(day);
      var startMin = T.startOf(day);
      lastHour = Math.max(lastHour, Math.ceil(endMin / 60));
      row.metTarget = false;
      var elapsed = key === today
        ? T.elapsedInWindow(nowMin, endMin, startMin)
        : T.windowLength(endMin, startMin);
      row.elapsed = elapsed;
      row.total = row.productive + row.wasted + row.nap;
      row.has = row.total > 0 || row.nightSleep > 0;

      // Only days you were actually logging can have untracked time. Counting
      // days from before you started would just be inventing a deficit. Today
      // always counts — you are watching it happen.
      row.untracked = (entries.length || key === today)
        ? Math.max(0, elapsed - row.nap - row.productive - row.wasted)
        : 0;

      if (targetMin > 0 && row.productive >= targetMin) { row.metTarget = true; tot.metTarget++; }

      tot.productive += row.productive;
      tot.wasted += row.wasted;
      tot.nap += row.nap;
      tot.untracked += row.untracked;
      if (row.nightSleep) { tot.nightSleep += row.nightSleep; tot.nightDays++; }
      if (row.has) tot.logged++;

      rows.push(row);
    }

    return { rows: rows, tot: tot, target: targetMin, labels: labels, leak: leak, leakCols: Math.max(14, lastHour - 6) };
  }

  /* ── rail buckets ───────────────────────────────────── */

  /** Collapse the day rows into however many columns this period should draw. */
  function buckets(rows) {
    var kind = spec().bucket;
    if (kind === 'hour') return hourBuckets();
    if (kind === 'month') return monthBuckets(rows);
    return rows.map(function (r) {
      return {
        key: r.key,
        label: String(+r.key.slice(8)),
        productive: r.productive, wasted: r.wasted, nap: r.nap, total: r.total,
        title: T.dayLabel(r.key) + ' — kept ' + T.hm(r.productive) +
               ', lost ' + T.hm(r.wasted) + (r.nap ? ', napped ' + T.hm(r.nap) : '')
      };
    });
  }

  /** Today, split hour by hour across however long its window ran. */
  function hourBuckets() {
    var day = S.getDay(S.todayKey());
    var entries = day.entries || [];

    // as many columns as today actually had — 14 normally, more on a late night
    var cols = Math.max(14, Math.ceil(T.endOf(day) / 60) - 6);

    var out = [];
    for (var h = 0; h < cols; h++) {
      out.push({ label: T.pad((h + 6) % 24), productive: 0, wasted: 0, nap: 0, total: 0, title: '' });
    }
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var b = out[Math.min(slotFor(e.at), cols - 1)];
      if (e.tag === 'productive') b.productive += e.min;
      else if (e.tag === 'wasted') b.wasted += e.min;
      else if (e.tag === 'sleep') b.nap += e.min;
    }
    for (var k = 0; k < out.length; k++) {
      var o = out[k];
      o.total = o.productive + o.wasted + o.nap;
      o.title = T.pad((k + 6) % 24) + ':00 — kept ' + T.hm(o.productive) +
                ', lost ' + T.hm(o.wasted) + (o.nap ? ', napped ' + T.hm(o.nap) : '');
    }
    return out;
  }

  /** A year, grouped into calendar months. */
  function monthBuckets(rows) {
    var order = [], byMonth = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var m = r.key.slice(0, 7);
      if (!byMonth[m]) {
        byMonth[m] = { label: monthFmt.format(dateOf(r.key)), month: m,
                       full: monthYearFmt.format(dateOf(r.key)),
                       productive: 0, wasted: 0, nap: 0, total: 0, days: 0 };
        order.push(m);
      }
      var b = byMonth[m];
      b.productive += r.productive;
      b.wasted += r.wasted;
      b.nap += r.nap;
      b.total += r.total;
      if (r.has) b.days++;
    }
    return order.map(function (m) {
      var b = byMonth[m];
      b.title = b.full + ' — kept ' + T.hm(b.productive) + ', lost ' + T.hm(b.wasted) +
                ' over ' + b.days + (b.days === 1 ? ' logged day' : ' logged days');
      return b;
    });
  }

  /** Consecutive days, counting back from the most recent logged day,
      where you kept more than you lost. */
  function streak() {
    var cursor = S.todayKey();
    var day = S.getDay(cursor);
    if (!(day.entries || []).length) cursor = T.shiftKey(cursor, -1);

    var n = 0, guard = 0;
    while (guard++ < 400) {
      var d = S.getDay(cursor);
      var p = 0, w = 0;
      var es = d.entries || [];
      if (!es.length) break;
      for (var i = 0; i < es.length; i++) {
        if (es[i].tag === 'productive') p += es[i].min;
        else if (es[i].tag === 'wasted') w += es[i].min;
      }
      if (p > w) { n++; cursor = T.shiftKey(cursor, -1); }
      else break;
    }
    return n;
  }

  /* ── render ─────────────────────────────────────────── */

  function render() {
    var keys = keysForPeriod();
    var data = summarise(keys);
    renderRange(keys);
    renderTotals(data);
    renderRail(data);
    renderRatio(data);
    renderLabels(data);
    renderLeak(data);
    renderSaveState();
  }

  function renderRange(keys) {
    if (period === 'day') {
      el.range.textContent = 'Today · ' + longFmt.format(dateOf(keys[0]));
      return;
    }
    el.range.textContent = longFmt.format(dateOf(keys[0])) +
      ' – ' + longFmt.format(dateOf(keys[keys.length - 1]));
  }

  function tot(term, value, note, kind, hero) {
    var wrap = document.createElement('div');
    wrap.className = 'tot' + (hero ? ' tot--hero' : '');
    if (kind) wrap.dataset.k = kind;
    var dt = document.createElement('dt');
    dt.textContent = term;
    var dd = document.createElement('dd');
    dd.textContent = value;
    if (note) {
      var s = document.createElement('small');
      s.textContent = note;
      dd.appendChild(s);
    }
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    return wrap;
  }

  function renderTotals(d) {
    var host = el.totals;
    while (host.firstChild) host.removeChild(host.firstChild);

    var days = Math.max(1, d.tot.logged);
    var st = streak();
    var single = period === 'day';

    // kept and lost lead — they are the pair the whole record is about
    host.appendChild(tot('Kept', T.hm(d.tot.productive),
      single ? 'so far today' : T.hm(d.tot.productive / days) + ' a day', 'kept', true));
    host.appendChild(tot('Lost', T.hm(d.tot.wasted),
      single ? 'so far today' : T.hm(d.tot.wasted / days) + ' a day', 'lost', true));
    host.appendChild(tot('Untracked', T.hm(d.tot.untracked),
      single ? 'of the window, unaccounted' : 'unaccounted, on days you logged', 'untracked'));
    host.appendChild(tot(
      'Night sleep',
      d.tot.nightDays ? T.hm(d.tot.nightSleep / d.tot.nightDays) : '—',
      d.tot.nightDays
        ? (single ? 'last night' : 'average over ' + d.tot.nightDays + (d.tot.nightDays === 1 ? ' night' : ' nights'))
        : 'not logged yet',
      'sleep'
    ));
    if (d.target > 0) {
      host.appendChild(tot(
        'Target met',
        d.tot.metTarget + ' of ' + Math.max(1, d.tot.logged),
        'days at ' + T.hours(d.target) + 'h or more'
      ));
    }
    host.appendChild(tot(
      'Streak',
      st + (st === 1 ? ' day' : ' days'),
      st ? 'kept more than you lost' : 'start one today'
    ));
  }

  function renderRail(d) {
    var host = el.rail;
    while (host.firstChild) host.removeChild(host.firstChild);

    el.railTitle.textContent = spec().title;

    if (!d.tot.logged) {
      host.appendChild(empty('rail__empty', period === 'day'
        ? 'Nothing logged today yet.'
        : 'Nothing logged in this period yet.'));
      return;
    }

    var cols = buckets(d.rows);
    var floor = spec().bucket === 'hour' ? 60 : (spec().bucket === 'month' ? 600 : 240);
    var maxTotal = floor;
    for (var i = 0; i < cols.length; i++) maxTotal = Math.max(maxTotal, cols[i].total);

    var plot = document.createElement('div');
    plot.className = 'rail__plot';
    // Keep the columns a rail rather than a wall of blocks on short periods.
    // It has its own column to fill now, so this is wider than it was — but not
    // so wide that seven days become seven slabs adrift in their own gaps.
    plot.style.maxWidth = (cols.length * 62) + 'px';

    var every = Math.ceil(cols.length / 10);

    for (var k = 0; k < cols.length; k++) {
      var c = cols[k];

      var col = document.createElement('div');
      col.className = 'rail__col';
      col.title = c.title;

      /* A day column opens that day. Until now the record could only be read
         as totals — a mislogged hour three days back had nowhere to be fixed. */
      if (c.key) {
        col.classList.add('rail__col--open');
        col.setAttribute('role', 'button');
        col.setAttribute('tabindex', '0');
        col.title = c.title + ' — tap to open';
        if (c.key === openDay) col.classList.add('is-open');
        (function (key) {
          var toggle = function () { openDay = openDay === key ? null : key; render(); };
          col.addEventListener('click', toggle);
          col.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
          });
        }(c.key));
      }

      var stack = document.createElement('div');
      stack.className = 'rail__stack';

      // top to bottom: what you kept, what you slept, what you lost
      var order = ['productive', 'nap', 'wasted'];
      for (var s = 0; s < order.length; s++) {
        var v = c[order[s]];
        if (!v) continue;
        var seg = document.createElement('div');
        seg.className = 'rail__seg rail__seg--' + (order[s] === 'nap' ? 'sleep' : order[s]);
        seg.style.height = (v / maxTotal * 100).toFixed(2) + '%';
        stack.appendChild(seg);
      }
      col.appendChild(stack);

      var lab = document.createElement('span');
      lab.className = 'rail__label';
      lab.textContent = (cols.length <= 14 || k % every === 0 || k === cols.length - 1)
        ? c.label : '';
      col.appendChild(lab);

      plot.appendChild(col);
    }

    host.appendChild(plot);

    var unit = spec().bucket === 'hour' ? 'hour' : (spec().bucket === 'month' ? 'month' : 'day');
    var scale = document.createElement('p');
    scale.className = 'leak__note';
    scale.textContent = 'Full-height column = ' + T.hm(maxTotal) + ', the most logged in one ' + unit + ' here.';
    host.appendChild(scale);

    if (openDay && spec().bucket === 'day') host.appendChild(dayPanel(openDay));
  }

  /* ── opening a past day ─────────────────────────────── */

  function dayPanel(key) {
    var day = S.getDay(key);

    var box = document.createElement('section');
    box.className = 'dayopen';

    var head = document.createElement('header');
    head.className = 'dayopen__head';

    var h = document.createElement('h4');
    h.textContent = T.dayLabel(key);
    head.appendChild(h);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'dayopen__close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close ' + T.dayLabel(key));
    close.addEventListener('click', function () { openDay = null; render(); });
    head.appendChild(close);

    box.appendChild(head);

    var list = document.createElement('ul');
    list.className = 'entries entries--flat';
    TM.log.buildEntryList(list, key, day);
    box.appendChild(list);

    box.appendChild(addRow(key));
    return box;
  }

  /** Adding to a day that has already been and gone. */
  function addRow(key) {
    var form = document.createElement('form');
    form.className = 'dayadd';
    form.innerHTML =
      '<div class="dayadd__row">' +
        '<input class="dayadd__time" type="text" inputmode="numeric" placeholder="14:30" aria-label="At what time">' +
        '<input class="dayadd__dur" type="text" placeholder="45m" aria-label="How long">' +
        '<input class="dayadd__label" type="text" placeholder="what was it?" aria-label="Label">' +
      '</div>' +
      '<div class="dayadd__row dayadd__row--acts">' +
        '<div class="tagpick tagpick--mini dayadd__tags" role="radiogroup" aria-label="Kind of time">' +
          '<button type="button" class="tag" data-tag="productive" role="radio" aria-checked="true">Productive</button>' +
          '<button type="button" class="tag" data-tag="wasted" role="radio" aria-checked="false">Wasted</button>' +
          '<button type="button" class="tag" data-tag="sleep" role="radio" aria-checked="false">Nap</button>' +
        '</div>' +
        '<button type="submit" class="btn btn--solid">Add</button>' +
      '</div>';

    var timeEl = form.querySelector('.dayadd__time');
    var durEl = form.querySelector('.dayadd__dur');
    var labelEl = form.querySelector('.dayadd__label');

    var chosen = 'productive';
    var tags = form.querySelectorAll('.tag');
    for (var t = 0; t < tags.length; t++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          chosen = btn.dataset.tag;
          for (var u = 0; u < tags.length; u++) {
            tags[u].setAttribute('aria-checked', tags[u] === btn ? 'true' : 'false');
          }
        });
      }(tags[t]));
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var mins = T.parseDuration(durEl.value);
      if (!mins) { shake(durEl); durEl.focus(); return; }
      var when = T.parseClock(timeEl.value);
      if (when == null) { shake(timeEl); timeEl.focus(); return; }

      S.addEntry(chosen, mins, labelEl.value, T.stampAt(key, T.ledgerMinute(when)).toISOString());
      render();
    });

    return form;
  }

  function shake(node) {
    node.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' },
       { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
      { duration: 240, easing: 'ease-in-out' }
    );
  }

  function renderRatio(d) {
    var host = el.ratio;
    while (host.firstChild) host.removeChild(host.firstChild);

    var p = d.tot.productive, w = d.tot.wasted, n = d.tot.nap, u = d.tot.untracked;

    /* The bar is called "kept against lost" and used to be mostly neither —
       untracked ran to 72% of it and drowned the two things it is actually
       comparing. It is measured over the time you tagged, and the unlogged
       stretch is said once underneath, in words. Napped stays: it is logged
       time, and dropping it would make the other percentages wrong. */
    var all = p + w + n;
    if (!all) {
      host.appendChild(empty('ratio__empty', 'No hours tagged yet.'));
      return;
    }

    var bar = document.createElement('div');
    bar.className = 'ratio__bar';
    var segs = [['productive', p], ['wasted', w], ['sleep', n]];
    for (var i = 0; i < segs.length; i++) {
      if (!segs[i][1]) continue;
      var s = document.createElement('div');
      s.className = 'ratio__seg ratio__seg--' + segs[i][0];
      s.style.width = (segs[i][1] / all * 100).toFixed(2) + '%';
      s.title = segs[i][0] + ' · ' + T.hm(segs[i][1]);
      bar.appendChild(s);
    }
    host.appendChild(bar);

    var key = document.createElement('p');
    key.className = 'ratio__key';
    var names = { productive: 'Kept', wasted: 'Lost', sleep: 'Napped' };
    for (var j = 0; j < segs.length; j++) {
      if (!segs[j][1]) continue;
      var span = document.createElement('span');
      var sw = document.createElement('i');
      sw.className = 'swatch';
      sw.style.background = 'var(--c-' + segs[j][0] + ')';
      if (segs[j][0] === 'untracked') sw.style.opacity = '.45';
      span.appendChild(sw);
      span.appendChild(document.createTextNode(names[segs[j][0]] + ' '));
      var b = document.createElement('b');
      b.textContent = Math.round(segs[j][1] / all * 100) + '%';
      span.appendChild(b);
      key.appendChild(span);
    }
    host.appendChild(key);

    var v = document.createElement('p');
    v.className = 'ratio__verdict';
    if (p + w === 0) v.textContent = 'Nothing tagged kept or lost yet.';
    else {
      var share = Math.round(p / (p + w) * 100);
      v.textContent = share >= 50
        ? share + '% of the time you tagged went somewhere you meant it to.'
        : 'Only ' + share + '% of your tagged time went where you wanted it. More is being lost than kept.';
    }
    host.appendChild(v);

    // the unlogged stretch, stated once rather than drawn as a fourth category
    if (u > 0) {
      var un = document.createElement('p');
      un.className = 'ratio__untracked';
      un.textContent = T.hm(u) + ' went untracked on top of this — never tagged either way.';
      host.appendChild(un);
    }
  }

  /** You type a label on nearly every entry and the record never asked what
      they added up to. Ranked, per tag, over whatever period is showing. */
  function renderLabels(d) {
    var host = el.labels;
    while (host.firstChild) host.removeChild(host.firstChild);

    var cols = [['kept', 'productive'], ['lost', 'wasted']];
    var any = false;

    for (var c = 0; c < cols.length; c++) {
      var tag = cols[c][1];
      var map = d.labels[tag] || {};
      var list = Object.keys(map).map(function (k) { return { label: k, min: map[k] }; })
        .sort(function (a, b) { return b.min - a.min; });
      if (list.length) any = true;

      var col = document.createElement('div');
      col.className = 'labels__col';

      var head = document.createElement('p');
      head.className = 'labels__head';
      head.textContent = cols[c][0];
      col.appendChild(head);

      if (!list.length) {
        col.appendChild(empty('labels__none', 'nothing yet'));
        host.appendChild(col);
        continue;
      }

      var top = list[0].min;
      var shown = list.slice(0, 6);
      for (var i = 0; i < shown.length; i++) {
        col.appendChild(labelRow(shown[i], top, tag));
      }
      if (list.length > shown.length) {
        var rest = 0;
        for (var k = shown.length; k < list.length; k++) rest += list[k].min;
        var more = document.createElement('p');
        more.className = 'labels__more';
        more.textContent = '+ ' + (list.length - shown.length) + ' more · ' + T.hm(rest);
        col.appendChild(more);
      }
      host.appendChild(col);
    }

    if (!any) {
      while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(empty('leak__empty', 'Nothing logged in this period yet.'));
    }
  }

  function labelRow(item, top, tag) {
    var row = document.createElement('div');
    row.className = 'labelrow';
    row.dataset.tag = tag;

    var name = document.createElement('span');
    name.className = 'labelrow__name';
    name.textContent = item.label;
    name.title = item.label;

    var track = document.createElement('span');
    track.className = 'labelrow__track';
    var fill = document.createElement('span');
    fill.className = 'labelrow__fill';
    fill.style.width = (top > 0 ? (item.min / top * 100) : 0).toFixed(1) + '%';
    track.appendChild(fill);

    var val = document.createElement('span');
    val.className = 'labelrow__val';
    val.textContent = T.hm(item.min);

    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(val);
    return row;
  }

  function renderLeak(d) {
    var host = el.leak;
    while (host.firstChild) host.removeChild(host.firstChild);

    var cols = d.leakCols;
    var max = 0;
    for (var i = 0; i < cols; i++) max = Math.max(max, d.leak[i]);

    if (!max) {
      host.appendChild(empty('leak__empty', period === 'day'
        ? 'No wasted time logged today. Good.'
        : 'No wasted time logged in this period. Good.'));
      return;
    }

    var grid = document.createElement('div');
    grid.className = 'leak__grid';
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    var worst = 0, worstV = -1;
    for (var h = 0; h < cols; h++) {
      var cell = document.createElement('div');
      cell.className = 'leak__cell' + (h + 6 >= 20 ? ' leak__cell--late' : '');
      cell.style.opacity = (0.07 + 0.93 * (d.leak[h] / max)).toFixed(3);
      cell.title = T.pad(h + 6) + ':00 — ' + T.hm(d.leak[h]) + ' lost';
      grid.appendChild(cell);
      if (d.leak[h] > worstV) { worstV = d.leak[h]; worst = h; }
    }
    host.appendChild(grid);

    var hours = document.createElement('div');
    hours.className = 'leak__hours';
    hours.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    for (var q = 0; q < cols; q++) {
      var s = document.createElement('span');
      s.textContent = (q % 2 === 0) ? ((q + 6) % 24) : '';
      hours.appendChild(s);
    }
    host.appendChild(hours);

    var note = document.createElement('p');
    note.className = 'leak__note';
    note.textContent = 'Worst hour: ' + T.pad((worst + 6) % 24) + ':00–' + T.pad((worst + 7) % 24) +
      ':00, ' + T.hm(worstV) + ' lost ' + (period === 'day' ? 'today.' : 'across this period.');
    host.appendChild(note);
  }

  function empty(cls, text) {
    var p = document.createElement('p');
    p.className = cls;
    p.textContent = text;
    return p;
  }

  /* ── data in and out ────────────────────────────────── */

  function doExport() {
    var blob = new Blob([S.exportJSON()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'terrarium-' + S.todayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* Import used to replace every day the instant a file was picked, with no
     confirmation and nothing to fall back on. Now the file is only inspected;
     nothing is written until the count of what is about to go is shown and
     accepted, and the previous data is kept for one undo. */
  var pendingImport = null;

  function doImport(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var look = S.inspectImport(String(reader.result));
        pendingImport = look.parsed;
        el.confirmMsg.textContent =
          'Replace ' + look.current.days + ' ' + plural(look.current.days, 'day') +
          ' and ' + look.current.entries + ' ' + plural(look.current.entries, 'entry', 'entries') +
          ' with ' + look.incoming.days + ' ' + plural(look.incoming.days, 'day') +
          ' and ' + look.incoming.entries + ' ' + plural(look.incoming.entries, 'entry', 'entries') + '?';
        el.confirm.removeAttribute('hidden');
      } catch (err) {
        pendingImport = null;
        window.alert('Could not read that file. ' + err.message);
      }
      ev.target.value = '';
    };
    reader.readAsText(file);
  }

  function plural(n, one, many) { return n === 1 ? one : (many || one + 's'); }

  function closeConfirm() {
    pendingImport = null;
    el.confirm.setAttribute('hidden', '');
  }

  function doRestore() {
    if (!S.restoreBackup()) {
      window.alert('There is no earlier copy to go back to.');
      return;
    }
    TM.app.refresh();
    render();
  }

  /** Says plainly whether the last write reached disk. */
  function renderSaveState() {
    var h = S.health();
    if (!el.saveState) return;

    el.saveState.classList.toggle('is-bad', !!h.error);
    if (h.error) {
      el.saveState.textContent = h.error;
    } else if (h.sandbox) {
      el.saveState.textContent = 'Sandbox — writing to ' + h.key + ', your real data is untouched.';
    } else if (h.lastSaved) {
      el.saveState.textContent = 'Saved ' + agoText(h.lastSaved) + '.';
    } else {
      el.saveState.textContent = 'Every change saves as you make it.';
    }

    if (h.backup) el.restoreBtn.removeAttribute('hidden');
    else el.restoreBtn.setAttribute('hidden', '');
  }

  function agoText(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60);
    return m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago';
  }

  TM.dashboard = { init: init, render: render };
})(window.TM = window.TM || {});
