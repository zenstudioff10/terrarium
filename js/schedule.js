/* schedule.js — what is already spoken for.

   Pure, like js/energy.js: no DOM, no storage. It takes the routines and the
   day's own plans and answers two questions — how much of the day is booked,
   and how much of that is still ahead of you. */
(function (TM) {
  'use strict';

  var T = TM.time;

  /** Every block that applies to one day: the routines scheduled for that
      weekday, plus the one-off plans belonging to that day. */
  function blocksFor(dayKey, day, routines) {
    var weekday = T.weekdayOf(dayKey);
    var out = [];

    var list = routines || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var days = r.days || [];
      if (days.indexOf(weekday) === -1) continue;
      out.push({
        id: r.id, label: r.label, start: r.start, end: r.end,
        tag: r.tag || 'productive', source: 'routine'
      });
    }

    var plans = (day && day.plans) || [];
    for (var j = 0; j < plans.length; j++) {
      var p = plans[j];
      out.push({
        id: p.id, label: p.label, start: p.start, end: p.end,
        tag: p.tag || 'productive', source: 'plan'
      });
    }

    out.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return out;
  }

  /** Clip the blocks to the window, merge anything that overlaps, and measure.
      Merging is the whole point: a meeting booked inside a class must not be
      counted twice, or the free-time figure goes negative. */
  function summarise(blocks, startMin, endMin, nowMin) {
    var clipped = [];
    for (var i = 0; i < (blocks || []).length; i++) {
      var b = blocks[i];
      var s = Math.max(startMin, Math.min(endMin, b.start));
      var e = Math.max(startMin, Math.min(endMin, b.end));
      if (e > s) clipped.push([s, e]);
    }

    clipped.sort(function (a, b) { return a[0] - b[0]; });

    var merged = [];
    for (var k = 0; k < clipped.length; k++) {
      var last = merged[merged.length - 1];
      if (last && clipped[k][0] <= last[1]) {
        if (clipped[k][1] > last[1]) last[1] = clipped[k][1];
      } else {
        merged.push([clipped[k][0], clipped[k][1]]);
      }
    }

    // Before 06:00 the ledger day is over, so nothing is still ahead.
    var cursor = nowMin < T.WINDOW_START ? endMin : Math.max(startMin, Math.min(endMin, nowMin));

    var total = 0, ahead = 0;
    for (var m = 0; m < merged.length; m++) {
      total += merged[m][1] - merged[m][0];
      ahead += Math.max(0, merged[m][1] - Math.max(merged[m][0], cursor));
    }

    return { total: total, ahead: ahead, merged: merged };
  }

  /** Has this block finished, so it can offer to be logged? */
  function isPast(block, nowMin) {
    return nowMin < T.WINDOW_START || block.end <= nowMin;
  }

  function isNow(block, nowMin) {
    return nowMin >= T.WINDOW_START && block.start <= nowMin && nowMin < block.end;
  }

  TM.schedule = {
    blocksFor: blocksFor,
    summarise: summarise,
    isPast: isPast,
    isNow: isNow
  };
})(window.TM = window.TM || {});
