// Shared solution-path operation validation for the test harnesses.
//
// Every harness that displays a solver/explorer path re-runs each step's
// operation on its claimed input codes and confirms the claimed outputs are a
// SUBSET of what the op actually produces (the search drops empties/no-ops, so
// subset — not equality — is the contract). This module is the single source of
// truth for that check, imported by smoke.js, solve.mjs, constructive.test.js
// and solverStateCap.test.js so the path-integrity gate can't drift between the
// four (e.g. one passing an op config while the others silently don't).
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

// Boolean convenience over invalidPathSteps: true ⇒ path is present and every
// step is a real op. A null/absent path is invalid (callers that expect a
// solution treat "no path" as a failure).
export function pathIsValid(path, config) {
    if (!path) return false;
    return invalidPathSteps(path, config).length === 0;
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
export function pathReachesTarget(path, target, { config, orientationSensitive = false } = {}) {
    if (!path || path.length === 0) return false;
    const acceptable = orientationSensitive
        ? new Set([target])
        : getAllRotations(Shape.fromShapeCode(target), config);
    return simulateFinalInventory(path).some(code => acceptable.has(code));
}
