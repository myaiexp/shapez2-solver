// Unit tests for shapeExplorer's depthLimit=0 boundary (audit #3726) —
// run with:  node tests/solver/shapeExplorerDepthLimit.test.js
//
// The explorer's expansion loop is `for (let depth = 1; depth <= depthLimit; ...)`,
// so depthLimit=0 must run zero iterations: the returned graph is exactly the
// (deduplicated) starting shapes with NO operations and NO edges. This boundary
// was never tested, so an off-by-one (e.g. `depth <= depthLimit` → `< depthLimit`,
// or starting the loop at 0) could silently expand at depth 0 — or fail to expand
// at depth 1 — without any failing test. We pin the zero-depth contract and
// contrast it with a depthLimit=1 case so the "no expansion" assertion is
// meaningful (i.e. expansion DOES happen once the limit allows it).
import { shapeExplorer } from '../../shapeExplorerCore.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

const ALL_OPS = ['Rotator CW', 'Rotator CCW', 'Rotator 180', 'Half Destroyer', 'Cutter', 'Swapper'];
const noCancel = () => false;
const noop = () => {};

// Asymmetric so depth-1 expansion is guaranteed to discover genuinely new shapes
// (cutting/rotating CuRuSuWu yields shapes that differ from the input).
const STARTS = ['CuRuSuWu'];

function explore(starts, depthLimit) {
    return shapeExplorer(starts, ALL_OPS, depthLimit, /* maxLayers */ 4, noCancel, noop);
}

// --- depthLimit=0: only the starting shape(s), zero expansion ------------------
{
    const g = await explore(STARTS, 0);
    check('depth0: returns a graph object (not null)', g != null);
    check('depth0: shapes is an array', g != null && Array.isArray(g.shapes));
    check('depth0: shapes contains exactly the one starting shape', g != null && g.shapes.length === 1);
    check('depth0: that shape is the starting code', g != null && g.shapes[0]?.code === 'CuRuSuWu');
    check('depth0: no operations were applied', g != null && Array.isArray(g.ops) && g.ops.length === 0);
    check('depth0: no edges were created', g != null && Array.isArray(g.edges) && g.edges.length === 0);
}

// --- depthLimit=0 deduplicates starting shapes (still no expansion) ------------
{
    const g = await explore(['CuRuSuWu', 'RuRuRuRu', 'CuRuSuWu'], 0);
    check('depth0 dedup: distinct starts kept, duplicate dropped', g != null && g.shapes.length === 2);
    check('depth0 dedup: still no ops', g != null && g.ops.length === 0);
    check('depth0 dedup: still no edges', g != null && g.edges.length === 0);
}

// --- Contrast: depthLimit=1 DOES expand — proves depth0 inaction is real -------
{
    const g = await explore(STARTS, 1);
    check('depth1: returns a graph object (not null)', g != null);
    check('depth1: more shapes than the single start', g != null && g.shapes.length > 1);
    check('depth1: at least one operation was applied', g != null && g.ops.length > 0);
    check('depth1: edges were created', g != null && g.edges.length > 0);
    check('depth1: original starting shape is still present',
        g != null && g.shapes.some(s => s.code === 'CuRuSuWu'));
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
