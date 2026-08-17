/* plant.js — turns the numbers into the two pictures.
   Geometry lives here; colour and motion live in plant.css.

   Vessel A is the future: water level is the time still on the clock.
   Vessel B is the past: it grows with the hours you kept, and its jar fills
   with the hours that are gone — ochre for wasted, grey for never logged. */
(function (TM) {
  'use strict';

  var T = TM.time;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // vessel interior, in view-box units — identical for both jars
  var WATER_BOTTOM = 552;
  var WATER_SPAN = 244;
  var WATER_TOP = WATER_BOTTOM - WATER_SPAN;

  /* Four plants, one table. Each is a stem drawn as a quadratic curve plus a
     rule for how its leaves sit on it — leaves hang off alternately, because
     opposite pairs read as clip-art and alternate is how most things grow.

     `stem` is the curve, `count` how many leaves, `shape` which silhouette,
     `a0`/`a1` the angle at the base and how much it opens toward the tip,
     `s0`/`s1` the same for scale. Colour is not here: the species picks a hue
     in tokens.css and the day's state decides how far it has travelled toward
     brown, so the two compose instead of being enumerated. */
  var SPECIES = {
    fern: {
      stem: { p0: [210, 300], p1: [221, 184], p2: [209, 72] },
      count: 10, shape: '#leafFern', a0: 16, a1: 42, s0: 1.14, s1: -0.66,
      w0: 4.2, w1: 1.3, tSpan: 0.86
    },
    ivy: {
      // a looser, wandering stem with broad leaves close in to it
      stem: { p0: [210, 300], p1: [176, 192], p2: [216, 80] },
      // Nine, not twelve, and splayed wider: at a tight angle the leaves
      // overlapped so heavily they merged into one lumpy column.
      count: 8, shape: '#leafIvy', a0: 50, a1: 28, s0: 0.92, s1: -0.32,
      w0: 3.4, w1: 1.1, tSpan: 0.88
    },
    jade: {
      // upright and sparse, with fat rounded pads on a thick trunk
      stem: { p0: [210, 300], p1: [212, 196], p2: [208, 96] },
      count: 8, shape: '#leafJade', a0: 38, a1: 24, s0: 1.06, s1: -0.28,
      w0: 6.2, w1: 2.4, tSpan: 0.84
    },
    grass: {
      // Barely a stem at all. The blades come off the bottom of it and fan
      // wide, which is what makes grass read as grass rather than as leaves
      // stuck up a stalk — tSpan keeps them near the base and the angle runs
      // from steep to shallow instead of the other way round.
      // The stem stops just above the blades. Run to the same height as the
      // others and it leaves a bare stalk poking out of the tuft.
      stem: { p0: [210, 300], p1: [210, 268], p2: [209, 240] },
      count: 13, shape: '#leafGrass', a0: 74, a1: -52, s0: 1.28, s1: -0.30,
      w0: 2.6, w1: 1.2, tSpan: 0.34,
      // grass has no fiddlehead to uncurl — the blade is the whole plant
      tip: false
    }
  };

  var DEFAULT_SPECIES = 'fern';
  var species = DEFAULT_SPECIES;

  function specOf(name) { return SPECIES[name] || SPECIES[DEFAULT_SPECIES]; }

  function onStem(stem, t) {
    var u = 1 - t;
    return [
      u * u * stem.p0[0] + 2 * u * t * stem.p1[0] + t * t * stem.p2[0],
      u * u * stem.p0[1] + 2 * u * t * stem.p1[1] + t * t * stem.p2[1]
    ];
  }

  /* The stem used to be one hardcoded stroke in the markup, shared by every
     species — so ivy, jade and grass had their leaves placed along a curve
     that was never actually drawn. It is built from the species' own curve
     now, and as a filled outline rather than a stroke, because a stroke is one
     width from end to end and a stem is not: it is thick where it leaves the
     water and fine at the growing tip. */
  function stemOutline(sp) {
    var steps = 26;
    var up = [], down = [];

    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var p = onStem(sp.stem, t);
      // derivative of the quadratic, for the normal
      var dx = 2 * (1 - t) * (sp.stem.p1[0] - sp.stem.p0[0]) + 2 * t * (sp.stem.p2[0] - sp.stem.p1[0]);
      var dy = 2 * (1 - t) * (sp.stem.p1[1] - sp.stem.p0[1]) + 2 * t * (sp.stem.p2[1] - sp.stem.p1[1]);
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len;

      // eased so the flare sits low rather than running the whole length
      var w = sp.w1 + (sp.w0 - sp.w1) * Math.pow(1 - t, 1.7);
      up.push([(p[0] + nx * w).toFixed(1), (p[1] + ny * w).toFixed(1)]);
      down.push([(p[0] - nx * w).toFixed(1), (p[1] - ny * w).toFixed(1)]);
    }

    var d = 'M' + up[0][0] + ' ' + up[0][1];
    for (var a = 1; a < up.length; a++) d += 'L' + up[a][0] + ' ' + up[a][1];
    for (var b = down.length - 1; b >= 0; b--) d += 'L' + down[b][0] + ' ' + down[b][1];
    return d + 'Z';
  }

  /** Where every leaf of a species sits, computed once per species. */
  function leavesFor(name) {
    var sp = specOf(name);
    var out = [];
    var span = sp.tSpan == null ? 0.86 : sp.tSpan;
    for (var i = 0; i < sp.count; i++) {
      var t = 0.05 + (i / (sp.count - 1)) * span;
      var pt = onStem(sp.stem, t);
      // a fixed, unrandom wobble so no two leaves sit at quite the same angle
      // a fixed, unrandom wobble so no two leaves sit at quite the same angle
      var jitterA = ((i % 3) - 1) * 4.4 + ((i % 5) - 2) * 1.8;
      var jitterS = (i % 2) ? -0.06 : 0.05;
      out.push({
        x: pt[0],
        y: pt[1],
        a: sp.a0 + sp.a1 * t + jitterA,
        s: (sp.s0 + sp.s1 * t) * (1 + jitterS),
        mirrored: i % 2 === 1,
        shape: sp.shape
      });
    }
    return out;
  }

  var left = {};    // vessel A refs
  var grown = {};   // vessel B refs
  var el = {};

  function svgEl(name, attrs) {
    var n = document.createElementNS(SVG_NS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  /** One leaf: translate → rotate/scale → droop → sway → shape.
      Each transform gets its own node so CSS and markup never fight. */
  function buildLeaf(spec, index) {
    var mirrored = spec.mirrored;
    var leaf = svgEl('g', { class: 'leaf' });
    leaf.dataset.i = index;

    var place = svgEl('g', {
      transform: 'translate(' + spec.x.toFixed(1) + ' ' + spec.y.toFixed(1) + ')' +
                 (mirrored ? ' scale(-1 1)' : '')
    });
    var arm = svgEl('g', { transform: 'rotate(' + (-spec.a).toFixed(1) + ') scale(' + spec.s.toFixed(3) + ')' });
    var droop = svgEl('g', { class: 'leaf__droop' });
    var sway = svgEl('g', { class: 'leaf__sway' });

    // A spent leaf has to end up pointing *down*, so the droop is measured
    // from this leaf's own angle rather than being one shared rotation.
    leaf.style.setProperty('--droop', (spec.a + 40).toFixed(1) + 'deg');

    sway.style.animationDelay = (-(index * 0.9) - (mirrored ? 0.45 : 0)).toFixed(2) + 's';
    sway.style.animationDuration = (7.4 + index * 0.32).toFixed(2) + 's';

    var use = svgEl('use', { href: spec.shape });
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', spec.shape);

    sway.appendChild(use);
    droop.appendChild(sway);
    arm.appendChild(droop);
    place.appendChild(arm);
    leaf.appendChild(place);
    return leaf;
  }

  function buildLeaves(host, name) {
    while (host.firstChild) host.removeChild(host.firstChild);
    var specs = leavesFor(name);
    var frag = document.createDocumentFragment();
    // drawn tip-first so the big lower leaves overlap the small upper ones
    for (var i = specs.length - 1; i >= 0; i--) {
      frag.appendChild(buildLeaf(specs[i], i));
    }
    host.appendChild(frag);
    return host.querySelectorAll('.leaf');
  }

  /** How many leaves this species has — the render maths counts in leaves. */
  function leafCount() { return specOf(species).count; }

  /* Graduations sit inside the glass. The vessel bellies out, so they are held
     at an x that stays within the wall at every one of the three heights. */
  function buildTicks(host) {
    var marks = [25, 50, 75];
    for (var i = 0; i < marks.length; i++) {
      var y = WATER_BOTTOM - (marks[i] / 100) * WATER_SPAN;
      host.appendChild(svgEl('line', {
        x1: 292, y1: y, x2: 304, y2: y, 'stroke-linecap': 'round'
      }));
      var t = svgEl('text', { x: 286, y: y + 3.4 });
      t.textContent = marks[i];
      host.appendChild(t);
    }
  }

  function init(name) {
    species = SPECIES[name] ? name : DEFAULT_SPECIES;

    left.svg = document.getElementById('plantLeft');
    left.water = document.getElementById('leftWater');
    left.nightLine = document.getElementById('leftNightLine');
    left.booked = document.getElementById('leftBooked');
    left.host = document.getElementById('leftLeaves');
    buildTicks(document.getElementById('leftTicks'));

    grown.svg = document.getElementById('plantGrown');
    grown.roots = document.getElementById('grownRoots');
    grown.sludge = document.getElementById('grownSludge');
    grown.haze = document.getElementById('grownHaze');
    grown.host = document.getElementById('grownLeaves');
    grown.ghostHost = document.getElementById('grownGhost');
    grown.targetLine = document.getElementById('grownTargetLine');
    buildTicks(document.getElementById('grownTicks'));

    el.napMark = document.getElementById('napMark');
    el.napMarkText = document.getElementById('napMarkText');
    el.strip = document.getElementById('dayStrip');

    setSpecies(species);
  }

  /** Rebuilds both jars. The ghost is the same plant fully grown, drawn faintly
      behind vessel B — an empty jar then shows the outline of the day you are
      aiming at, which reads as "not yet" rather than as a dead plant. */
  function setSpecies(name) {
    species = SPECIES[name] ? name : DEFAULT_SPECIES;
    var sp = specOf(species);

    left.svg.setAttribute('data-species', species);
    grown.svg.setAttribute('data-species', species);

    // every stem on the page, including the splash's and the ghost's
    var outline = stemOutline(sp);
    var tip = onStem(sp.stem, 1);
    var stems = document.querySelectorAll('.stem');
    for (var i = 0; i < stems.length; i++) stems[i].setAttribute('d', outline);
    var tips = document.querySelectorAll('.tip');
    for (var j = 0; j < tips.length; j++) {
      tips[j].setAttribute('transform', 'translate(' + tip[0].toFixed(1) + ' ' + tip[1].toFixed(1) + ')');
      if (sp.tip === false) tips[j].setAttribute('hidden', '');
      else tips[j].removeAttribute('hidden');
    }

    left.leaves = buildLeaves(left.host, species);
    grown.leaves = buildLeaves(grown.host, species);
    buildLeaves(grown.ghostHost, species);
  }

  /** Height in view-box units for a 0..1 share of the usable day.
      At zero the layer is pushed clear of the clip entirely — the wobbled top
      edge rises a few units above its own origin, and parked exactly on the
      floor it leaves a hairline of colour in a jar that holds nothing. */
  function fillY(pct) {
    var p = Math.min(Math.max(pct, 0), 1);
    if (p <= 0.001) return WATER_BOTTOM + 14;
    return WATER_BOTTOM - p * WATER_SPAN;
  }

  /* ── vessel A: what is still ahead ─────────────────────── */

  function renderLeft(e) {
    left.svg.setAttribute('data-state', e.state);
    left.svg.setAttribute('data-late', e.nightSpan > 0 ? 'true' : 'false');
    left.water.style.setProperty('--water-y', fillY(e.leftPct).toFixed(1) + 'px');

    // the part of the remaining water already spoken for — always a subset of
    // it, so this band sits inside the water rather than beside it
    left.booked.style.setProperty('--sed-y', fillY(e.bookedPct).toFixed(1) + 'px');

    // On a crammed night, mark where the normal day would have ended. Water
    // below this line is time you would not usually have had.
    if (e.nightSpan > 0) {
      left.nightLine.removeAttribute('hidden');
      left.nightLine.setAttribute('transform', 'translate(0 ' + fillY(e.nightMark).toFixed(1) + ')');
    } else {
      left.nightLine.setAttribute('hidden', '');
    }

    // leaves wilt from the tip down as the clock runs out
    var lit = Math.round(e.leftPct * leafCount());
    if (e.leftPct > 0 && lit === 0) lit = 1;   // never bare while there is time left
    for (var i = 0; i < left.leaves.length; i++) {
      left.leaves[i].classList.toggle('is-spent', +left.leaves[i].dataset.i >= lit);
    }
  }

  /* ── vessel B: what you have made of it ────────────────── */

  function renderGrown(e) {
    // roots reach down as far as the hours you kept
    grown.roots.style.setProperty('--root-off', (100 - e.grownPct * 100).toFixed(1));

    // the jar fills with everything that ate the ceiling: wasted at the bottom,
    // unlogged riding on top of it. The sludge is painted last, so the haze
    // body underneath it is hidden and only the band between them shows.
    var sludgeY = fillY(e.sludgePct);
    var hazeY = fillY(e.sludgePct + e.hazePct);
    grown.sludge.style.setProperty('--sed-y', sludgeY.toFixed(1) + 'px');
    grown.haze.style.setProperty('--sed-y', hazeY.toFixed(1) + 'px');

    // leaves appear from the base up as productive time accumulates —
    // the exact inverse of vessel A's wilt
    var grownCount = Math.round(e.grownPct * leafCount());
    if (e.productive > 0 && grownCount === 0) grownCount = 1;   // any work shows
    for (var i = 0; i < grown.leaves.length; i++) {
      grown.leaves[i].classList.toggle('is-ungrown', +grown.leaves[i].dataset.i >= grownCount);
    }

    // Where a full target day would reach. An empty jar should state its goal
    // rather than just being empty glass.
    if (e.target > 0 && e.usable > 0) {
      grown.targetLine.removeAttribute('hidden');
      grown.targetLine.setAttribute('transform',
        'translate(0 ' + fillY(Math.min(1, e.target / e.usable)).toFixed(1) + ')');
      grown.targetLine.setAttribute('data-met', e.targetMet ? 'true' : 'false');
    } else {
      grown.targetLine.setAttribute('hidden', '');
    }

    // nap marker — a neutral note in the clear glass above the fill
    if (e.napMin > 0) {
      el.napMark.removeAttribute('hidden');
      el.napMarkText.textContent = T.hm(e.napMin) + ' napped';
      var napY = Math.min(Math.max(hazeY - 24, WATER_TOP + 14), 470);
      el.napMark.setAttribute('transform', 'translate(0 ' + napY.toFixed(1) + ')');
    } else {
      el.napMark.setAttribute('hidden', '');
    }
  }

  /* ── the day laid out flat ─────────────────────────────── */

  var X0 = 14, X1 = 846, TRACK_Y = 6, TRACK_H = 16;
  var stripEnd = T.WINDOW_END;   // set per render, so the strip stretches with the day

  function xFor(min) {
    var W = stripEnd - T.WINDOW_START;
    var t = Math.max(0, Math.min(W, min - T.WINDOW_START));
    return X0 + (t / W) * (X1 - X0);
  }

  function renderStrip(day, e, nowMin, blocks) {
    var s = el.strip;
    while (s.firstChild) s.removeChild(s.firstChild);

    stripEnd = e.endMin;
    var r = TRACK_H / 2;

    s.appendChild(svgEl('rect', {
      class: 'strip__track', x: X0, y: TRACK_Y, width: X1 - X0, height: TRACK_H, rx: r
    }));

    // the morning you slept through — outside the window, not charged to you
    if (e.sleptIn > 0) {
      var wx = xFor(e.startMin);
      s.appendChild(svgEl('rect', {
        class: 'strip__asleep', x: X0, y: TRACK_Y, width: Math.max(0, wx - X0), height: TRACK_H, rx: r
      }));
      s.appendChild(svgEl('line', {
        class: 'strip__divide', x1: wx, y1: TRACK_Y - 3, x2: wx, y2: TRACK_Y + TRACK_H + 3
      }));
    }

    // the stretch past 20:00 gets its own tone, so a crammed day still reads
    // as a crammed day when you look back at it
    if (e.nightSpan > 0) {
      var nx = xFor(T.WINDOW_END);
      s.appendChild(svgEl('rect', {
        class: 'strip__night', x: nx, y: TRACK_Y, width: Math.max(0, X1 - nx), height: TRACK_H, rx: r
      }));
      s.appendChild(svgEl('line', {
        class: 'strip__divide', x1: nx, y1: TRACK_Y - 3, x2: nx, y2: TRACK_Y + TRACK_H + 3
      }));
    }

    // "spent" runs from when the day actually opened, not from 06:00
    var startX = xFor(e.startMin);
    var nowX = xFor(nowMin < T.WINDOW_START ? e.endMin : nowMin);
    s.appendChild(svgEl('rect', {
      class: 'strip__spent', x: startX, y: TRACK_Y,
      width: Math.max(0, nowX - startX), height: TRACK_H, rx: r
    }));

    // booked blocks, drawn under the entry marks so the strip shows the shape
    // of the day you have already committed to
    var bl = blocks || [];
    for (var b = 0; b < bl.length; b++) {
      var bx = xFor(bl[b].start), bw = xFor(bl[b].end) - bx;
      if (bw <= 0) continue;
      var band = svgEl('rect', {
        class: 'strip__booked', x: bx, y: TRACK_Y + 3, width: bw, height: TRACK_H - 6, rx: (TRACK_H - 6) / 2
      });
      var bt = document.createElementNS(SVG_NS, 'title');
      bt.textContent = (bl[b].label || 'booked') + ' · ' +
        T.clock(bl[b].start) + '–' + T.clock(bl[b].end % 1440);
      band.appendChild(bt);
      s.appendChild(band);
    }

    // one mark per entry, at the time it was logged
    var entries = day.entries || [];
    for (var i = 0; i < entries.length; i++) {
      var p = T.parts(new Date(entries[i].at));
      var mx = xFor(p.hour * 60 + p.minute);
      s.appendChild(svgEl('rect', {
        class: 'strip__mark strip__mark--' + entries[i].tag,
        x: mx - 2.2, y: TRACK_Y - 2, width: 4.4, height: TRACK_H + 4, rx: 2.2
      }));
    }

    if (e.phase === 'open') {
      s.appendChild(svgEl('line', {
        class: 'strip__now', x1: nowX, y1: TRACK_Y - 6, x2: nowX, y2: TRACK_Y + TRACK_H + 6
      }));
      s.appendChild(svgEl('circle', { class: 'strip__nowdot', cx: nowX, cy: TRACK_Y - 7, r: 2.6 }));
    }

    s.appendChild(svgEl('line', {
      class: 'strip__rule', x1: X0, y1: TRACK_Y + TRACK_H + 9, x2: X1, y2: TRACK_Y + TRACK_H + 9
    }));

    var lastHour = stripEnd / 60;
    for (var h = 6; h <= lastHour; h += 2) {
      var t = svgEl('text', {
        class: 'strip__hour' + (h > 20 ? ' strip__hour--late' : ''),
        x: xFor(h * 60),
        y: TRACK_Y + TRACK_H + 26,
        'text-anchor': h === 6 ? 'start' : (h === lastHour ? 'end' : 'middle')
      });
      t.textContent = T.pad(h % 24) + ':00';
      s.appendChild(t);
    }
  }

  TM.plant = {
    init: init,
    setSpecies: setSpecies,
    // the splash grows the real plant, so it needs the real builder
    buildLeaves: buildLeaves,
    species: function () { return species; },
    speciesNames: function () { return Object.keys(SPECIES); },
    renderLeft: renderLeft,
    renderGrown: renderGrown,
    renderStrip: renderStrip,
    svgEl: svgEl
  };
})(window.TM = window.TM || {});
