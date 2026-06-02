// Standalone tests for colorMode.js — run with: node tests/colorMode.test.js
//
// The point of this suite is to prove the circular import was broken (audit
// #2423): colorMode.js must import in a plain Node process WITHOUT a DOM. If it
// re-exported from main.js (the old shape), this very import line would throw
// `ReferenceError: document is not defined`, because main.js wires document
// event handlers at module-evaluation time. The fact that the import below
// succeeds at all is the cycle-break proof. Behavior is then exercised against a
// minimal `document` stub — getCurrentColorMode reads the live <select> value.
import { getCurrentColorMode } from '../colorMode.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, actual, expected) {
    total++;
    const match = actual === expected;
    if (match) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name}\n    expected: ${expected}\n    actual:   ${actual}`);
        failed = true;
    }
}

// Importing colorMode.js above required no `document` — this is the proof that
// the shapeRendering/operationGraph2D -> main.js cycle no longer drags the DOM
// entry point (and its eval-time document access) into the rendering layer.
check('imports without a DOM (cycle broken)', typeof getCurrentColorMode, 'function');

// Default: selector absent (or no value) -> 'rgb' fallback.
globalThis.document = { getElementById: () => null };
check('defaults to rgb when selector is absent', getCurrentColorMode(), 'rgb');

// Live read: the returned mode reflects the current <select> value each call.
let selectValue = 'cmyk';
globalThis.document = { getElementById: () => ({ value: selectValue }) };
check('reads cmyk from the live selector', getCurrentColorMode(), 'cmyk');
selectValue = 'ryb';
check('re-reads ryb after the selector changes', getCurrentColorMode(), 'ryb');

delete globalThis.document;

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
