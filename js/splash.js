/* splash.js — the threshold, and the way through it.

   The plant here is the real one: the same leaf shapes, the same geometry table
   and the same unfurl transition that vessel B runs when you log productive
   time. It grows the species you actually chose, so the door shows you your own
   terrarium rather than a stock one.

   Everything else about the sequence is CSS. This file builds the leaves, sets
   the stagger, and gets out of the way. */
(function (TM) {
  'use strict';

  var S = TM.store;

  var LEAF_STEP = 90;      // ms between one leaf and the next
  var LEAF_START = 1150;   // after the stem has finished drawing itself

  var el = {};
  var done = false;

  function init(onOpen) {
    el.splash = document.getElementById('splash');
    if (!el.splash) return;

    el.go = document.getElementById('splashGo');
    el.plant = document.getElementById('splashPlant');
    el.leaves = document.getElementById('splashLeaves');

    document.body.classList.add('is-splashing');

    grow();

    el.go.addEventListener('click', function () { open(onOpen); });
    // Enter and Space come free with a <button>; Escape is the other thing a
    // dialog is expected to answer to.
    document.addEventListener('keydown', function (ev) {
      if (!done && ev.key === 'Escape') { ev.preventDefault(); open(onOpen); }
    });

    // focus the way out, so the keyboard lands somewhere useful
    requestAnimationFrame(function () { el.go.focus(); });
  }

  /** Builds the chosen species bare, then lets it unfurl from the base up. */
  function grow() {
    var species = (S.settings() && S.settings().species) || 'fern';
    el.plant.setAttribute('data-species', species);

    var leaves = TM.plant.buildLeaves(el.leaves, species);

    for (var i = 0; i < leaves.length; i++) {
      leaves[i].classList.add('is-ungrown');
      // The list is built tip-first so the big lower leaves overlap the small
      // upper ones, so the delay reads off the leaf's own index rather than its
      // position in the DOM — otherwise it would unfurl from the top down.
      var order = +leaves[i].dataset.i;
      leaves[i].style.setProperty('--grow-delay', (LEAF_START + order * LEAF_STEP) + 'ms');
    }

    // one class change, and the staggered transition-delays do the rest
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        for (var j = 0; j < leaves.length; j++) leaves[j].classList.remove('is-ungrown');
      });
    });
  }

  function open(onOpen) {
    if (done) return;
    done = true;

    el.splash.classList.add('is-leaving');
    document.body.classList.remove('is-splashing');
    if (onOpen) onOpen();

    var finish = function () {
      el.splash.setAttribute('hidden', '');
      // the leaves keep swaying behind a hidden element otherwise
      while (el.leaves.firstChild) el.leaves.removeChild(el.leaves.firstChild);
    };
    // matches the .5s leave transition; the timeout is the backstop for when
    // transitionend never fires because motion is reduced to nothing
    el.splash.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 700);
  }

  TM.splash = { init: init };
})(window.TM = window.TM || {});
