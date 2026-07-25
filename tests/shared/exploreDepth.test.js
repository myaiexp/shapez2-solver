// Standalone tests for exploreDepth.js — run with: node tests/shared/exploreDepth.test.js
//
// clampExploreDepth is the only bound on the space explorer's growth: the
// explorer BFS has no state cap, so every value that reaches shapeExplorer from
// the UI or a worker message has to come out of here inside [1, MAX]. The empty
// case is the one that matters most in practice — an untouched Depth field used
// to fall through to 999 (audit finding #5502).
import { clampExploreDepth, DEFAULT_EXPLORE_DEPTH, MAX_EXPLORE_DEPTH } from '../../exploreDepth.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, actual, expected) {
    total++;
    if (actual === expected) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name}\n    expected: ${expected}\n    actual:   ${actual}`);
        failed = true;
    }
}

// The bounds themselves: a default that finishes on any machine, and a ceiling
// low enough that the worst case is slow rather than fatal.
check('default is small', DEFAULT_EXPLORE_DEPTH <= 4 && DEFAULT_EXPLORE_DEPTH >= 1, true);
check('default is within the ceiling', DEFAULT_EXPLORE_DEPTH <= MAX_EXPLORE_DEPTH, true);

// Missing input -> default. `''` is what an untouched (or cleared) number input
// reports, and it must NOT coerce to 0-then-1: an empty field means "unset".
check('empty string -> default', clampExploreDepth(''), DEFAULT_EXPLORE_DEPTH);
check('whitespace -> default', clampExploreDepth('   '), DEFAULT_EXPLORE_DEPTH);
check('undefined -> default', clampExploreDepth(undefined), DEFAULT_EXPLORE_DEPTH);
check('null -> default', clampExploreDepth(null), DEFAULT_EXPLORE_DEPTH);
check('NaN -> default', clampExploreDepth(NaN), DEFAULT_EXPLORE_DEPTH);
check('non-numeric text -> default', clampExploreDepth('abc'), DEFAULT_EXPLORE_DEPTH);

// Valid input passes through untouched, from either a string field or a number.
check('numeric string passes through', clampExploreDepth('2'), 2);
check('number passes through', clampExploreDepth(5), 5);
check('ceiling value passes through', clampExploreDepth(MAX_EXPLORE_DEPTH), MAX_EXPLORE_DEPTH);

// Out of range -> clamped, never rejected: the explorer always gets a runnable
// depth, and no caller can request an unbounded one.
check('above max -> max', clampExploreDepth(999), MAX_EXPLORE_DEPTH);
check('Infinity -> max', clampExploreDepth(Infinity), MAX_EXPLORE_DEPTH);
check('zero -> 1', clampExploreDepth(0), 1);
check('negative -> 1', clampExploreDepth(-5), 1);
check('-Infinity -> 1', clampExploreDepth(-Infinity), 1);

// Fractional input is floored — a depth is a whole number of BFS levels.
check('fraction floors', clampExploreDepth(3.7), 3);
check('fraction below 1 floors then clamps', clampExploreDepth(0.5), 1);

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
