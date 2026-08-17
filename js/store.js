/* store.js — localStorage persistence and a tiny change bus. */
(function (TM) {
  'use strict';

  var T = TM.time;

  /* Your real data lives under tm.v1 and nothing may write over it casually.
     Loading the page with ?sandbox swaps the whole store onto a throwaway key,
     which is how this gets tested from now on — seeding fake weeks into the
     live key is what put real entries at risk. */
  var SANDBOX = /[?&]sandbox\b/.test(location.search);
  var KEY = SANDBOX ? 'tm.sandbox' : 'tm.v1';
  var BAK = KEY + '.bak';

  // surfaced in the UI so a failed write is never silent
  var lastSaved = null;
  var saveError = null;

  var DEFAULTS = {
    v: 1,
    days: {},
    // Routines repeat, so they belong to no single day and live at the root.
    routines: [],
    // So do tasks: a checklist that emptied itself at 06:00 would not be one.
    // They stay until you tick them, and stay visible until you clear them.
    tasks: [],
    activeTimer: null,
    settings: {
      windowStart: '06:00',
      windowEnd: '20:00',
      tz: 'Asia/Jakarta',
      // The productive hours you are aiming at. The grown jar measures against
      // this rather than the whole window, which is what lets it ever fill.
      targetMin: 360,
      // 'auto' keeps the original behaviour — the page dims when your window
      // closes. 'light' and 'dark' pin it regardless of the hour.
      theme: 'auto',
      // which plant grows in both jars — geometry in js/plant.js, hue in tokens
      species: 'fern',
      // the little P / W / S / 1 / 2 / 3 / T pills on the buttons. Hiding them
      // never disables the keys — bindKeys() does not consult this.
      showKeys: false
    }
  };

  var state = null;
  var listeners = [];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function migrate(raw) {
    var s = Object.assign(clone(DEFAULTS), raw || {});
    s.settings = Object.assign(clone(DEFAULTS.settings), (raw && raw.settings) || {});
    s.days = (raw && raw.days) || {};
    s.routines = (raw && raw.routines) || [];
    // Explicit, because this function rebuilds state field by field — leaving
    // it out is exactly how a new root array silently empties on every reload.
    s.tasks = (raw && raw.tasks) || [];
    s.v = 1;
    return s;
  }

  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY)); }
    catch (e) { raw = null; }
    state = migrate(raw);
    return state;
  }

  /* A write can genuinely fail — quota, private mode, a blocked origin. This
     used to swallow the error, so the app carried on looking fine while
     nothing reached disk. Now it records the failure for the UI to show. */
  function save() {
    var payload;
    try {
      payload = JSON.stringify(state);
    } catch (e) {
      saveError = 'Could not read your data back out to save it.';
      emit();
      return false;
    }

    try {
      localStorage.setItem(KEY, payload);
      lastSaved = Date.now();
      saveError = null;
    } catch (e) {
      saveError = (e && e.name === 'QuotaExceededError')
        ? 'Storage is full — nothing new is being saved.'
        : 'This browser is not letting the page save.';
    }
    emit();
    return !saveError;
  }

  /** Keep the current contents aside before something destructive. */
  function snapshot() {
    try {
      var cur = localStorage.getItem(KEY);
      if (cur) localStorage.setItem(BAK, cur);
      return true;
    } catch (e) { return false; }
  }

  function backupInfo() {
    var raw = null;
    try { raw = localStorage.getItem(BAK); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var p = JSON.parse(raw);
      return { days: Object.keys(p.days || {}).length, bytes: raw.length };
    } catch (e) { return null; }
  }

  function restoreBackup() {
    var raw = null;
    try { raw = localStorage.getItem(BAK); } catch (e) { return false; }
    if (!raw) return false;
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return false; }
    snapshot();                 // so restoring is itself undoable
    state = migrate(parsed);
    return save();
  }

  function health() {
    return {
      key: KEY,
      sandbox: SANDBOX,
      lastSaved: lastSaved,
      error: saveError,
      backup: backupInfo()
    };
  }

  /** Counts, for showing what an import is about to replace. */
  function census(obj) {
    var days = Object.keys((obj && obj.days) || {});
    var entries = 0;
    for (var i = 0; i < days.length; i++) {
      entries += (((obj.days[days[i]] || {}).entries) || []).length;
    }
    return { days: days.length, entries: entries };
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) listeners[i](state);
  }

  function subscribe(fn) { listeners.push(fn); return fn; }

  // endMin is per day: cramming late is an exception, so tomorrow opens back
  // at the normal 20:00 while past days keep whatever end they actually had.
  // wakeMin is null until you say otherwise, meaning the window opens at 06:00.
  function blankDay() {
    return { nightSleepMin: 0, wakeMin: null, endMin: T.WINDOW_END, entries: [], plans: [] };
  }

  /** Read-only view of a day; never writes. */
  function getDay(key) {
    return state.days[key] || blankDay();
  }

  /** Writable day, created on demand. */
  function ensureDay(key) {
    if (!state.days[key]) state.days[key] = blankDay();
    return state.days[key];
  }

  function todayKey() { return T.dayKey(new Date()); }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function addEntry(tag, minutes, label, at) {
    var min = Math.max(1, Math.round(minutes));
    var when = at || new Date().toISOString();
    var key = T.dayKey(new Date(when));
    var entry = {
      id: uid(),
      tag: tag,
      min: min,
      label: (label || '').trim(),
      at: when
    };
    ensureDay(key).entries.push(entry);
    save();
    return { key: key, entry: entry };
  }

  function removeEntry(key, id) {
    var day = state.days[key];
    if (!day) return null;
    for (var i = 0; i < day.entries.length; i++) {
      if (day.entries[i].id === id) {
        var gone = day.entries.splice(i, 1)[0];
        save();
        return gone;
      }
    }
    return null;
  }

  /** Change an entry in place. Moving its time can push it into another ledger
      day — 05:00 belongs to the morning before — so the entry moves with it
      rather than being stranded under the wrong date. */
  function updateEntry(key, id, patch) {
    var day = state.days[key];
    if (!day) return null;

    var idx = -1;
    for (var i = 0; i < day.entries.length; i++) {
      if (day.entries[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return null;

    var entry = day.entries[idx];
    if (patch.min != null) entry.min = Math.max(1, Math.round(patch.min));
    if (patch.label != null) entry.label = String(patch.label).trim();
    if (patch.tag) entry.tag = patch.tag;

    var landedOn = key;
    if (patch.at) {
      entry.at = patch.at;
      var moved = T.dayKey(new Date(patch.at));
      if (moved !== key) {
        day.entries.splice(idx, 1);
        ensureDay(moved).entries.push(entry);
        landedOn = moved;
      }
    }

    save();
    return { key: landedOn, entry: entry };
  }

  function restoreEntry(key, entry) {
    ensureDay(key).entries.push(entry);
    ensureDay(key).entries.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    save();
  }

  function setNightSleep(key, minutes) {
    ensureDay(key).nightSleepMin = Math.max(0, Math.round(minutes));
    save();
  }

  /* ── routines and plans ─────────────────────────────── */

  function routines() { return state.routines; }

  function addRoutine(block) {
    state.routines.push({
      id: uid(),
      label: (block.label || '').trim(),
      start: block.start,
      end: block.end,
      tag: block.tag || 'productive',
      days: (block.days || []).slice().sort()
    });
    save();
  }

  function removeRoutine(id) {
    for (var i = 0; i < state.routines.length; i++) {
      if (state.routines[i].id === id) { state.routines.splice(i, 1); save(); return; }
    }
  }

  /** Returns the block it created, like addEntry — a task needs the id back so
      it can tell whether the block it produced is still there. */
  /* ── tasks ──────────────────────────────────────────── */

  function tasks() { return state.tasks; }

  function addTask(t) {
    var task = {
      id: uid(),
      label: (t.label || '').trim(),
      startMin: t.startMin == null ? null : Math.max(0, Math.round(t.startMin)),
      min: t.min == null ? null : Math.max(1, Math.round(t.min)),
      done: false,
      doneAt: null,
      logged: false,
      plannedOn: null,
      planId: null
    };
    state.tasks.push(task);
    save();
    return task;
  }

  function findTask(id) {
    for (var i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === id) return state.tasks[i];
    }
    return null;
  }

  function updateTask(id, patch) {
    var t = findTask(id);
    if (!t) return null;
    // null is a real value here — it clears a time rather than skipping it
    if (patch.hasOwnProperty('label')) t.label = String(patch.label).trim();
    if (patch.hasOwnProperty('startMin')) {
      t.startMin = patch.startMin == null ? null : Math.max(0, Math.round(patch.startMin));
    }
    if (patch.hasOwnProperty('min')) {
      t.min = patch.min == null ? null : Math.max(1, Math.round(patch.min));
    }
    if (patch.hasOwnProperty('logged')) t.logged = !!patch.logged;
    if (patch.hasOwnProperty('plannedOn')) t.plannedOn = patch.plannedOn;
    if (patch.hasOwnProperty('planId')) t.planId = patch.planId;
    save();
    return t;
  }

  function setTaskDone(id, done) {
    var t = findTask(id);
    if (!t) return null;
    t.done = !!done;
    t.doneAt = t.done ? new Date().toISOString() : null;
    save();
    return t;
  }

  function removeTask(id) {
    for (var i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === id) {
        var gone = state.tasks.splice(i, 1)[0];
        save();
        return gone;
      }
    }
    return null;
  }

  /** Clears the ticked ones only. Returns them, so it can be undone. */
  function clearDoneTasks() {
    var gone = [];
    state.tasks = state.tasks.filter(function (t) {
      if (t.done) { gone.push(t); return false; }
      return true;
    });
    save();
    return gone;
  }

  function restoreTasks(list) {
    for (var i = 0; i < list.length; i++) state.tasks.push(list[i]);
    save();
  }

  function addPlan(key, block) {
    var day = ensureDay(key);
    if (!day.plans) day.plans = [];
    var made = {
      id: uid(),
      label: (block.label || '').trim(),
      start: block.start,
      end: block.end,
      tag: block.tag || 'productive'
    };
    day.plans.push(made);
    save();
    return { key: key, block: made };
  }

  function removePlan(key, id) {
    var day = state.days[key];
    if (!day || !day.plans) return;
    for (var i = 0; i < day.plans.length; i++) {
      if (day.plans[i].id === id) { day.plans.splice(i, 1); save(); return; }
    }
  }

  function setTheme(mode) {
    state.settings.theme = (mode === 'light' || mode === 'dark') ? mode : 'auto';
    save();
  }

  function setShowKeys(on) {
    state.settings.showKeys = !!on;
    save();
  }

  function setSpecies(name) {
    state.settings.species = name || 'fern';
    save();
  }

  function setTarget(minutes) {
    state.settings.targetMin = Math.max(0, Math.round(minutes));
    save();
  }

  function setWakeTime(key, minutes) {
    ensureDay(key).wakeMin = minutes == null ? null : Math.max(0, Math.round(minutes));
    save();
  }

  function setWindowEnd(key, minutes) {
    ensureDay(key).endMin = T.endOf({ endMin: minutes });
    save();
  }

  function setTimer(timer) {
    state.activeTimer = timer;
    save();
  }

  /** Day keys that hold anything, oldest first. */
  function dayKeys() {
    return Object.keys(state.days).filter(function (k) {
      var d = state.days[k];
      return (d.entries && d.entries.length) || d.nightSleepMin;
    }).sort();
  }

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  /** Parse and check a file without committing to it, so the UI can say
      exactly what is about to be replaced before anything is lost. */
  function inspectImport(text) {
    var parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !parsed.days) {
      throw new Error('That file does not look like a Terrarium export.');
    }
    return { parsed: parsed, incoming: census(parsed), current: census(state) };
  }

  function applyImport(parsed) {
    snapshot();                 // the old data is one click away afterwards
    state = migrate(parsed);
    return save();
  }

  TM.store = {
    KEY: KEY,
    load: load,
    save: save,
    subscribe: subscribe,
    state: function () { return state; },
    settings: function () { return state.settings; },
    getDay: getDay,
    todayKey: todayKey,
    addEntry: addEntry,
    removeEntry: removeEntry,
    updateEntry: updateEntry,
    restoreEntry: restoreEntry,
    setNightSleep: setNightSleep,
    setWakeTime: setWakeTime,
    routines: routines,
    addRoutine: addRoutine,
    tasks: tasks,
    addTask: addTask,
    updateTask: updateTask,
    setTaskDone: setTaskDone,
    removeTask: removeTask,
    clearDoneTasks: clearDoneTasks,
    restoreTasks: restoreTasks,
    removeRoutine: removeRoutine,
    addPlan: addPlan,
    removePlan: removePlan,
    setWindowEnd: setWindowEnd,
    setTarget: setTarget,
    setTheme: setTheme,
    setSpecies: setSpecies,
    setShowKeys: setShowKeys,
    setTimer: setTimer,
    dayKeys: dayKeys,
    exportJSON: exportJSON,
    inspectImport: inspectImport,
    applyImport: applyImport,
    snapshot: snapshot,
    restoreBackup: restoreBackup,
    health: health
  };
})(window.TM = window.TM || {});
