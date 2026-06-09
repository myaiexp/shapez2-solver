// Headless solver/explorer harness: run a solve (or exploration) from the CLI,
// dump the result, and VALIDATE that every operation in it is real
// (output === the actual operation applied to its inputs). Catches the class of
// bug where the search produces a path/graph whose displayed steps don't match
// what the operations actually do.
//
// Usage:
//   node tests/solve.mjs <target> [options]
//   node tests/solve.mjs CuRuCuRu
//   node tests/solve.mjs RuCuCuRu --start CuCuCuCu,RuRuRuRu --ops Swapper,Cutter
//   node tests/solve.mjs --explore 2 --start CuCuCuCu,RuRuRuRu,SuSuSuSu
//
// Options:
//   --start a,b,c        starting shape codes (default matches the app's default
//                        starts: CuCuCuCu,RuRuRuRu,SuSuSuSu,WuWuWuWu)
//   --ops a,b,...        enabled operations (default: all)
//   --method M           A* | BFS | IDA* | Bidirectional (default A*)
//   --max-layers N       (default 4)
//   --prevent-waste      enable preventWaste
//   --orientation        orientation-sensitive search
//   --timeout MS         abort the search after MS ms (default 20000)
//   --max-states N       abort once N distinct states are discovered (default 100000;
//                        bounds memory so hard targets fail gracefully instead of OOM)
//   --explore N          run the space explorer to depth N instead of solving
//   --json               emit machine-readable JSON
//
// Exit code is non-zero if any step/edge fails operation validation.

import { shapeSolver, shapeExplorer, operations } from '../shapeSolverCore.js';
import { Shape } from '../shapeClass.js';

function parseArgs(argv) {
    const opts = { start: 'CuCuCuCu,RuRuRuRu,SuSuSuSu,WuWuWuWu', method: 'A*', maxLayers: 4, timeout: 20000, maxStates: 100000 };
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--prevent-waste') opts.preventWaste = true;
        else if (a === '--orientation') opts.orientation = true;
        else if (a === '--json') opts.json = true;
        else if (a === '--start') opts.start = argv[++i];
        else if (a === '--ops') opts.ops = argv[++i];
        else if (a === '--method') opts.method = argv[++i];
        else if (a === '--max-layers') opts.maxLayers = parseInt(argv[++i]);
        else if (a === '--timeout') opts.timeout = parseInt(argv[++i]);
        else if (a === '--max-states') opts.maxStates = parseInt(argv[++i]);
        else if (a === '--explore') opts.explore = parseInt(argv[++i]);
        else positional.push(a);
    }
    opts.target = positional[0];
    return opts;
}

// Returns the output codes of applying an operation to concrete input codes.
// Keeps empty (`--------`) outputs: the explorer keeps them as nodes, and the
// solver simply drops them, so both stay a subset of this full set.
function applyOp(opName, inputCodes, color) {
    const op = operations[opName];
    if (!op) throw new Error(`unknown op ${opName}`);
    const shapes = inputCodes.map(c => Shape.fromShapeCode(c));
    let out;
    if (op.inputCount === 2) out = op.fn(shapes[0], shapes[1]);
    else if (op.needsColor) out = op.fn(shapes[0], color);
    else out = op.fn(shapes[0]);
    return out.map(s => s.toShapeCode()).filter(Boolean);
}

// A step/edge is valid if every claimed output is among the codes the operation
// actually produces from the claimed inputs (the search drops no-ops, and the
// solver drops empties, so subset — not equality — is the contract).
function validateStep(opName, inputCodes, outputCodes, color) {
    let produced;
    try {
        produced = applyOp(opName, inputCodes, color);
    } catch (e) {
        return { valid: false, reason: `error: ${e.message}`, produced: [] };
    }
    const missing = outputCodes.filter(c => !produced.includes(c));
    return { valid: missing.length === 0, reason: missing.length ? `not produced: ${missing.join(',')}` : '', produced };
}

const opts = parseArgs(process.argv.slice(2));
const starting = opts.start.split(',').map(s => s.trim()).filter(Boolean);
const ops = opts.ops ? opts.ops.split(',').map(s => s.trim()) : Object.keys(operations);

const deadline = Date.now() + opts.timeout;
const shouldCancel = () => Date.now() > deadline;

