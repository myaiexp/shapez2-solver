// Flowchart tests — run with: node tests/shared/operationGraph2D.test.js
//
// buildGraphElements is the flowchart's whole structure (shape/op nodes, edges,
// Belt Split branch edges, colored-op styling) and runs without a DOM. renderGraph
// is then driven against document/cytoscape stubs to pin its cache contract: a
// cleared solve must never be redrawn by reRenderGraph (the edge-style handler).
import { existsSync } from 'node:fs';
import { buildGraphElements } from '../../operationGraphElements.js';
import { colorValues } from '../../shapeRenderingColors.js';
import { operations } from '../../shapeSolverOperations.js';
import { solveConstructive } from '../../shapeSolverConstructive.js';

let passed = 0, total = 0, failed = false;
function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? `\n    ${detail}` : ''}`); failed = true; }
}

const build = (path, colorMode = 'rgb') =>
    buildGraphElements(path, { shapeImage: (code) => `img:${code}`, colorMode });
const nodes = (els) => els.filter((e) => e.data.id !== undefined);
const edges = (els) => els.filter((e) => e.data.id === undefined);
const byId = (els, id) => els.find((e) => e.data.id === id);
const edgeKeys = (els) => edges(els)
    .map((e) => `${e.data.source}>${e.data.target}${e.classes ? `[${e.classes}]` : ''}`).sort();
const step = (operation, inputs, outputs, params = {}) => ({
    operation, params,
    inputs: inputs.map(([id, shape]) => ({ id, shape })),
    outputs: outputs.map(([id, shape]) => ({ id, shape })),
});

// --- empty paths --------------------------------------------------------------
check('null path builds no elements', build(null).length === 0);
check('empty path builds no elements', build([]).length === 0);

// --- a plain op step ----------------------------------------------------------
{
    const els = build([step('Cutter', [[0, 'CuRuSuWu']], [[4, 'CuRu----'], [5, '----SuWu']])]);
    const shapeNodes = nodes(els).filter((n) => n.classes === 'shape');
    check('one shape node per id', shapeNodes.map((n) => n.data.id).join() === 'shape-0,shape-4,shape-5');
    check('shape node carries its code and thumbnail',
        shapeNodes.every((n) => n.data.shapeCanvas === `img:${n.data.label}`) &&
        byId(els, 'shape-4').data.label === 'CuRu----');
    const op = byId(els, 'op-0');
    check('op node is labelled, plain-classed, and imaged',
        op?.data.label === 'Cutter' && op.classes === 'op' &&
        op.data.image === 'images/operations/cutter.png' && op.data.backgroundColor === '#000');
    check('edges run input → op → outputs',
        edgeKeys(els).join() === 'op-0>shape-4,op-0>shape-5,shape-0>op-0', edgeKeys(els).join());
}

// --- shape nodes are keyed by id, not code ------------------------------------
{
    const calls = [];
    const els = buildGraphElements([
        step('Rotator CW', [[0, 'Cu------']], [[1, '--Cu----']]),
        step('Stacker', [[1, '--Cu----'], [2, '--Cu----']], [[3, '--Cu----:--Cu----']]),
    ], { shapeImage: (code) => { calls.push(code); return code; }, colorMode: 'rgb' });
    check('an id produced then consumed is one node', nodes(els).filter((n) => n.data.id === 'shape-1').length === 1);
    check('two ids with the same code stay two nodes', !!byId(els, 'shape-1') && !!byId(els, 'shape-2'));
    check('thumbnail rendered once per node', calls.length === 4, `calls=${calls.length}`);
}

// --- Belt Split is edge-only --------------------------------------------------
{
    const els = build([
        step('Rotator CW', [[0, 'Cu------']], [[1, '--Cu----']]),
        step('Belt Split', [[1, '--Cu----']], [[2, '--Cu----'], [3, '--Cu----']]),
        step('Stacker', [[2, '--Cu----'], [3, '--Cu----']], [[4, '--Cu----:--Cu----']]),
    ]);
    const opIds = nodes(els).filter((n) => n.classes.startsWith('op')).map((n) => n.data.id);
    check('Belt Split gets no op node', opIds.join() === 'op-0,op-2', opIds.join());
    check('Belt Split draws shape → shape branch edges',
        edgeKeys(els).filter((k) => k.endsWith('[branch]')).join() === 'shape-1>shape-2[branch],shape-1>shape-3[branch]');
    check('split copies feed the next op',
        edgeKeys(els).includes('shape-2>op-2') && edgeKeys(els).includes('shape-3>op-2'));
}

// --- colored ops --------------------------------------------------------------
{
    const painter = (color, mode) => byId(build([step('Painter', [[0, 'CuCuCuCu']], [[1, 'CrCrCrCr']], { color })], mode), 'op-0');
    const rgb = painter('r', 'rgb');
    check('Painter label names its color', rgb.data.label === 'Painter (r)');
    check('Painter is colored from the rgb palette',
        rgb.classes === 'op colored-op' && rgb.data.backgroundColor === colorValues.rgb.r);
    const cmyk = painter('r', 'cmyk');
    check('color mode picks the palette',
        cmyk.data.backgroundColor === colorValues.cmyk.r && cmyk.data.backgroundColor !== rgb.data.backgroundColor);
    const unknown = painter('x', 'rgb');
    check('a color outside the palette keeps the label but not the tint',
        unknown.data.label === 'Painter (x)' && unknown.classes === 'op' && unknown.data.backgroundColor === '#000');
    const crystal = byId(build([step('Crystal Generator', [[0, 'P-P-P-P-']], [[1, 'cgcgcgcg']], { color: 'g' })]), 'op-0');
    check('Crystal Generator is a colored op too',
        crystal.data.label === 'Crystal Generator (g)' && crystal.classes === 'op colored-op');
    const rotator = byId(build([step('Rotator CW', [[0, 'Cu------']], [[1, '--Cu----']], { color: 'r' })]), 'op-0');
    check('a non-color op ignores params.color', rotator.data.label === 'Rotator CW' && rotator.classes === 'op');
}

// --- every op node points at a shipped image ----------------------------------
{
    const missing = Object.keys(operations)
        .filter((op) => op !== 'Belt Split')
        .map((op) => byId(build([step(op, [[0, 'CuCuCuCu']], [[1, 'CuCuCuCu']])]), 'op-0').data.image)
        .filter((image) => !existsSync(new URL(`../../${image}`, import.meta.url)));
    check('every op image exists under images/operations/', missing.length === 0, missing.join(', '));
}

// --- a real solver path builds a closed graph ---------------------------------
{
    const r = await solveConstructive('CuRu----:CuRu----',
        ['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu', 'WuWuWuWu'], Object.keys(operations), { maxLayers: 4 });
    const els = build(r.solutionPath);
    const ids = new Set(nodes(els).map((n) => n.data.id));
    const dangling = edges(els).filter((e) => !ids.has(e.data.source) || !ids.has(e.data.target));
    check('solver path includes a Belt Split', r.solutionPath.some((s) => s.operation === 'Belt Split'));
    check('every edge joins two existing nodes', dangling.length === 0, JSON.stringify(dangling));
    const splits = r.solutionPath.filter((s) => s.operation === 'Belt Split');
    check('one op node per non-split step',
        nodes(els).filter((n) => n.classes.startsWith('op')).length === r.solutionPath.length - splits.length);
    check('one branch edge per split input × output',
        edges(els).filter((e) => e.classes === 'branch').length ===
        splits.reduce((n, s) => n + s.inputs.length * s.outputs.length, 0));
}

// --- renderGraph / reRenderGraph against DOM + cytoscape stubs ----------------
const cyCalls = [];
globalThis.cytoscape = (opts) => {
    const cy = { opts, destroyed: false, on() {}, destroy() { cy.destroyed = true; } };
    cyCalls.push(cy);
    return cy;
};
const container = { cleared: 0, replaceChildren() { this.cleared++; } };
const selects = {
    'direction-select': { value: 'TB' },
    'edge-style-select': { value: 'straight' },
    'color-mode-select': { value: 'cmyk' },
};
// Canvas stub for createShapeCanvas: every 2D method is a no-op, and the
// data URL records the size so the thumbnail resolution is observable.
const makeCanvas = () => {
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}) });
    return { width: 0, height: 0, getContext: () => ctx, toDataURL() { return `data:canvas-${this.width}`; } };
};
globalThis.document = {
    getElementById: (id) => (id === 'graph-container' ? container : selects[id] ?? null),
    createElement: makeCanvas,
};

const { renderGraph, reRenderGraph, clearLastSolutionPath } = await import('../../operationGraph2D.js');
const instances = await import('../../operationGraphInstances.js');

const PATH = [
    step('Rotator CW', [[0, 'Cu------']], [[1, '--Cu----']]),
    step('Painter', [[1, '--Cu----']], [[2, '--Cr----']], { color: 'r' }),
];
{
    renderGraph(PATH);
    const cy = cyCalls[0];
    const expected = buildGraphElements(PATH, { shapeImage: () => 'data:canvas-120', colorMode: 'cmyk' });
    check('renderGraph mounts one cytoscape graph in the container',
        cyCalls.length === 1 && cy.opts.container === container && container.cleared === 1);
    check('renderGraph uses the built elements (live color mode, 120px thumbnails)',
        JSON.stringify(cy.opts.elements) === JSON.stringify(expected));
    check('renderGraph reads the direction and edge-style selects',
        cy.opts.layout.name === 'dagre' && cy.opts.layout.rankDir === 'TB' &&
        cy.opts.style.find((s) => s.selector === 'edge').style['curve-style'] === 'straight');
    check('renderGraph registers the live instance', instances.cyInstance === cy);

    reRenderGraph();
    check('reRenderGraph redraws the cached path',
        cyCalls.length === 2 && cy.destroyed &&
        JSON.stringify(cyCalls[1].opts.elements) === JSON.stringify(expected));
}
for (const cleared of [null, []]) {
    renderGraph(PATH);
    const before = cyCalls.length;
    const live = cyCalls[before - 1];
    renderGraph(cleared);
    check(`renderGraph(${JSON.stringify(cleared)}) tears the graph down without redrawing`,
        cyCalls.length === before && live.destroyed && instances.cyInstance === null);
    reRenderGraph();
    check(`reRenderGraph after renderGraph(${JSON.stringify(cleared)}) cannot revive the old path`,
        cyCalls.length === before);
}
{
    renderGraph(PATH);
    const before = cyCalls.length;
    clearLastSolutionPath();
    reRenderGraph();
    check('clearLastSolutionPath stops reRenderGraph (Explore path)', cyCalls.length === before);
}
{
    const space = { gone: false, _destructor() { space.gone = true; } };
    instances.setGraph3dInstance(space);
    renderGraph(PATH);
    check('renderGraph destroys a live space-explorer graph', space.gone && instances.graph3dInstance === null);
}

delete globalThis.document;
delete globalThis.cytoscape;

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
