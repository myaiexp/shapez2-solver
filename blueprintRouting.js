// ---------------------------------------------------------------------------
// Belt routing helper
// ---------------------------------------------------------------------------

/**
 * Route belt tiles from (fromX, fromY, fromFloor) to (toX, toY, toFloor).
 * Uses an L-shaped path: horizontal first (at source row), then vertical
 * down into the target machine's back face.  This keeps horizontal segments
 * in the gap space between machine rows instead of overlapping machine tiles.
 *
 * When fromFloor !== toFloor, inserts belt lift tiles at the transition point.
 *
 * If the step has multiple inputs (merge), annotate the merge point.
 *
 * @param {PlacedBelt[]} belts - array to push belt tiles into
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} fromFloor
 * @param {number} toX
 * @param {number} toY
 * @param {number} toFloor
 * @param {string} shapeCode
 * @param {BuildingDef} def - building definition of the target machine
 * @param {number} inputIndex - which input port this belt feeds
 */
export function routeBelt(belts, fromX, fromY, fromFloor, toX, toY, toFloor, shapeCode, def, inputIndex) {
    // Determine if this is a merge input (machine has >1 input)
    const isMerge = def.inputs.length > 1 && inputIndex > 0;

    let x = fromX;
    let y = fromY;
    let floor = fromFloor;

    // Horizontal segment first: move east or west at source row
    if (x < toX) {
        while (x < toX) {
            belts.push({ x, y, floor, direction: 'E', kind: 'normal', shapeCode });
            x++;
        }
    } else if (x > toX) {
        while (x > toX) {
            belts.push({ x, y, floor, direction: 'W', kind: 'normal', shapeCode });
            x--;
        }
    }

    // If floor transition needed, insert belt lift before vertical segment
    if (floor !== toFloor) {
        // Place lift tile on source floor
        belts.push({ x, y, floor, direction: 'S', kind: 'lift', shapeCode });
        // Place lift tile on destination floor
        belts.push({ x, y, floor: toFloor, direction: 'S', kind: 'lift', shapeCode });
        floor = toFloor;
        y++; // advance past the lift tile
    }

    // Vertical segment: move south toward the target machine's back face
    while (y < toY) {
        belts.push({ x, y, floor, direction: 'S', kind: 'normal', shapeCode });
        y++;
    }

    // Guard: if we need to go north (shouldn't happen in normal layout)
    while (y > toY) {
        belts.push({ x, y, floor, direction: 'N', kind: 'normal', shapeCode });
        y--;
    }

    // Place a merge belt just above the target machine if this feeds a multi-input
    if (isMerge) {
        belts.push({
            x: toX,
            y: toY - 1,
            floor,
            direction: 'S',
            kind: 'merge',
            shapeCode
        });
    }
}
