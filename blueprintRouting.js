/**
 * Route belt tiles from `from` to `to`.
 * Uses an L-shaped path: horizontal first (at source row), then vertical
 * down into the target machine's back face.  This keeps horizontal segments
 * in the gap space between machine rows instead of overlapping machine tiles.
 *
 * When the floors differ, inserts belt lift tiles at the transition point.
 *
 * A route never heads north: machines take input from the north, so a belt
 * arriving from the south would enter through the output side. The layout's row
 * pitch keeps every source above its target (rowPitchFor), and a route that
 * would reverse throws before placing any tile.
 *
 * @param {PlacedBelt[]} belts - array to push belt tiles into
 * @param {Object} route
 * @param {{x: number, y: number, floor: number}} route.from
 * @param {{x: number, y: number, floor: number}} route.to
 * @param {string} route.shapeCode
 * @param {boolean} route.isMerge - place a merge tile just above the target
 */
export function routeBelt(belts, { from, to, shapeCode, isMerge }) {
    const needsLift = from.floor !== to.floor;
    if (from.y + (needsLift ? 1 : 0) > to.y) {
        throw new Error(`routeBelt: ${shapeCode} would run north from y=${from.y} to y=${to.y}`);
    }

    const { x: toX, y: toY, floor: toFloor } = to;
    let { x, y, floor } = from;

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

    if (needsLift) {
        belts.push({ x, y, floor, direction: 'S', kind: 'lift', shapeCode });
        belts.push({ x, y, floor: toFloor, direction: 'S', kind: 'lift', shapeCode });
        floor = toFloor;
        y++; // advance past the lift tile
    }

    while (y < toY) {
        belts.push({ x, y, floor, direction: 'S', kind: 'normal', shapeCode });
        y++;
    }

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
