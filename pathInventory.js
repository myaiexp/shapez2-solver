// Id-level final inventory simulation for solution paths.
// Shared by Constructive preventWaste scrubbing and pathValidation so production
// Trash emission and the harness gate stay lockstep on the same domain rule:
// seed unproduced start ids, then delete inputs / add outputs per step.

// Replay a path's id bookkeeping → Map<id, shapeCode> of shapes still on hand
// after the last step. Ids consumed but never produced are starting shapes, so
// those are seeded first (mirrors the solver's applySuccessor inventory walk).
export function simulateFinalInventoryMap(path) {
    if (!path) return new Map();
    const producedIds = new Set();
    for (const step of path) for (const out of step.outputs) producedIds.add(out.id);
    const inventory = new Map();
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
