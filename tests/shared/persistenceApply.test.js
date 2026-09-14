// Standalone tests for persistence.js captureState/applyState — run with:
//   node tests/shared/persistenceApply.test.js
//
// These two read and write the live page (form fields, starting shapes, enabled
// ops, tabs, the graph/blueprint renderers), and main.js's DOMContentLoaded restore
// is their only production caller — a throw there wipes storage and reloads. Here
// they run against a fake `document` that mirrors index.html's ids/classes and
// fake renderer deps that record their calls. The fake document throws on any
// selector it doesn't know, so a selector change in persistence.js fails loudly
// instead of matching nothing; and every id persistence.js asks for is checked
// against the real index.html, so id drift can't silently skip a field.
// Storage load/save/clear and isValidSolutionPath live in persistence.test.js.
import { readFileSync } from 'node:fs';
import { captureState, applyState, SCHEMA_VERSION } from '../../persistence.js';
import { SHAPE_LABEL_CLASS } from '../../domConstants.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; } else { console.log(`✗ ${name}`); failed = true; }
}

function checkEqual(name, actual, expected) {
    total++;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) { console.log(`✓ ${name}`); passed++; } else {
        console.log(`✗ ${name}\n    expected: ${e}\n    actual:   ${a}`);
        failed = true;
    }
}

class FakeElement {
    constructor({ id = '', classes = [], value = '', checked = false, dataset = {}, textContent = '' } = {}) {
        Object.assign(this, { id, value, checked, dataset, textContent });
        const set = new Set(classes);
        this.classList = {
            add: (c) => set.add(c),
            remove: (c) => set.delete(c),
            contains: (c) => set.has(c),
            toggle: (c, force) => ((force ?? !set.has(c)) ? set.add(c) : set.delete(c), set.has(c)),
        };
        this.children = [];
        this.events = [];
    }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...kids) { this.children = kids; }
    // Records the element's value at dispatch time: main.js's search-method listener
    // reads it, so the change must fire after the fields are restored.
    dispatchEvent(ev) { this.events.push({ type: ev.type, value: this.value }); return true; }
}

const OPS = ['Rotator CW', 'Cutter', 'Stacker', 'Painter'];
const VALUE_FIELDS = {
    'target-shape': '', 'depth-limit-input': '5', 'search-method-select': 'A*',
    'max-states-per-level': '1000', 'heuristic-divisor': '1', 'throughput-multiplier': '1',
    'max-layers': '4', 'color-mode-select': 'rgb', 'direction-select': 'TB', 'edge-style-select': 'bezier',
};
const CHECK_FIELDS = ['prevent-waste', 'orientation-sensitive', 'monolayer-painting', 'filter-unused-shapes'];

function shapeItem(code) {
    const item = new FakeElement({ classes: ['shape-item'] });
    item.appendChild(new FakeElement({ classes: [SHAPE_LABEL_CLASS], textContent: code }));
    return item;
}

