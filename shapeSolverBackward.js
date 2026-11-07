import { getCachedShape } from './shapeSolverCache.js';
import {
    inverseUnpaint,
    inverseRotateCW,
    inverseRotateCCW,
    inverseRotate180,
    inverseUncut,
    inverseUnpin
} from './shapeSolverInverse.js';

/**
 * Build backward reachability map from target shape code.
 * Returns Map<shapeCode, depth> of all shapes that can produce the target
 * within maxDepth inverse operations.
 *
 * Only single-input ops are inverted: each entry must reach the target on its
 * own, because Bidirectional reads the smallest depth of any held code as the
 * state's distance. Stacker takes two inputs, so an unstacked half is not a
 * predecessor — listing halves made a state holding one of them look one op
 * from the goal and flooded the search (idea #7002). Cutter is one input with
 * two outputs, so its uncut wholes are real predecessors.
 */
export function buildBackwardReachability(targetShapeCode, config, enabledOperations, maxDepth, shouldCancel) {
    const reachable = new Map(); // shapeCode -> depth
    reachable.set(targetShapeCode, 0);
    let frontier = [targetShapeCode];

    const inverseOps = [];
    for (const opName of enabledOperations) {
        if (opName === 'Painter') inverseOps.push(inverseUnpaint);
        if (opName === 'Rotator CW') inverseOps.push(inverseRotateCW);
        if (opName === 'Rotator CCW') inverseOps.push(inverseRotateCCW);
        if (opName === 'Rotator 180') inverseOps.push(inverseRotate180);
        if (opName === 'Cutter') inverseOps.push(inverseUncut);
        if (opName === 'Pin Pusher') inverseOps.push(inverseUnpin);
        // Stacker, Swapper: two inputs (see above). Half Destroyer, Trash, Belt
        // Split, Crystal Generator: not invertible or complex.
    }

    if (inverseOps.length === 0) return reachable;

    for (let depth = 1; depth <= maxDepth; depth++) {
        if (shouldCancel()) break;
        const nextFrontier = [];
        for (const code of frontier) {
            const shape = getCachedShape(code);
            for (const invOp of inverseOps) {
                const predecessorCodes = invOp(shape, config);
                for (const predCode of predecessorCodes) {
                    if (!predCode || reachable.has(predCode)) continue;
                    // Validate the predecessor code
                    try {
                        getCachedShape(predCode);
                    } catch {
                        continue;
                    }
                    reachable.set(predCode, depth);
                    nextFrontier.push(predCode);
                }
            }
        }
        frontier = nextFrontier;
        if (frontier.length === 0) break;
    }
    return reachable;
}
