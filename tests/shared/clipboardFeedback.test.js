// Standalone tests for clipboardFeedback.js — run with: node tests/shared/clipboardFeedback.test.js
//
// Every clipboard action in the UI (graph/blueprint image copy, shape-code copy
// on a node click) reports its outcome on the #status line through this module.
// Clipboard writes fail routinely — permission denied, page not focused, no
// ClipboardItem, insecure context — so each failure mode must produce a message,
// and the transient message must hand the status line back without clobbering
// anything the solver wrote in the meantime.
import { copyText, copyImage, reportCopyFailure, FLASH_MS } from '../../clipboardFeedback.js';

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

const SOLVED = 'Solved in 0.10s at Depth 1 → 5 States';
const status = { textContent: SOLVED };
let statusPresent = true;
globalThis.document = { getElementById: (id) => (id === 'status' && statusPresent ? status : null) };

// Manual timer queue: the flash restore is driven explicitly, not by wall time.
const timers = [];
globalThis.setTimeout = (fn, ms) => {
    const t = { fn, ms, cleared: false };
    timers.push(t);
    return t;
};
globalThis.clearTimeout = (t) => { if (t) t.cleared = true; };
function runTimers() {
    for (const t of timers.splice(0)) if (!t.cleared) t.fn();
}

const errors = [];
console.error = (...args) => errors.push(args);

function setClipboard(clipboard) {
    Object.defineProperty(globalThis, 'navigator', {
        value: clipboard === undefined ? {} : { clipboard },
        configurable: true,
        writable: true,
    });
}
class FakeClipboardItem {
    constructor(items) { this.items = items; }
}

function reset() {
    runTimers();
    status.textContent = SOLVED;
    statusPresent = true;
    errors.length = 0;
    globalThis.ClipboardItem = FakeClipboardItem;
}

// --- copyText success, then the flash hands the line back ---
reset();
let written = null;
setClipboard({ writeText: async (t) => { written = t; } });
check('copyText resolves true on success', await copyText('CuCuCuCu', 'CuCuCuCu'), true);
check('copyText writes the text', written, 'CuCuCuCu');
check('success message shown on #status', status.textContent, 'Copied CuCuCuCu to clipboard.');
check('restore is scheduled for FLASH_MS', timers.at(-1)?.ms, FLASH_MS);
check('success is not logged as an error', errors.length, 0);
runTimers();
check('prior status restored after the flash', status.textContent, SOLVED);

// --- permission denied / unfocused document ---
reset();
setClipboard({
    writeText: async () => {
        throw Object.assign(new Error('Document is not focused.'), { name: 'NotAllowedError' });
    },
});
check('copyText resolves false on NotAllowedError', await copyText('CuCuCuCu', 'CuCuCuCu'), false);
check('denied message names the likely cause', status.textContent,
    "Couldn't copy CuCuCuCu: clipboard permission denied or the page was not focused.");
check('failure detail goes to console.error', errors.length, 1);
runTimers();
check('prior status restored after a failure flash', status.textContent, SOLVED);

// --- generic write error keeps its own message (no doubled period) ---
reset();
setClipboard({ writeText: async () => { throw new Error('Write blocked.'); } });
check('copyText resolves false on a generic error', await copyText('x', 'CuCuCuCu'), false);
check('generic error message is passed through', status.textContent, "Couldn't copy CuCuCuCu: Write blocked.");

// --- no Clipboard API at all (insecure context) ---
reset();
setClipboard(undefined);
check('copyText resolves false without navigator.clipboard', await copyText('x', 'CuCuCuCu'), false);
check('missing API explains the https requirement', status.textContent,
    "Couldn't copy CuCuCuCu: the clipboard is unavailable (it needs an https page).");

// --- image copy without ClipboardItem support: the export never runs ---
reset();
let wrote = false;
let exported = false;
setClipboard({ write: async () => { wrote = true; } });
delete globalThis.ClipboardItem;
check('copyImage resolves false without ClipboardItem',
    await copyImage(() => { exported = true; return {}; }, 'graph image'), false);
check('no ClipboardItem: the export is not started', exported, false);
check('no ClipboardItem: nothing is written', wrote, false);
check('no ClipboardItem message', status.textContent, "Couldn't copy graph image: this browser cannot copy images.");

// --- image copy from a Promise<Blob> (blueprint exportPng) ---
reset();
const blob = { size: 42 };
let writtenItems = null;
setClipboard({ write: async (items) => { writtenItems = items; } });
check('copyImage resolves true on success', await copyImage(() => Promise.resolve(blob), 'blueprint image'), true);
check('copyImage writes one ClipboardItem holding the PNG', writtenItems?.[0]?.items?.['image/png'], blob);
check('image success message', status.textContent, 'Copied blueprint image to clipboard.');

// --- image copy from a plain Blob (cytoscape png) ---
reset();
writtenItems = null;
check('copyImage accepts a plain Blob', await copyImage(() => blob, 'graph image'), true);
check('plain Blob is written as-is', writtenItems?.[0]?.items?.['image/png'], blob);

// --- export produced nothing (canvas.toBlob -> null) ---
reset();
check('copyImage resolves false on a null export', await copyImage(() => Promise.resolve(null), 'graph image'), false);
check('null export message', status.textContent, "Couldn't copy graph image: the image export produced no data.");

// --- export itself rejected / threw ---
reset();
check('copyImage resolves false when the export rejects',
    await copyImage(() => Promise.reject(new Error('No layout to export')), 'blueprint image'), false);
check('rejected export message', status.textContent, "Couldn't copy blueprint image: No layout to export.");
reset();
check('copyImage resolves false when the export throws',
    await copyImage(() => { throw new Error('canvas tainted'); }, 'graph image'), false);
check('thrown export message', status.textContent, "Couldn't copy graph image: canvas tainted.");

// --- a status write during the flash owns the line ---
reset();
setClipboard({ writeText: async () => {} });
await copyText('CuCuCuCu', 'CuCuCuCu');
status.textContent = 'Solving...';
runTimers();
check('restore skipped when status changed during the flash', status.textContent, 'Solving...');

// --- chained flashes restore the pre-flash text, not the first flash ---
reset();
setClipboard({ writeText: async (t) => { if (t === 'bad') throw new Error('nope'); } });
await copyText('ok', 'A');
const firstTimer = timers.at(-1);
await copyText('bad', 'B');
check('second flash replaces the first', status.textContent, "Couldn't copy B: nope.");
check('first flash timer is cancelled', firstTimer.cleared, true);
runTimers();
check('chained flashes restore the original status', status.textContent, SOLVED);

// --- explicit failure report (nothing to copy) ---
reset();
reportCopyFailure('graph image', 'there is no graph yet');
check('reportCopyFailure message', status.textContent, "Couldn't copy graph image: there is no graph yet.");
runTimers();
check('reportCopyFailure flash restores', status.textContent, SOLVED);

// --- no #status element: copying still works and does not throw ---
reset();
statusPresent = false;
setClipboard({ writeText: async () => {} });
check('copyText works without a #status element', await copyText('x', 'CuCuCuCu'), true);

console.log(`\n${passed}/${total} checks passed`);
if (failed) process.exit(1);