// The page as index.html ships it: shapes tab + flowchart view active, every op
// enabled, one default starting shape.
function makeDom() {
    const els = new Map();
    const add = (el) => (els.set(el.id, el), el);
    for (const [id, value] of Object.entries(VALUE_FIELDS)) add(new FakeElement({ id, value }));
    for (const id of CHECK_FIELDS) add(new FakeElement({ id, checked: false }));
    add(new FakeElement({ id: 'status', textContent: 'Ready' }));
    add(new FakeElement({ id: 'starting-shapes' })).appendChild(shapeItem('CuCuCuCu'));
    const ops = OPS.map((op) => new FakeElement({ classes: ['operation-item', 'enabled'], dataset: { operation: op } }));
    const group = (btnClass, contentClass, names, btnId, contentId) => ({
        btns: names.map((n, i) => add(new FakeElement({ id: btnId(n), classes: [btnClass, ...(i ? [] : ['active'])] }))),
        contents: names.map((n, i) => add(new FakeElement({ id: contentId(n), classes: [contentClass, ...(i ? [] : ['active'])] }))),
    });
    const sidebar = group('tab-button', 'tab-content', ['shapes', 'options'], (n) => `${n}-tab-btn`, (n) => `${n}-content`);
    const view = group('view-tab-button', 'view-tab-content', ['flowchart', 'blueprint'], (n) => `${n}-view-tab-btn`, (n) => `${n}-view`);
    const active = (list) => list.filter((e) => e.classList.contains('active'));
    const selectors = {
        '.tab-button': () => sidebar.btns,
        '.tab-content': () => sidebar.contents,
        '.tab-button.active': () => active(sidebar.btns),
        '.view-tab-button': () => view.btns,
        '.view-tab-content': () => view.contents,
        '.view-tab-button.active': () => active(view.btns),
        '#enabled-operations .operation-item': () => ops,
        '#enabled-operations .operation-item.enabled': () => ops.filter((e) => e.classList.contains('enabled')),
        [`#starting-shapes .shape-item .${SHAPE_LABEL_CLASS}`]: () => els.get('starting-shapes').children
            .filter((c) => c.classList.contains('shape-item'))
            .flatMap((c) => c.children.filter((l) => l.classList.contains(SHAPE_LABEL_CLASS))),
    };
    const requested = new Set();
    const query = (sel) => {
        if (!selectors[sel]) throw new Error(`fake document: unhandled selector ${sel}`);
        return selectors[sel]();
    };
    globalThis.document = {
        getElementById: (id) => (requested.add(id), els.get(id) ?? null),
        querySelector: (sel) => query(sel)[0] ?? null,
        querySelectorAll: query,
    };
    return {
        el: (id) => els.get(id),
        remove: (id) => els.delete(id),
        ops, requested,
        activeIds: () => [...active(sidebar.btns), ...active(sidebar.contents), ...active(view.btns), ...active(view.contents)].map((e) => e.id),
        enabledOps: () => ops.filter((e) => e.classList.contains('enabled')).map((e) => e.dataset.operation),
        shapeCodes: () => els.get('starting-shapes').children.map((c) => c.children[0].textContent),
    };
}

// Fake main.js deps. Each records its calls; BlueprintRenderer is main.js's job
// (applyState only forwards it), so constructing it here is a failure.
function makeDeps() {
    const calls = { renderGraph: [], applyGraphLayout: [], buildLayout: [], duplicateForThroughput: [], setBlueprintLayout: [], createShapeItem: [] };
    return {
        calls,
        renderGraph: (path) => calls.renderGraph.push(path),
        applyGraphLayout: (dir) => calls.applyGraphLayout.push(dir),
        buildLayout: (path) => (calls.buildLayout.push(path), { tag: 'layout', steps: path.length }),
        duplicateForThroughput: (layout, n) => (calls.duplicateForThroughput.push(n), { tag: 'dup', of: layout, n }),
        setBlueprintLayout: (layout) => calls.setBlueprintLayout.push(layout),
        createShapeItem: (code) => (calls.createShapeItem.push(code), shapeItem(code)),
        BlueprintRenderer: class { constructor() { throw new Error('applyState must not construct BlueprintRenderer'); } },
    };
}

const okPath = [{
    operation: 'Stacker',
    inputs: [{ id: 's0', shape: 'Cu------' }, { id: 's1', shape: '--Ru----' }],
    outputs: [{ id: 's2', shape: 'CuRu----' }],
}];
const solution = (solutionPath) => ({ solutionPath, depth: 3, statesExplored: 42, solveTimeSec: '0.25' });
const baseState = (inputs = {}, view = {}, sol = null) => ({ version: SCHEMA_VERSION, inputs, view, solution: sol });

