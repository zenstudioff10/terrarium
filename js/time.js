/* time.js — everything clock-related, always resolved in Asia/Jakarta (WIB)
   regardless of the device's timezone. */
(function (TM) {
  'use strict';

  var TZ = 'Asia/Jakarta';
  var WINDOW_START = 6 * 60;      // 06:00 — fixed, and the day also rolls here
  var WINDOW_END = 20 * 60;       // 20:00 — the normal close
  var WINDOW_MAX = 24 * 60;       // 00:00 — as late as a crammed night may run
  var WINDOW = WINDOW_END - WINDOW_START; // 840 minutes, the normal length

  /** A day may run late. Anything past 20:00 is the night stretch.
      Capped at midnight so the 06:00 rollover can never be crossed. */
  function endOf(day) {
    var end = (day && day.endMin) || WINDOW_END;
    return Math.max(WINDOW_END, Math.min(WINDOW_MAX, end));
  }

  /** Sleeping in trims the front of the window. Those hours were never yours
      to spend, so they are removed rather than held against you. */
  function startOf(day) {
    var wake = day && day.wakeMin;
    if (wake == null) return WINDOW_START;
    return Math.max(WINDOW_START, Math.min(endOf(day), wake));
  }

  function windowLength(endMin, startMin) {
    return (endMin || WINDOW_END) - (startMin == null ? WINDOW_START : startMin);
  }

  var partsFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });

  var labelFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short'
  });

  /** Break a Date into Jakarta calendar/clock parts. */
  function parts(date) {
    var out = {};
    var list = partsFmt.formatToParts(date || new Date());
    for (var i = 0; i < list.length; i++) {
      if (list[i].type !== 'literal') out[list[i].type] = list[i].value;
    }
    return {
      year: +out.year,
      month: +out.month,
      day: +out.day,
      hour: +out.hour % 24,
      minute: +out.minute,
      second: +out.second
    };
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function ymdKey(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  /** Shift a YYYY-MM-DD key by whole days. */
  function shiftKey(key, days) {
    var bits = key.split('-');
    var t = Date.UTC(+bits[0], +bits[1] - 1, +bits[2]) + days * 86400000;
    var d = new Date(t);
    return ymdKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  /** Minutes since Jakarta midnight. */
  function minuteOfDay(date) {
    var p = parts(date);
    return p.hour * 60 + p.minute;
  }

  /** The day a moment belongs to. The ledger day rolls at 06:00, not midnight,
      so a 01:00 session still lands on the day that started the morning before. */
  function dayKey(date) {
    var p = parts(date);
    var key = ymdKey(p.year, p.month, p.day);
    if (p.hour * 60 + p.minute < WINDOW_START) key = shiftKey(key, -1);
    return key;
  }

  /** Minutes of the window already burned, given minutes-since-midnight.
      Before 06:00 we are past the tail of the previous ledger day, so it is spent. */
  function elapsedInWindow(nowMin, endMin, startMin) {
    var start = startMin == null ? WINDOW_START : startMin;
    var W = windowLength(endMin, start);
    // Before 06:00 we are past the tail of the previous ledger day, whatever
    // time that day happened to start.
    if (nowMin < WINDOW_START) return W;
    return Math.max(0, Math.min(W, nowMin - start));
  }

  function phase(nowMin, endMin) {
    if (nowMin < WINDOW_START || nowMin >= (endMin || WINDOW_END)) return 'closed';
    return 'open';
  }

  /** 145 -> "2h 25m", 60 -> "1h", 0 -> "0m" */
  function hm(min) {
    var m = Math.max(0, Math.round(min));
    var h = Math.floor(m / 60);
    var r = m % 60;
    if (!h) return r + 'm';
    if (!r) return h + 'h';
    return h + 'h ' + r + 'm';
  }

  /** 145 -> "2.4" — the compact decimal used for big figures (unit rendered separately). */
  function hours(min) {
    return (Math.max(0, min) / 60).toFixed(1);
  }

  /** 862 -> "14:22" */
  function clock(min) {
    var m = ((Math.round(min) % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }

  /** "1h30", "90", "1.5h", "45m", "2 hours" -> minutes. Returns 0 when unreadable. */
  function parseDuration(raw) {
    var s = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!s) return 0;

    var h = 0, m = 0, found = false;
    var mh = s.match(/(\d+(?:[.,]\d+)?)\s*h/);
    if (mh) { h = parseFloat(mh[1].replace(',', '.')); found = true; }

    var mm = s.match(/(\d+(?:[.,]\d+)?)\s*m/);
    if (mm) { m = parseFloat(mm[1].replace(',', '.')); found = true; }
    else if (mh) {
      // a bare number trailing the hours, e.g. "1h30"
      var rest = s.slice(s.indexOf('h') + 1).match(/(\d+)/);
      if (rest) m = parseFloat(rest[1]);
    }

    if (!found) {
      var bare = s.match(/(\d+(?:[.,]\d+)?)/);
      if (!bare) return 0;
      m = parseFloat(bare[1].replace(',', '.'));
    }

    var total = Math.round(h * 60 + m);
    return isFinite(total) && total > 0 ? total : 0;
  }

  /** "6:40", "06:40", "0640", "640", "9" -> minutes since midnight. null if unreadable. */
  function parseClock(raw) {
    var digits = String(raw == null ? '' : raw).replace(/[^\d]/g, '');
    if (!digits) return null;

    var h, m;
    if (digits.length <= 2)      { h = +digits; m = 0; }
    else if (digits.length === 3) { h = +digits.slice(0, 1); m = +digits.slice(1); }
    else if (digits.length === 4) { h = +digits.slice(0, 2); m = +digits.slice(2); }
    else return null;

    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  }

  /** The real instant of a given minute-of-day on a given date key.
      WIB is UTC+7 with no DST, so the offset is fixed; Date.UTC carries the
      overflow, which is what makes minute 1440 land on the following midnight
      and minute 360 land at 06:00 local. */
  function stampAt(key, minutes) {
    var b = key.split('-');
    return new Date(Date.UTC(+b[0], +b[1] - 1, +b[2], Math.floor(minutes / 60) - 7, minutes % 60));
  }

  /** A clock reading (0–23:59) placed on the ledger day that owns it. The day
      rolls at 06:00, so 01:30 is the tail of the day before and sits at minute
      1530 of it — not 90. `stampAt` counts from the key's own calendar date,
      so without this a backfilled 01:30 would land 24 hours early. */
  function ledgerMinute(clockMin) {
    return clockMin < WINDOW_START ? clockMin + 1440 : clockMin;
  }

  /** 0 = Sunday … 6 = Saturday, read off the date key itself so it cannot
      drift with whatever timezone the machine happens to be in. */
  function weekdayOf(key) {
    var b = key.split('-');
    return new Date(Date.UTC(+b[0], +b[1] - 1, +b[2])).getUTCDay();
  }

  function dayLabel(key) {
    var bits = key.split('-');
    return labelFmt.format(new Date(Date.UTC(+bits[0], +bits[1] - 1, +bits[2], 6)));
  }

  /** Jakarta hour (0-23) an ISO timestamp fell on. */
  function hourOf(iso) {
    return parts(new Date(iso)).hour;
  }

  TM.time = {
    TZ: TZ,
    WINDOW_START: WINDOW_START,
    WINDOW_END: WINDOW_END,
    WINDOW_MAX: WINDOW_MAX,
    WINDOW: WINDOW,
    endOf: endOf,
    startOf: startOf,
    windowLength: windowLength,
    parseClock: parseClock,
    weekdayOf: weekdayOf,
    stampAt: stampAt,
    ledgerMinute: ledgerMinute,
    parts: parts,
    pad: pad,
    shiftKey: shiftKey,
    minuteOfDay: minuteOfDay,
    dayKey: dayKey,
    elapsedInWindow: elapsedInWindow,
    phase: phase,
    hm: hm,
    hours: hours,
    clock: clock,
    parseDuration: parseDuration,
    dayLabel: dayLabel,
    hourOf: hourOf
  };
})(window.TM = window.TM || {});
