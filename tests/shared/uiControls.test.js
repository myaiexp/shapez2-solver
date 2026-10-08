// Sidebar readers and starting-shape rows (audit #11351 / #11353) — run with:
//   node tests/shared/uiControls.test.js
//
// Solve and Explore share one parser per numeric field. The row builder is the
// markup the remove handler and applyState both use, so the classes live here
// rather than being re-stated in main.js.
import { createShapeItem, setStartingShapes, readStartingShapes, readMaxLayers, readLevelBudget, readHeuristicDivisor } from '../../uiControls.js';
import { SHAPE_LABEL_CLASS } from '../../domConstants.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

function checkEqual(name, actual, expected) {
    total++;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}\n    expected: ${e}\n    actual:   ${a}`); failed = true; }
}

function noopCtx() {
    return new Proxy({}, {
        get(_t, prop) {
            if (prop === 'canvas') return {};
            return () => noopCtx();
        },
        set() { return true; },
    });
}

class El {
    constructor(id = '') {
        this.id = id;
        this.value = '';
        this.children = [];
        this.dataset = {};
        this.textContent = '';
        const set = new Set();
        this.classList = {
            contains: (c) => set.has(c),
            add: (c) => set.add(c),
        };
        Object.defineProperty(this, 'className', {
            get: () => [...set].join(' '),
            set: (v) => {
                set.clear();
                for (const c of String(v).split(/\s+/).filter(Boolean)) set.add(c);
            },
        });
    }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...kids) { this.children = []; for (const k of kids) this.children.push(k); }
    getContext() { return noopCtx(); }
}

const els = new Map();
function add(id) { const el = new El(id); els.set(id, el); return el; }
const list = add('starting-shapes');
add('max-layers');
add('max-states-per-level');
add('heuristic-divisor');

function walk(el, pred, out = []) {
    if (pred(el)) out.push(el);
    for (const child of el.children || []) walk(child, pred, out);
    return out;
}

globalThis.document = {
    getElementById: (id) => els.get(id) ?? null,
    createElement: () => new El(),
    querySelectorAll: (sel) => {
        if (sel === `#starting-shapes .shape-item .${SHAPE_LABEL_CLASS}`) {
            return walk(list, (el) => el.classList.contains('shape-item'))
                .flatMap((item) => walk(item, (el) => el !== item && el.classList.contains(SHAPE_LABEL_CLASS)));
        }
        throw new Error(`unhandled selector ${sel}`);
    },
};

{
    const row = createShapeItem('RuRuRuRu');
    check('row is a shape-item', row.classList.contains('shape-item'));
    const labels = walk(row, (el) => el.classList.contains(SHAPE_LABEL_CLASS));
    const removes = walk(row, (el) => el.classList.contains('remove-shape'));
    checkEqual('row label carries the code', labels.map((el) => el.textContent), ['RuRuRuRu']);
    check('row has one remove button', removes.length === 1 && removes[0].dataset.shape === 'RuRuRuRu' && removes[0].textContent === '×');
}

{
    list.appendChild(createShapeItem('CuCuCuCu'));
    setStartingShapes(['SuSuSuSu', 'WuWuWuWu']);
    checkEqual('setStartingShapes replaces the list', readStartingShapes(), ['SuSuSuSu', 'WuWuWuWu']);
    checkEqual('setStartingShapes([]) clears the list', (setStartingShapes([]), readStartingShapes()), []);
}

for (const [read, id, blank, zero, set, value] of [
    [readMaxLayers, 'max-layers', 4, '0', '6', 6],
    [readLevelBudget, 'max-states-per-level', 1000, '0', '2500', 2500],
    [readHeuristicDivisor, 'heuristic-divisor', 0.1, '0', '2', 2],
]) {
    els.get(id).value = '';
    checkEqual(`${id} blank → ${blank}`, read(), blank);
    els.get(id).value = zero;
    checkEqual(`${id} ${zero} → ${blank}`, read(), blank);
    els.get(id).value = set;
    checkEqual(`${id} ${set} → ${value}`, read(), value);
}

delete globalThis.document;

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
