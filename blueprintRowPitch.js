/** Default vertical distance between machine rows in tiles */
export const ROW_PITCH = 4;

/**
 * Row pitch for a path. Each Belt Split in a chain moves its outputs one tile
 * south (propagateBeltSplits), so a long chain would run past the next row and
 * routeBelt could only reach the machine by heading north, into its output side.
 *
 * A chain of n ends n tiles below its producer's port, which sits one tile below
 * its row (every machine is depth 1). The consumer's belt must start at least one
 * tile above the next row, since a Stacker's top input spends a tile on the lift.
 * That needs a pitch of n + 2. The pitch is one number for the whole layout, so
 * the grid stays regular.
 */
export function rowPitchFor(solutionPath) {
    const chainById = new Map();
    let longestChain = 0;
    for (const step of solutionPath) {
        if (step.operation !== 'Belt Split') continue;
        const chain = (chainById.get(step.inputs[0].id) ?? 0) + 1;
        for (const out of step.outputs) chainById.set(out.id, chain);
        longestChain = Math.max(longestChain, chain);
    }
    return Math.max(ROW_PITCH, longestChain + 2);
}
