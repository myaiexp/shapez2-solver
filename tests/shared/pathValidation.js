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
import { operations } from '../../shapeSolverCore.js';

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
    const missing = outputCodes.filter(c => !produced.includes(c));
    return { valid: missing.length === 0, reason: missing.length ? `not produced: ${missing.join(',')}` : '', produced };
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
        const missing = step.outputs.map(x => x.shape).filter(c => !produced.includes(c));
        if (missing.length) bad.push(`${step.operation}: ${inputs.join('+')} -> ${missing.join(',')} (got ${produced.join(',')})`);
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
