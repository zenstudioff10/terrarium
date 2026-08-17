/* energy.js — the whole model, as one pure function.
   Nothing here touches the DOM or storage, so every figure the UI shows
   can be traced back to a line in compute().

   Every term below is either a clock reading or a sum of logged minutes.
   Nothing in the past reduces the hours ahead: an hour you wasted has
   already cost you that hour by moving the clock, and charging it a
   second time against your future would be counting it twice. */
(function (TM) {
  'use strict';

  var T = TM.time;

  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }

  function sum(entries, tag) {
    var total = 0;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].tag === tag) total += entries[i].min;
    }
    return total;
  }

  /**
   * @param {{nightSleepMin:number, entries:Array}} day
   * @param {number} nowMin  minutes since Jakarta midnight
   */
  /**
   * @param {object} day
   * @param {number} nowMin  minutes since Jakarta midnight
   * @param {Array}  blocks  routines + plans already resolved for this day
   * @param {number} targetMin  productive hours you are aiming at, 0 for none
   */
  function compute(day, nowMin, blocks, targetMin) {
    var entries = (day && day.entries) || [];

    // 06:00 to 20:00 normally: later on a night you cram, later-starting on a
    // morning you sleep in. Hours spent asleep were never yours to spend, so
    // they leave the window rather than being charged against it.
    var endMin = T.endOf(day);
    var startMin = T.startOf(day);
    var W = endMin - startMin;
    var nightSpan = Math.max(0, endMin - T.WINDOW_END);      // the stretch past 20:00
    var sleptIn = Math.max(0, startMin - T.WINDOW_START);    // the morning you slept through

    var elapsed = T.elapsedInWindow(nowMin, endMin, startMin);
    var clockLeft = W - elapsed;               // the future. Nothing else touches this.

    var wasted = sum(entries, 'wasted');
    var productive = sum(entries, 'productive');
    var napMin = Math.min(sum(entries, 'sleep'), W);

    // How much of the work actually happened in the night stretch. Read off the
    // entry's own timestamp via parts(), not minuteOfDay() — the latter answers
    // "what time is it now" and is the seam a fixed clock gets injected at.
    var productiveLate = 0;
    var lastLogMin = null;
    for (var i = 0; i < entries.length; i++) {
      var at = T.parts(new Date(entries[i].at));
      var atMin = at.hour * 60 + at.minute;
      // an entry past midnight is the tail of this ledger day, not its dawn
      if (atMin < T.WINDOW_START) atMin += 1440;
      if (lastLogMin == null || atMin > lastLogMin) lastLogMin = atMin;
      if (entries[i].tag !== 'productive') continue;
      if (atMin >= T.WINDOW_END) productiveLate += entries[i].min;
    }

    // How long the log has been silent. With nothing logged at all it is the
    // whole day so far — that is the case worth speaking up about first.
    var cursor = Math.min(nowMin < T.WINDOW_START ? nowMin + 1440 : nowMin, endMin);
    var idleMin = lastLogMin == null
      ? elapsed
      : Math.max(0, Math.min(elapsed, cursor - lastLogMin));

    // A nap comes out of the day you had and hands the clock back, so it is
    // neither kept nor lost. Last night's sleep is recorded but never spent.
    var usable = W - napMin;
    var elapsedAdj = Math.max(0, elapsed - napMin);

    // A day you have not touched yet is a clean slate, not a deficit. Charging
    // someone for the hours before they opened the page would be the same
    // unfairness as counting days from before they started using this at all.
    var untracked = entries.length
      ? Math.max(0, elapsedAdj - productive - wasted)
      : 0;

    // The most productive hours you can still finish the day with.
    // Work an hour: productive rises as clockLeft falls, so this holds.
    // Waste an hour, or leave one unlogged: only clockLeft falls, so it drops
    // by exactly that hour. That is what an hour of waste actually costs.
    //
    // Derived from what has been lost rather than as `productive + clockLeft`.
    // The two are algebraically the same whenever the log is sane, but taking
    // the loss side keeps it honest at the edges too: an untouched day reads as
    // the whole window, and over-logging cannot promise more hours than exist.
    var ceilingLost = wasted + untracked;
    var ceiling = Math.max(0, usable - ceilingLost);

    // What is already spoken for. Booked hours are still hours you can be
    // productive in, so this deliberately leaves the ceiling alone — it answers
    // a different question: how much of the remainder is actually yours.
    var booked = TM.schedule.summarise(blocks || [], startMin, endMin, nowMin);
    var committedAhead = Math.min(booked.ahead, clockLeft);
    var freeLeft = Math.max(0, clockLeft - committedAhead);

    // The day's aim. Measuring growth against the whole window instead means a
    // superb six-hour day reads as 43% and the jar can never fill, so the
    // target is what the second plant actually grows toward.
    var target = Math.max(0, Math.min(targetMin || 0, usable));
    var targetLeft = Math.max(0, target - productive);
    var targetMet = target > 0 && productive >= target;
    // ceiling is the best you can still finish on, so this is exactly the
    // question "is the target still on"
    var targetReachable = target > 0 && ceiling >= target;

    var leftPct = W > 0 ? clamp(clockLeft / W, 0, 1) : 0;
    var phase = T.phase(nowMin, endMin);
    var state = stateFor(leftPct, phase);

    return {
      window: W,
      endMin: endMin,
      startMin: startMin,
      wakeMin: (day && day.wakeMin) != null ? day.wakeMin : null,
      sleptIn: sleptIn,
      nightSpan: nightSpan,
      productiveLate: productiveLate,
      // where 20:00 falls on the left jar's scale, once the day runs past it
      nightMark: W > 0 ? clamp(nightSpan / W, 0, 1) : 0,

      elapsed: elapsed,
      elapsedAdj: elapsedAdj,
      clockLeft: clockLeft,
      phase: phase,

      wasted: wasted,
      productive: productive,
      napMin: napMin,
      nightSleepMin: (day && day.nightSleepMin) || 0,
      untracked: untracked,
      tracked: wasted + productive,
      lastLogMin: lastLogMin,
      idleMin: idleMin,

      usable: usable,
      ceiling: ceiling,
      ceilingLost: ceilingLost,

      committedTotal: booked.total,
      committedAhead: committedAhead,
      freeLeft: freeLeft,

      // vessel A — the future
      leftPct: leftPct,
      bookedPct: W > 0 ? clamp(committedAhead / W, 0, 1) : 0,
      // vessel B — the past
      target: target,
      targetLeft: targetLeft,
      targetMet: targetMet,
      targetReachable: targetReachable,

      // grows toward the target when there is one, the whole day when there is not
      grownPct: target > 0
        ? clamp(productive / target, 0, 1)
        : (usable > 0 ? clamp(productive / usable, 0, 1) : 0),
      sludgePct: usable > 0 ? clamp(wasted / usable, 0, 1) : 0,
      hazePct:   usable > 0 ? clamp(untracked / usable, 0, 1) : 0,
      lostPct:   usable > 0 ? clamp(ceilingLost / usable, 0, 1) : 0,

      state: state
    };
  }

  function stateFor(pct, phase) {
    if (phase === 'closed' && pct <= 0.001) return 'spent';
    if (pct >= 0.7) return 'thriving';
    if (pct >= 0.4) return 'steady';
    if (pct >= 0.15) return 'fading';
    return 'spent';
  }

  /** Short read on how the day is going, shown under the figures. */
  function verdict(e) {
    if (e.phase === 'closed' && e.elapsed >= e.window) {
      if (!e.productive && !e.wasted) return 'Window closed. Nothing logged today.';
      return e.productive >= e.wasted
        ? 'Window closed. You kept ' + T.hm(e.productive) + ' of it.'
        : 'Window closed. Tomorrow opens at 06:00.';
    }
    if (e.targetMet) {
      return 'Target met — ' + T.hm(e.productive) + ' of a ' + T.hm(e.target) + ' day.';
    }
    if (!e.productive && !e.wasted && !e.untracked) return 'Nothing logged yet. The day is whole.';
    if (e.target > 0 && !e.targetReachable) {
      return T.hm(e.target) + ' is out of reach now. ' + T.hm(e.ceiling) + ' is the best left.';
    }
    if (e.lostPct <= 0.1) return 'The ceiling is holding. Keep going.';
    if (e.lostPct <= 0.3) {
      return e.wasted > e.untracked
        ? T.hm(e.wasted) + ' wasted so far. Still plenty of day.'
        : T.hm(e.untracked) + ' unlogged so far — it costs the same as waste.';
    }
    if (e.leftPct >= 0.35) return T.hm(e.ceilingLost) + ' off your best case. Recoverable.';
    return 'Ceiling is low. Pick one thing and finish it.';
  }

  TM.energy = { compute: compute, verdict: verdict, clamp: clamp };
})(window.TM = window.TM || {});