// --- Round trip: capture a customised page, apply to a fresh one, recapture --
{
    const a = makeDom();
    a.el('target-shape').value = 'CuRuSuWu';
    a.el('search-method-select').value = 'IDA*';
    a.el('throughput-multiplier').value = '3';
    a.el('direction-select').value = 'LR';
    a.el('prevent-waste').checked = true;
    a.el('monolayer-painting').checked = true;
    a.el('starting-shapes').replaceChildren(shapeItem('RuRuRuRu'), shapeItem('SuSuSuSu'));
    a.ops[1].classList.remove('enabled');
    a.ops[3].classList.remove('enabled');
    a.activeIds().forEach((id) => a.el(id).classList.remove('active'));
    ['options-tab-btn', 'options-content', 'blueprint-view-tab-btn', 'blueprint-view'].forEach((id) => a.el(id).classList.add('active'));
    const runtime = { currentSolution: solution(okPath),currentBlueprintFloor: 2 };
    const captured = captureState(runtime);

    checkEqual('capture: inputs read from the live form', captured.inputs, {
        target: 'CuRuSuWu', depthLimit: '5', searchMethod: 'IDA*', maxStatesPerLevel: '1000', heuristicDivisor: '1',
        preventWaste: true, orientationSensitive: false, monolayerPainting: true, filterUnusedShapes: false,
        throughputMultiplier: '3', maxLayers: '4', colorMode: 'rgb',
        startingShapes: ['RuRuRuRu', 'SuSuSuSu'], enabledOperations: ['Rotator CW', 'Stacker'],
    });
    checkEqual('capture: view reads tabs, selects and floor', captured.view,
        { activeSidebarTab: 'options', activeOutputView: 'blueprint', graphDirection: 'LR', edgeStyle: 'bezier', blueprintFloor: 2 });
    check('capture: version and solution carried through', captured.version === SCHEMA_VERSION && captured.solution === runtime.currentSolution);

    const b = makeDom();
    const deps = makeDeps();
    const stored = JSON.parse(JSON.stringify(captured));
    const result = applyState(stored, deps);
    checkEqual('round trip: recapture after apply equals the original', captureState(runtime), captured);
    checkEqual('apply: returns restoredSolution + restoredFloor', result, { restoredSolution: true, restoredFloor: 2 });
    checkEqual('apply: starting shapes rebuilt via createShapeItem, in order', deps.calls.createShapeItem, ['RuRuRuRu', 'SuSuSuSu']);
    checkEqual('apply: search-method change fires once, after the value is restored',
        b.el('search-method-select').events, [{ type: 'change', value: 'IDA*' }]);
    checkEqual('apply: renderGraph gets the path; layout applied in saved direction',
        [deps.calls.renderGraph, deps.calls.applyGraphLayout], [[okPath], ['LR']]);
    checkEqual('apply: multiplier 3 duplicates the built layout for throughput',
        deps.calls.setBlueprintLayout, [{ tag: 'dup', of: { tag: 'layout', steps: 1 }, n: 3 }]);
    check('apply: status line reports the restored solve', b.el('status').textContent === 'Solved in 0.25s at Depth 3 → 42 States');

    const pageIds = new Set([...readFileSync(new URL('../../index.html', import.meta.url), 'utf8').matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    const missing = [...a.requested, ...b.requested].filter((id) => !pageIds.has(id));
    checkEqual('every id persistence.js looks up exists in index.html', missing, []);
}

// --- captureState fallbacks when the page lacks elements ------------------
{
    const dom = makeDom();
    dom.activeIds().forEach((id) => dom.el(id).classList.remove('active'));
    ['direction-select', 'edge-style-select', 'max-layers'].forEach((id) => dom.remove(id));
    const s = captureState({ currentSolution: null });
    checkEqual('capture: defaults when no tab is active and selects are absent', s.view,
        { activeSidebarTab: 'shapes', activeOutputView: 'flowchart', graphDirection: 'TB', edgeStyle: '', blueprintFloor: 0 });
    check('capture: an input missing from the page is omitted, not undefined', !('maxLayers' in s.inputs));
}

// --- Partial / corrupt-but-versioned inputs --------------------------------
{
    const dom = makeDom();
    const deps = makeDeps();
    applyState(baseState({ target: 'CuCu----', preventWaste: 1 }), deps);
    check('apply: saved value and truthy checkbox restored', dom.el('target-shape').value === 'CuCu----' && dom.el('prevent-waste').checked === true);
    check('apply: fields absent from inputs keep page defaults', dom.el('depth-limit-input').value === '5' && dom.el('monolayer-painting').checked === false);
    checkEqual('apply: absent startingShapes leaves the default shapes', [dom.shapeCodes(), deps.calls.createShapeItem], [['CuCuCuCu'], []]);
    checkEqual('apply: absent enabledOperations leaves every op enabled', dom.enabledOps(), OPS);
    checkEqual('apply: no solution → no renderer calls, restoredSolution false',
        [deps.calls.renderGraph.length, deps.calls.buildLayout.length, dom.el('status').textContent], [0, 0, 'Ready']);
}
{
    const dom = makeDom();
    const deps = makeDeps();
    applyState(baseState({ startingShapes: 'CuCu', enabledOperations: 'Cutter' }), deps);
    checkEqual('apply: string startingShapes is not iterated char-by-char', [dom.shapeCodes(), deps.calls.createShapeItem], [['CuCuCuCu'], []]);
    checkEqual('apply: string enabledOperations leaves ops untouched', dom.enabledOps(), OPS);
}
{
    const dom = makeDom();
    const deps = makeDeps();
    applyState(baseState({ startingShapes: ['RuRuRuRu', 42, null], enabledOperations: ['Cutter', 7] }), deps);
    checkEqual('apply: non-string list entries are dropped', [dom.shapeCodes(), dom.enabledOps()], [['RuRuRuRu'], ['Cutter']]);
}
{
    const dom = makeDom();
    applyState(baseState({ startingShapes: [], enabledOperations: [] }), makeDeps());
    checkEqual('apply: explicit [] clears shapes and disables every op', [dom.shapeCodes(), dom.enabledOps()], [[], []]);
}

// --- Tabs: a stale/unknown name must not leave a group with no active tab ---
{
    const dom = makeDom();
    applyState(baseState({}, { activeSidebarTab: 'bogus', activeOutputView: 'flowchart-view' }), makeDeps());
    checkEqual('apply: unknown tab names keep the current tabs active', dom.activeIds(),
        ['shapes-tab-btn', 'shapes-content', 'flowchart-view-tab-btn', 'flowchart-view']);
}

// --- Solution restore gate and throughput multiplier -----------------------
for (const [label, path] of [
    ['missing solutionPath', undefined],
    ['non-array solutionPath', 'nope'],
    ['Painter step without params.color', [{ operation: 'Painter', inputs: [{ id: 'a', shape: 'Cu------' }], outputs: [{ id: 'b', shape: 'Cr------' }] }]],
]) {
    const dom = makeDom();
    const deps = makeDeps();
    const result = applyState(baseState({ throughputMultiplier: '4' }, { graphDirection: 'LR' }, solution(path)), deps);
    const rendererCalls = ['renderGraph', 'applyGraphLayout', 'buildLayout', 'duplicateForThroughput', 'setBlueprintLayout']
        .reduce((n, k) => n + deps.calls[k].length, 0);
    check(`apply: ${label} is rejected before any renderer call`, rendererCalls === 0 && dom.el('status').textContent === 'Ready');
    check(`apply: ${label} reports restoredSolution false`, result.restoredSolution === false);
}
for (const [value, expected] of [['1', null], ['', null], ['abc', null], ['0', null], ['-2', null], [undefined, null], ['2', 2], ['2.9', 2]]) {
    makeDom();
    const deps = makeDeps();
    const inputs = value === undefined ? {} : { throughputMultiplier: value };
    applyState(baseState(inputs, {}, solution(okPath)), deps);
    const want = expected ? { tag: 'dup', of: { tag: 'layout', steps: 1 }, n: expected } : { tag: 'layout', steps: 1 };
    checkEqual(`apply: throughputMultiplier ${JSON.stringify(value)} → ${expected ? `duplicate ×${expected}` : 'no duplication'}`,
        deps.calls.setBlueprintLayout, [want]);
}
{
    makeDom();
    const deps = makeDeps();
    const result = applyState(baseState({}, {}, solution([])), deps);
    checkEqual('apply: empty path renders; no saved direction → no applyGraphLayout; floor defaults to 0',
        [deps.calls.renderGraph, deps.calls.applyGraphLayout, result], [[[]], [], { restoredSolution: true, restoredFloor: 0 }]);
}

delete globalThis.document;

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
