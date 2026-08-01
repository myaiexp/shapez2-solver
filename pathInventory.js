// Id-level final inventory simulation for solution paths.
// Shared by Constructive preventWaste scrubbing and pathValidation so production
// Trash emission and the harness gate stay lockstep on the same domain rule:
// seed start ids (and any unproduced path inputs), then delete inputs / add
// outputs per step.

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
