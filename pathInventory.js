// Id-level final inventory simulation for solution paths.
// Shared by Constructive preventWaste scrubbing and pathValidation so production
// Trash emission and the harness gate stay lockstep on the same domain rule:
// seed start ids (and any unproduced path inputs), then delete inputs / add
// outputs per step. Goal/cleanliness predicates live here too so Constructive
// defense-in-depth and the CI harness cannot drift (finding #6424).

import { Shape, ShapeOperationConfig } from './shapeClass.js';
import { getAllRotations } from './shapeRotation.js';

// Replay a path's id bookkeeping → Map<id, shapeCode> of shapes still on hand
// after the last step. Core mints starts as ids 0..starts.length-1; pass
// `starts` so shapes that never appear in the path (unused starting shapes —
// the usual case when preventWaste only Trashes byproducts and the target is
// already a start) stay visible. Unproduced path inputs not covered by that
// range are still seeded from the steps themselves (mirrors the solver's
// applySuccessor inventory walk when starts are unknown).
export function simulateFinalInventoryMap(path, { starts } = {}) {
    if (!path) return new Map();
    const inventory = new Map();
    if (starts) {
        for (let i = 0; i < starts.length; i++) inventory.set(i, starts[i]);
    }
    const producedIds = new Set();
    for (const step of path) for (const out of step.outputs) producedIds.add(out.id);
    for (const step of path) {
        for (const inp of step.inputs) {
            if (!producedIds.has(inp.id) && !inventory.has(inp.id)) {
                inventory.set(inp.id, inp.shape);
            }
        }
    }
    for (const step of path) {
        for (const inp of step.inputs) inventory.delete(inp.id);
        for (const out of step.outputs) inventory.set(out.id, out.shape);
    }
    return inventory;
}

// Codes still on hand after replaying the path (optional start seeding).
export function finalInventoryCodes(path, { starts } = {}) {
    if (!path) return [];
    return Array.from(simulateFinalInventoryMap(path, { starts }).values());
}

// Acceptable form(s) of the target: exact code when orientation-sensitive,
// otherwise every rotation under the given op config. `shape` is an optional
// already-parsed Shape (solver cache) so callers do not re-parse the code.
export function acceptableCodes(target, { orientationSensitive = false, config, shape } = {}) {
    if (orientationSensitive) return new Set([target]);
    const cfg = config || new ShapeOperationConfig();
    const parsed = shape || Shape.fromShapeCode(target);
    return new Set(getAllRotations(parsed, cfg));
}

// True when the path's final hand holds the target (any acceptable rotation
// unless orientation-sensitive). Zero-op paths succeed iff a start is
// acceptable — without `starts` an empty path cannot be judged and fails.
// Non-empty paths also need `starts` when the target is an unused start that
// never appears as a step input (preventWaste Trash-only solutions).
export function pathReachesTarget(path, target, { starts, config, orientationSensitive = false } = {}) {
    if (!path) return false;
    const acceptable = acceptableCodes(target, { orientationSensitive, config });
    if (path.length === 0) return starts ? starts.some((code) => acceptable.has(code)) : false;
    return finalInventoryCodes(path, { starts }).some((code) => acceptable.has(code));
}

// preventWaste cleanliness: every code in the final hand is an acceptable form
// of the target. Distinct from pathReachesTarget (target among leftovers).
// Zero-op without starts cannot be judged and fails. Non-empty paths require a
// non-empty inventory of only acceptable codes — empty `.every()` must not pass
// (trashing everything including the target is not waste-free success).
export function pathInventoryAcceptable(path, target, { starts, config, orientationSensitive = false } = {}) {
    if (!path) return false;
    const acceptable = acceptableCodes(target, { orientationSensitive, config });
    if (path.length === 0) {
        if (!starts) return false;
        return starts.every((code) => acceptable.has(code));
    }
    const inventory = finalInventoryCodes(path, { starts });
    return inventory.length > 0 && inventory.every((code) => acceptable.has(code));
}