if (opts.explore != null) {
    const g = await shapeExplorer(starting, ops, opts.explore, opts.maxLayers, shouldCancel, () => {});
    if (!g) { console.error('explore: cancelled/timed out'); process.exit(2); }
    const codeOf = new Map(g.shapes.map(s => [s.id, s.code]));
    const inputs = new Map(), outputs = new Map();
    for (const e of g.edges) {
        if (e.target.startsWith('op-')) (inputs.get(e.target) || inputs.set(e.target, []).get(e.target)).push(e.source);
        else if (e.source.startsWith('op-')) (outputs.get(e.source) || outputs.set(e.source, []).get(e.source)).push(e.target);
    }
    let bad = 0;
    const edgeReports = g.ops.map(o => {
        const inCodes = (inputs.get(o.id) || []).map(id => codeOf.get(id));
        const outCodes = (outputs.get(o.id) || []).map(id => codeOf.get(id));
        const v = validateStep(o.type, inCodes, outCodes, o.params?.color);
        if (!v.valid) bad++;
        return { op: o.type, inputs: inCodes, outputs: outCodes, valid: v.valid, reason: v.reason };
    });
    if (opts.json) {
        console.log(JSON.stringify({ shapes: g.shapes.length, ops: g.ops.length, invalid: bad, edges: edgeReports }, null, 2));
    } else {
        console.log(`explore depth=${opts.explore} shapes=${g.shapes.length} ops=${g.ops.length}`);
        for (const r of edgeReports) if (!r.valid) console.log(`  INVALID ${r.op}: ${r.inputs.join(' + ')} -> ${r.outputs.join(', ')} (${r.reason})`);
        console.log(bad ? `*** ${bad} INVALID edges ***` : 'all edges valid');
    }
    process.exit(bad ? 1 : 0);
}

if (!opts.target) { console.error('usage: node tests/solve.mjs <target> [options]  (or --explore N)'); process.exit(2); }

const res = await shapeSolver(
    opts.target, starting, ops, opts.maxLayers, 1000,
    !!opts.preventWaste, !!opts.orientation, false, 0.1, opts.method, shouldCancel, () => {}, opts.maxStates
);

if (shouldCancel() && (!res || !res.solutionPath)) { console.error(`solve: timed out after ${opts.timeout}ms`); process.exit(2); }
if (!res || !res.solutionPath) {
    const cap = res?.aborted === 'maxStates' ? ` — hit ${opts.maxStates}-state cap` : '';
    if (opts.json) console.log(JSON.stringify({ target: opts.target, solved: false, aborted: res?.aborted ?? null, statesExplored: res?.statesExplored ?? null }));
    else console.log(`No solution for ${opts.target} (explored ${res?.statesExplored ?? '?'} states${cap})`);
    process.exit(0);
}

let bad = 0;
const stepReports = res.solutionPath.map((step, i) => {
    const inCodes = step.inputs.map(x => x.shape);
    const outCodes = step.outputs.map(x => x.shape);
    const v = validateStep(step.operation, inCodes, outCodes, step.params?.color);
    if (!v.valid) bad++;
    return { i, op: step.operation, color: step.params?.color, inputs: inCodes, outputs: outCodes, valid: v.valid, reason: v.reason };
});

if (opts.json) {
    console.log(JSON.stringify({ target: opts.target, solved: true, depth: res.depth, steps: stepReports, invalid: bad, statesExplored: res.statesExplored }, null, 2));
} else {
    console.log(`target=${opts.target} method=${opts.method} depth=${res.depth} steps=${res.solutionPath.length} explored=${res.statesExplored}`);
    for (const r of stepReports) {
        const tag = r.valid ? 'ok ' : 'BAD';
        const col = r.color ? `(${r.color}) ` : '';
        console.log(`${tag} ${String(r.i).padStart(2)} ${r.op}${' '.repeat(Math.max(0, 17 - r.op.length))} ${col}${r.inputs.join(' + ')} -> ${r.outputs.join(', ')}${r.valid ? '' : '   <-- ' + r.reason}`);
    }
    console.log(bad ? `*** ${bad} INVALID step(s) — solver produced an impossible path ***` : 'all steps valid');
}
process.exit(bad ? 1 : 0);
