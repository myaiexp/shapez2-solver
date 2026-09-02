// Shared solution-path operation validation for the test harnesses.
//
// Every harness that displays a solver/explorer path re-runs each step's
// operation on its claimed input codes and confirms the claimed outputs are a
// SUBSET of what the op actually produces (the search drops empties/no-ops, so
// subset — not equality — is the contract). This module is the single source of
// truth for that check, imported by every harness and suite that validates a
// path so the path-integrity gate can't drift (e.g. one passing an op config
// while the others silently don't).
//
// Three independent gates live here for solver paths, and a path must clear all:
//   1. invalidPathSteps — every step is a real op on its claimed inputs
//   2. invalidPathIds   — the id bookkeeping is physical (single-consume)
//   3. pathReachesTarget — the final inventory actually holds the target
//
// Explorer graphs use validateExplorerEdges / invalidExplorerEdges: rebuild each
// op's in/out codes from edges and re-run the real operation (smoke + solve.mjs).
import { Shape, ShapeOperationConfig } from '../../shapeClass.js';
import { operations } from '../../shapeSolverOperations.js';
import {
    simulateFinalInventoryMap,
    finalInventoryCodes,
} from '../../pathInventory.js';

// Re-export production inventory predicates so harness imports stay one-stop
// (pathValidation was the historical home; the domain rules live in pathInventory).
export {
    simulateFinalInventoryMap,
    pathReachesTarget,
    pathInventoryAcceptable,
    acceptableCodes,
    finalInventoryCodes,
} from '../../pathInventory.js';

// The claimed outputs of a step must be an order-preserving subsequence of what
// the op actually produced (matching each produced entry at most once). Ordered,
// because blueprint ports bind by outputs[i] index — a Cutter whose L/R halves
// are swapped is a different, miswired factory even though both codes appear in
// the produced set. Subsequence (not equality), because the solver legitimately
// drops empty / no-op outputs the op still emits, so the claimed list is a subset
// kept in produced order. Returns null when valid, else a human-readable reason.
export function orderedSubsequenceFailure(claimed, produced) {
    let cursor = 0;
    for (const code of claimed) {
        let found = -1;
        for (let j = cursor; j < produced.length; j++) {
            if (produced[j] === code) { found = j; break; }
        }
        if (found === -1) {
            // Distinguish a fabricated output from one that exists but is
            // out-of-order or over-claimed (already consumed at an earlier index).
            return produced.includes(code)
                ? `out-of-order/duplicate output ${code}`
                : `not produced: ${code}`;
        }
        cursor = found + 1;
    }
    return null;
}

// Re-run an operation on concrete input codes, returning the produced output
// codes (empties dropped). Throws on an unknown op. `config` should carry the
// same maxLayers the solver ran with so layer-cap-sensitive ops (e.g. Stacker)
// validate identically; it defaults to the ops' own default (maxLayers 4).
export function applyOp(opName, inputCodes, color, config = new ShapeOperationConfig()) {
    const op = operations[opName];
    if (!op) throw new Error(`unknown op ${opName}`);
    const shapes = inputCodes.map(c => Shape.fromShapeCode(c));
    let out;
    if (op.inputCount === 2) out = op.fn(shapes[0], shapes[1], config);
    else if (op.needsColor) out = op.fn(shapes[0], color, config);
    else out = op.fn(shapes[0], config);
    return out.map(s => s.toShapeCode()).filter(Boolean);
}

// Validate one step/edge given a raw op name + code arrays. Returns
// { valid, reason, produced } for callers that report per-step detail (solve.mjs).
export function validateStep(opName, inputCodes, outputCodes, color, config) {
    let produced;
    try {
        produced = applyOp(opName, inputCodes, color, config);
    } catch (e) {
        return { valid: false, reason: `error: ${e.message}`, produced: [] };
    }
    const reason = orderedSubsequenceFailure(outputCodes, produced);
    return { valid: !reason, reason: reason ?? '', produced };
}

// Re-validate a whole solution path (array of step objects shaped
// { operation, inputs:[{shape}], outputs:[{shape}], params:{color} }). Returns
// an array of human-readable failure descriptions — empty ⇒ every step is a real
// op. A null/absent path yields no bad steps (callers gate on presence separately).
export function invalidPathSteps(path, config) {
    if (!path) return [];
    const bad = [];
    for (const step of path) {
        const op = operations[step.operation];
        if (!op) { bad.push(`unknown op ${step.operation}`); continue; }
        const inputs = step.inputs.map(x => x.shape);
        let produced;
        try {
            produced = applyOp(step.operation, inputs, step.params?.color, config);
        } catch (e) { bad.push(`${step.operation}: ${e.message}`); continue; }
        const reason = orderedSubsequenceFailure(step.outputs.map(x => x.shape), produced);
        if (reason) bad.push(`${step.operation}: ${inputs.join('+')} -> ${reason} (got ${produced.join(',')})`);
    }
    return bad;
}

// ---------------------------------------------------------------------------
// Explorer graph edge validation — same op gate, different wire shape
// ---------------------------------------------------------------------------
// The space explorer returns { shapes, ops, edges }, not a solution path. Rebuild
// each op's claimed input/output codes from the edge list and re-run the real
// operation so a wrong expand/prune that keeps the same node/edge counts still
// fails CI. Empty (`--------`) outputs stay: the explorer keeps them as nodes
// and they remain a subsequence of what the op produces.

