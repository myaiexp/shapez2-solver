// Sidebar readers and starting-shape rows (audit #11351 / #11353) — run with:
//   node tests/ui/uiControls.test.js
//
// Solve and Explore share one reader per form field, each taking its id from
// FORM_FIELDS. The row builder is the markup the remove handler and applyState
// both use, so the classes live here rather than being re-stated in main.js.
import {
    FORM_FIELDS, createShapeItem, setStartingShapes, readStartingShapes, readMaxLayers,
    readTargetShape, readExploreDepth, readThroughputMultiplier, readSolveOptions, onFieldChange,
    syncSearchMethodControls, initExploreDepthInput,
} from '../../uiControls.js';
import { buildSolveRequest } from '../../solveRequest.js';
import { SHAPE_LABEL_CLASS } from '../../domConstants.js';
import { DEFAULT_EXPLORE_DEPTH, MAX_EXPLORE_DEPTH, DEFAULT_EXPLORE_MAX_NODES } from '../../exploreDepth.js';

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
        this.checked = false;
        this.style = {};
        this.children = [];
        this.dataset = {};
        this.textContent = '';
        this.listeners = [];
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
    addEventListener(type, fn) { this.listeners.push({ type, fn }); }
    // Each field sits in its own .option-group, which holds one <label>.
    closest(sel) {
        if (sel !== '.option-group') throw new Error(`unhandled closest ${sel}`);
        return (this.group ??= new El());
    }
    querySelector(sel) {
        if (sel !== 'label') throw new Error(`unhandled querySelector ${sel}`);
        return (this.label ??= new El());
    }
}

const els = new Map();
function add(id) { const el = new El(id); els.set(id, el); return el; }
const list = add('starting-shapes');
for (const { id } of Object.values(FORM_FIELDS)) add(id);
const field = (name) => els.get(FORM_FIELDS[name].id);

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

for (const [read, name, blank, zero, set, value] of [
    [readMaxLayers, 'maxLayers', 4, '0', '6', 6],
    [() => readSolveOptions().maxLayers, 'maxLayers', 4, '0', '6', 6],
    [() => readSolveOptions().budget, 'maxStatesPerLevel', 1000, '0', '2500', 2500],
    [() => readSolveOptions().heuristicDivisor, 'heuristicDivisor', 0.1, '0', '2', 2],
]) {
    field(name).value = '';
    checkEqual(`${name} blank → ${blank}`, read(), blank);
    field(name).value = zero;
    checkEqual(`${name} ${zero} → ${blank}`, read(), blank);
    field(name).value = set;
    checkEqual(`${name} ${set} → ${value}`, read(), value);
}

// The spread main.js does: each option has to land under the name
// buildSolveRequest destructures, or the request silently loses it.
{
    field('preventWaste').checked = true;
    field('orientationSensitive').checked = false;
    field('monolayerPainting').checked = true;
    field('filterUnusedShapes').checked = false;
    field('searchMethod').value = 'Constructive';
    field('maxLayers').value = '3';
    field('maxStatesPerLevel').value = '2500';
    field('heuristicDivisor').value = '2';
    const { request, filteredOut } = buildSolveRequest({
        targetShapeCode: 'CuCuCuCu',
        startingShapeCodes: ['RuRuRuRu'],
        enabledOperations: ['Cutter'],
        ...readSolveOptions(),
    });
    checkEqual('readSolveOptions fills the whole solve request', request, {
        targetShapeCode: 'CuCuCuCu',
        startingShapeCodes: ['RuRuRuRu'],
        enabledOperations: ['Cutter'],
        maxLayers: 3,
        maxStatesPerLevel: 2500,
        nodeBudget: 2500,
        preventWaste: true,
        orientationSensitive: false,
        monolayerPainting: true,
        heuristicDivisor: 2,
        searchMethod: 'Constructive',
    });
    checkEqual('an unticked filter checkbox keeps every starting shape', filteredOut, 0);
    field('filterUnusedShapes').checked = true;
    checkEqual('a ticked filter checkbox reaches buildSolveRequest', buildSolveRequest({
        targetShapeCode: 'CuCuCuCu',
        startingShapeCodes: ['RuRuRuRu'],
        enabledOperations: ['Cutter'],
        ...readSolveOptions(),
    }).filteredOut, 1);
}

field('target').value = '  CuCuCuCu\n';
checkEqual('readTargetShape trims', readTargetShape(), 'CuCuCuCu');
field('depthLimit').value = '12';
checkEqual('readExploreDepth leaves clamping to buildExploreRequest', readExploreDepth(), '12');
field('throughputMultiplier').value = '4';
checkEqual('readThroughputMultiplier returns the raw select value', readThroughputMultiplier(), '4');

{
    const events = [];
    onFieldChange('throughputMultiplier', () => events.push('fired'));
    const [listener] = field('throughputMultiplier').listeners;
    listener.fn();
    checkEqual('onFieldChange listens for change on the field', [listener.type, events], ['change', ['fired']]);
}

for (const [method, heuristic, budget, label] of [
    ['A*', 'block', 'none', 'Max States Per Level'],
    ['IDA*', 'block', 'none', 'Max States Per Level'],
    ['Bidirectional', 'block', 'none', 'Max States Per Level'],
    ['BFS', 'none', 'block', 'Max States Per Level'],
    ['Constructive', 'none', 'block', 'Node Search Budget'],
]) {
    field('searchMethod').value = method;
    syncSearchMethodControls();
    const budgetGroup = field('maxStatesPerLevel').closest('.option-group');
    checkEqual(`${method} shows the controls it uses`, [
        field('heuristicDivisor').closest('.option-group').style.display,
        budgetGroup.style.display,
        budgetGroup.querySelector('label').textContent,
    ], [heuristic, budget, label]);
}

{
    const input = field('depthLimit');
    input.value = '';
    initExploreDepthInput();
    checkEqual('an empty depth input gets the default and the bounds', [input.value, input.max, input.placeholder], [
        String(DEFAULT_EXPLORE_DEPTH), String(MAX_EXPLORE_DEPTH), `Depth (${DEFAULT_EXPLORE_DEPTH})`,
    ]);
    check('the depth title names the node cap', input.title.includes(String(DEFAULT_EXPLORE_MAX_NODES)), input.title);
    input.value = '3';
    initExploreDepthInput();
    checkEqual('a depth already in the input stays', input.value, '3');
}

delete globalThis.document;

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
