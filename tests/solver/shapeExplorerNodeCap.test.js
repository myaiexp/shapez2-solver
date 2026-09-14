// Unit tests for shapeExplorer's maxNodes cap, progress and yield (finding
// #9623) — run with:  node tests/solver/shapeExplorerNodeCap.test.js
//
// Before the cap, depth 3 at the UI defaults (4 starts, all ops) never finished
// and grew past 3.6 GB; the BFS posted progress only at completion and never
// yielded, so a worker could not even observe its cancel flag. These pin:
//   - the cap: shapes + ops never exceed maxNodes, the partial graph has no
//     dangling edges, aborted: 'maxNodes' is reported, and the cap is inclusive
//   - the defaults: a first Explore click (default depth, default cap) is complete
//   - per-depth progress, and a yield that lets an async cancel land mid-BFS
import { shapeExplorer } from '../../shapeExplorerCore.js';
import { DEFAULT_EXPLORE_DEPTH, DEFAULT_EXPLORE_MAX_NODES } from '../../exploreDepth.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

const UI_STARTS = ['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu', 'WuWuWuWu'];
// Every operation the UI enables by default, in index.html DOM order (the
// order main.js sends them, which is the order the explorer expands them).
const UI_OPS = ['Rotator CW', 'Rotator CCW', 'Rotator 180', 'Half Destroyer', 'Cutter', 'Swapper',
    'Stacker', 'Painter', 'Belt Split', 'Pin Pusher', 'Crystal Generator', 'Trash'];
const SMALL_OPS = ['Cutter', 'Rotator CW'];
const noCancel = () => false;
const noop = () => {};

const nodeCount = (g) => g.shapes.length + g.ops.length;

// A cap applied after an op is recorded would leave edges to shapes that never
// made it into the graph; renderSpaceGraph would then link to missing nodes.
function danglingEdges(g) {
    const ids = new Set([...g.shapes.map(s => s.id), ...g.ops.map(o => o.id)]);
    return g.edges.filter(e => !ids.has(e.source) || !ids.has(e.target)).length;
}

// --- First Explore click at the defaults is complete, not truncated ----------
{
    const g = await shapeExplorer(UI_STARTS, UI_OPS, DEFAULT_EXPLORE_DEPTH, 4, noCancel, noop, null, DEFAULT_EXPLORE_MAX_NODES);
    check('defaults: not truncated by the default cap', g?.aborted === null);
    check('defaults: reached the default depth', g?.depth === DEFAULT_EXPLORE_DEPTH);
    check('defaults: fits under the cap', g != null && nodeCount(g) <= DEFAULT_EXPLORE_MAX_NODES);
}

// --- Depth 3 at the defaults (the reported OOM) stops at the cap -------------
{
    const msgs = [];
    const g = await shapeExplorer(UI_STARTS, UI_OPS, 3, 4, noCancel, m => msgs.push(m), null, DEFAULT_EXPLORE_MAX_NODES);
    check('depth3: returns a partial graph, not null', g != null);
    check("depth3: reports aborted 'maxNodes'", g?.aborted === 'maxNodes');
    check('depth3: stopped inside depth 3', g?.depth === 3);
    check('depth3: never exceeds the cap', g != null && nodeCount(g) <= DEFAULT_EXPLORE_MAX_NODES);
    check('depth3: no dangling edges', g != null && danglingEdges(g) === 0);
    check('depth3: final progress names the cap',
        msgs.at(-1)?.startsWith(`Exploration stopped at the ${DEFAULT_EXPLORE_MAX_NODES}-node cap`) === true);
}

// --- The cap is inclusive and the aborted graph is a prefix of the full one ---
{
    const full = await shapeExplorer(['CuRuSuWu'], SMALL_OPS, 2, 4, noCancel, noop);
    const n = nodeCount(full);
    check('boundary: uncapped run is not aborted', full.aborted === null);

    const atCap = await shapeExplorer(['CuRuSuWu'], SMALL_OPS, 2, 4, noCancel, noop, null, n);
    check('boundary: cap equal to the full graph does not abort',
        atCap.aborted === null && nodeCount(atCap) === n);

    const under = await shapeExplorer(['CuRuSuWu'], SMALL_OPS, 2, 4, noCancel, noop, null, n - 1);
    check('boundary: one below the full graph aborts', under.aborted === 'maxNodes');
    check('boundary: aborted graph stays within its cap', nodeCount(under) <= n - 1);
    check('boundary: aborted graph is a prefix of the full graph',
        under.ops.every((o, i) => o.type === full.ops[i].type)
        && under.shapes.every((s, i) => s.code === full.shapes[i].code));
}

// --- Starting shapes are kept even when they alone exceed the cap ------------
{
    const g = await shapeExplorer(UI_STARTS, UI_OPS, 2, 4, noCancel, noop, null, 2);
    check('tiny cap: all starts kept', g.shapes.length === UI_STARTS.length);
    check('tiny cap: no op recorded', g.ops.length === 0 && g.edges.length === 0);
    check("tiny cap: reports aborted 'maxNodes'", g.aborted === 'maxNodes');
}

// --- Invalid caps throw instead of reading as an immediate abort -------------
for (const bad of [0, -1, NaN, null]) {
    const err = await shapeExplorer(['CuRuSuWu'], SMALL_OPS, 1, 4, noCancel, noop, null, bad).catch(e => e);
    check(`invalid cap ${bad}: throws RangeError`, err instanceof RangeError);
}

// --- Progress is posted per depth, completion last ---------------------------
{
    const msgs = [];
    await shapeExplorer(['CuRuSuWu'], SMALL_OPS, 2, 4, noCancel, m => msgs.push(m));
    const d1 = msgs.findIndex(m => m.startsWith('Exploring depth 1/2'));
    const d2 = msgs.findIndex(m => m.startsWith('Exploring depth 2/2'));
    check('progress: announces depth 1 before depth 2', d1 >= 0 && d2 > d1);
    check('progress: completion message comes last',
        msgs.at(-1)?.startsWith('Exploration complete') === true && msgs.length - 1 > d2);
}

// --- The BFS yields, so an async cancel lands mid-run ------------------------
// The cancel timer is scheduled from the first progress call. A BFS that never
// yields cannot run it until the whole exploration returns, so it would come
// back with a graph instead of null. The finite cap keeps that regression slow
// rather than fatal.
{
    let cancelled = false;
    let scheduled = false;
    const onProgress = () => {
        if (!scheduled) { scheduled = true; setTimeout(() => { cancelled = true; }, 0); }
    };
    const g = await shapeExplorer(UI_STARTS, UI_OPS, 3, 4, () => cancelled, onProgress, null, 20000);
    check('yield: an async cancel lands mid-BFS (returns null)', g === null);
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