// Per-op reports for solve.mjs --json / detailed CLI output.
export function validateExplorerEdges(graph, config) {
    if (!graph?.ops) return [];
    const codeOf = new Map((graph.shapes || []).map((s) => [s.id, s.code]));
    const inputs = new Map();
    const outputs = new Map();
    for (const e of graph.edges || []) {
        if (e.target.startsWith('op-')) {
            (inputs.get(e.target) || inputs.set(e.target, []).get(e.target)).push(e.source);
        } else if (e.source.startsWith('op-')) {
            (outputs.get(e.source) || outputs.set(e.source, []).get(e.source)).push(e.target);
        }
    }
    return graph.ops.map((o) => {
        const inCodes = (inputs.get(o.id) || []).map((id) => codeOf.get(id));
        const outCodes = (outputs.get(o.id) || []).map((id) => codeOf.get(id));
        const v = validateStep(o.type, inCodes, outCodes, o.params?.color, config);
        return { op: o.type, inputs: inCodes, outputs: outCodes, valid: v.valid, reason: v.reason };
    });
}

// Human-readable failures for smoke — empty ⇒ every explorer edge is a real op.
export function invalidExplorerEdges(graph, config) {
    return validateExplorerEdges(graph, config)
        .filter((r) => !r.valid)
        .map((r) => `${r.op}: ${r.inputs.join('+')} -> ${r.reason}`);
}

// ---------------------------------------------------------------------------
// Id integrity — the item-flow the shape-code replay above cannot see
// ---------------------------------------------------------------------------
// Every shape instance in a path carries a unique id, and the solver consumes
// each id EXACTLY once: applySuccessor deletes every input id from the available
// set and mints fresh ids for the outputs, so a consumed id can never come back.
// Re-running ops on shape CODES is blind to that — two Stackers can both name id
// 12 (`CuRu----`) as an input and every step still replays perfectly, while the
// factory double-spends one machine's output. It is not a cosmetic slip:
// blueprintPositions maps an id to a SINGLE output port, so both consumers get
// belts from that one port with no splitter between them. The sanctioned fan-out
// is an explicit Belt Split step, which consumes its input id once and mints one
// fresh id per copy — those copies then pass this check on their own.
//
// Returns human-readable failures (empty ⇒ the id bookkeeping is sound):
//   • an id produced by two steps (or twice by one step)
//   • an id consumed by two steps — the double-spend above
//   • an id consumed before the step that produces it
//   • with `starts` given, an unproduced input whose code is not a starting
//     shape: a shape materialised out of nothing
export function invalidPathIds(path, { starts } = {}) {
    if (!path) return [];
    const bad = [];
    const producedAt = new Map();   // id -> index of the step that produced it
    const consumedAt = new Map();   // id -> index of the step that first consumed it
    const startCodes = starts ? new Set(starts) : null;

    for (let i = 0; i < path.length; i++) {
        for (const out of path[i].outputs) {
            if (producedAt.has(out.id)) {
                bad.push(`id ${out.id} (${out.shape}) produced twice: step ${producedAt.get(out.id)} and step ${i} (${path[i].operation})`);
                continue;
            }
            producedAt.set(out.id, i);
        }
    }

    for (let i = 0; i < path.length; i++) {
        const step = path[i];
        for (const inp of step.inputs) {
            const firstConsumer = consumedAt.get(inp.id);
            if (firstConsumer === undefined) {
                consumedAt.set(inp.id, i);
            } else if (firstConsumer === i) {
                bad.push(`id ${inp.id} (${inp.shape}) consumed twice by step ${i} (${step.operation}) — needs a Belt Split to fan out`);
            } else {
                bad.push(`id ${inp.id} (${inp.shape}) consumed twice: step ${firstConsumer} and step ${i} (${step.operation}) — needs a Belt Split to fan out`);
            }

            const producer = producedAt.get(inp.id);
            if (producer === undefined) {
                // Unproduced ⇒ a starting shape. Its code must be one we started with.
                if (startCodes && !startCodes.has(inp.shape)) {
                    bad.push(`step ${i} (${step.operation}) consumes id ${inp.id} (${inp.shape}), which no step produces and which is not a starting shape`);
                }
            } else if (producer > i) {
                bad.push(`step ${i} (${step.operation}) consumes id ${inp.id} (${inp.shape}) before step ${producer} produces it`);
            }
        }
    }
    return bad;
}

// Boolean convenience over both gates: true ⇒ path is present, every step is a
// real op, AND its id bookkeeping is sound (single-consume, produced-before-used).
// Pass `starts` to also reject inputs conjured from outside the starting set.
// A null/absent path is invalid (callers that expect a solution treat "no path"
// as a failure).
export function pathIsValid(path, config, { starts } = {}) {
    if (!path) return false;
    return invalidPathSteps(path, config).length === 0
        && invalidPathIds(path, { starts }).length === 0;
}

// Replay a solution path's id bookkeeping to recover the shapes still on hand
// after the last step. Codes-only view over the production Map core in
// pathInventory.js. Pass `starts` so unused starting shapes remain visible
// (core start ids are 0..n-1) — needed for preventWaste target-as-start leftovers.
export function simulateFinalInventory(path, { starts } = {}) {
    if (!path) return [];
    return finalInventoryCodes(path, { starts });
}

// ---------------------------------------------------------------------------
// Enabled-ops gate (inventory goal/cleanliness predicates live in pathInventory)
// ---------------------------------------------------------------------------
// Ops present in the path but absent from the allowed list. Empty ⇒ every step
// is in the enabled set. A null/absent path yields no failures (callers gate
// presence separately). Unknown/typo ops in the path also show up here when
// they are not in `allowedOps`.
export function invalidDisallowedOps(path, allowedOps) {
    if (!path) return [];
    const allowed = new Set(allowedOps);
    const bad = [];
    for (let i = 0; i < path.length; i++) {
        const op = path[i].operation;
        if (!allowed.has(op)) bad.push(`step ${i}: disallowed op ${op}`);
    }
    return bad;
}
