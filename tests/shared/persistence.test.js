// Standalone tests for persistence.js — run with: node tests/shared/persistence.test.js
//
// Covers the localStorage-backed save/load surface (audit #2218 — previously
// only exercised as a bare JSON.parse(JSON.stringify(...)) round-trip in
// smoke.js, which never imported persistence.js, called its functions, or
// touched a storage backend). Here we drive the real loadState/saveState
// against a minimal in-memory localStorage stub (getItem/setItem/removeItem),
// the standard way to test browser-storage code headlessly since Node has no
// localStorage.
//
// Scope: loadState + saveState are the storage-only functions. captureState and
// applyState read/write the live DOM (querySelector, getElementById,
// dispatchEvent, classList) and are out of scope for a localStorage suite —
// they'd need a full document stub, not a storage stub.
//
// The import itself is also a smoke check: persistence.js defines $/$all/byId as
// document-using closures but never calls them at module load, so importing it
// with NO document present must succeed.
import { loadState, saveState, STORAGE_KEY, SCHEMA_VERSION } from '../../persistence.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name}`);
        failed = true;
    }
}

function checkEqual(name, actual, expected) {
    total++;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name}\n    expected: ${e}\n    actual:   ${a}`);
        failed = true;
    }
}

// Minimal localStorage: an in-memory object behind the Web Storage methods the
// module uses. getItem returns null for absent keys and setItem coerces values
// to strings, mirroring the real API (the module always stores JSON strings).
function makeLocalStorage() {
    let store = {};
    return {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { store = {}; },
        // test-only peek at the backing object
        _raw: (k) => store[k],
    };
}

function withLocalStorage(stub) {
    globalThis.localStorage = stub;
}

// A well-formed state shaped like captureState's output: version + inputs + view
// are the three fields loadState validates before returning.
function validState() {
    return {
        version: SCHEMA_VERSION,
        inputs: { target: 'CuRuSuWu', searchMethod: 'A*', preventWaste: true },
        solution: { solutionPath: [], depth: 1, statesExplored: 7, solveTimeSec: '0.01' },
        view: { activeSidebarTab: 'options', activeOutputView: 'flowchart', blueprintFloor: 0 },
    };
}

check('imports without a document present', typeof loadState === 'function' && typeof saveState === 'function');
check('STORAGE_KEY is the v1 key', STORAGE_KEY === 'shapez2-solver-state-v1');
check('SCHEMA_VERSION is 1', SCHEMA_VERSION === 1);

// --- Round trip: save then load returns the stored value -------------------
{
    withLocalStorage(makeLocalStorage());
    const state = validState();
    saveState(state);
    checkEqual('round-trip: load returns exactly what was saved', loadState(), state);
}

// saveState writes JSON under the exported STORAGE_KEY (not some other key).
{
    const ls = makeLocalStorage();
    withLocalStorage(ls);
    const state = validState();
    saveState(state);
    check('save writes under STORAGE_KEY', ls._raw(STORAGE_KEY) === JSON.stringify(state));
}

// A later save overwrites the earlier one (no stale merge).
{
    withLocalStorage(makeLocalStorage());
    const first = validState();
    const second = validState();
    second.inputs.target = 'RuRuRuRu';
    saveState(first);
    saveState(second);
    checkEqual('save overwrites the previous value', loadState(), second);
}

// --- Nothing stored returns null (documented default) ----------------------
{
    withLocalStorage(makeLocalStorage());
    checkEqual('load with empty storage returns null', loadState(), null);
}

// --- Malformed / corrupt stored JSON is handled gracefully (no throw) -------
{
    const ls = makeLocalStorage();
    ls.setItem(STORAGE_KEY, '{ this is : not json');
    withLocalStorage(ls);
    let threw = false;
    let result;
    try {
        result = loadState();
    } catch {
        threw = true;
    }
    check('corrupt JSON does not throw', !threw);
    checkEqual('corrupt JSON loads as null', result, null);
}

// JSON that parses but to a non-object (the `!state` guard) — e.g. literal null.
{
    const ls = makeLocalStorage();
    ls.setItem(STORAGE_KEY, 'null');
    withLocalStorage(ls);
    checkEqual('stored "null" literal loads as null', loadState(), null);
}

// Valid JSON, wrong schema version → rejected (forward/backward incompat).
{
    const ls = makeLocalStorage();
    const stale = validState();
    stale.version = 999;
    ls.setItem(STORAGE_KEY, JSON.stringify(stale));
    withLocalStorage(ls);
    checkEqual('wrong schema version loads as null', loadState(), null);
}

// Valid JSON + right version but missing required `inputs`/`view` → rejected.
{
    const ls = makeLocalStorage();
    ls.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, view: {} }));
    withLocalStorage(ls);
    checkEqual('state missing inputs loads as null', loadState(), null);

    ls.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, inputs: {} }));
    checkEqual('state missing view loads as null', loadState(), null);
}

// --- Clear / remove behavior ----------------------------------------------
// persistence.js exposes no clear() — clearing is external (the browser or the
// user wiping site data). After removeItem the key is absent, so loadState must
// fall back to the no-saved-state default (null), same as a fresh storage.
{
    const ls = makeLocalStorage();
    withLocalStorage(ls);
    saveState(validState());
    check('precondition: state present before clear', loadState() !== null);
    ls.removeItem(STORAGE_KEY);
    checkEqual('load after removeItem returns null', loadState(), null);
}

// --- Storage backend throwing is swallowed, never propagated ---------------
// loadState wraps getItem in try/catch (e.g. SecurityError in some browsers);
// a throwing getItem must surface as null, not an exception.
{
    withLocalStorage({
        getItem: () => { throw new Error('getItem blocked'); },
        setItem: () => {},
        removeItem: () => {},
    });
    let threw = false;
    let result;
    try {
        result = loadState();
    } catch {
        threw = true;
    }
    check('load with throwing getItem does not throw', !threw);
    checkEqual('load with throwing getItem returns null', result, null);
}

// saveState wraps setItem in try/catch (e.g. QuotaExceededError); a throwing
// setItem must be swallowed (warned), never propagated to the caller.
{
    withLocalStorage({
        getItem: () => null,
        setItem: () => { throw new Error('quota exceeded'); },
        removeItem: () => {},
    });
    const originalWarn = console.warn;
    console.warn = () => {}; // silence the expected warning during the assertion
    let threw = false;
    try {
        saveState(validState());
    } catch {
        threw = true;
    } finally {
        console.warn = originalWarn;
    }
    check('save with throwing setItem does not throw', !threw);
}

delete globalThis.localStorage;

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
