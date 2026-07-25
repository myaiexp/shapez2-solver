// Shared solution-path operation validation for the test harnesses.
//
// Every harness that displays a solver/explorer path re-runs each step's
// operation on its claimed input codes and confirms the claimed outputs are a
// SUBSET of what the op actually produces (the search drops empties/no-ops, so
// subset — not equality — is the contract). This module is the single source of
// truth for that check, imported by smoke.js, solve.mjs, constructive.test.js
// and solverStateCap.test.js so the path-integrity gate can't drift between the
// four (e.g. one passing an op config while the others silently don't).
//
// Three independent gates live here, and a path must clear all of them:
//   1. invalidPathSteps — every step is a real op on its claimed inputs
//   2. invalidPathIds   — the id bookkeeping is physical (single-consume)
//   3. pathReachesTarget — the final inventory actually holds the target
import { Shape, ShapeOperationConfig } from '../../shapeClass.js';
import { operations } from '../../shapeSolverOperations.js';
import { getAllRotations } from '../../shapeRotation.js';

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
// after the last step. Every step deletes its input ids and adds its output ids
// (mirroring the solver's applySuccessor). Ids that are consumed but never
// produced are the participating starting shapes, so we seed those first. The
// remaining shapes are the final inventory — this is what "did we build it?"
// must check, since a Trash-ending path removes the byproduct, not the target.
export function simulateFinalInventory(path) {
    const producedIds = new Set();
    for (const step of path) for (const out of step.outputs) producedIds.add(out.id);
    const inventory = new Map(); // id -> shape code
    // Seed starting shapes: any input id that no step produces.
    for (const step of path) {
        for (const inp of step.inputs) {
            if (!producedIds.has(inp.id) && !inventory.has(inp.id)) inventory.set(inp.id, inp.shape);
        }
    }
    for (const step of path) {
        for (const inp of step.inputs) inventory.delete(inp.id);
        for (const out of step.outputs) inventory.set(out.id, out.shape);
    }
    return Array.from(inventory.values());
}

// True when the path's final inventory actually contains the target (any
// rotation, unless orientationSensitive — mirroring the solver's acceptable
// set). This is the goal gate that step-level op validation does NOT provide:
// every step can be a real op yet assemble the wrong shape or trash the target.
//
// A ZERO-OP path is the solver's already-solved contract (empty solutionPath at
// depth 0 when a start is already acceptable — see solverAlreadySolved.test.js),
// not a failure. There are no steps to replay, so the final inventory simply IS
// the starting set, which only the caller knows: pass `starts` and an empty path
// succeeds iff one of them is acceptable. Without `starts` we cannot tell an
// already-solved solve from an empty one, so we stay strict and reject.
export function pathReachesTarget(path, target, { starts, config, orientationSensitive = false } = {}) {
    if (!path) return false;
    const acceptable = orientationSensitive
        ? new Set([target])
        : getAllRotations(Shape.fromShapeCode(target), config);
    if (path.length === 0) return starts ? starts.some(code => acceptable.has(code)) : false;
    return simulateFinalInventory(path).some(code => acceptable.has(code));
}
