/**
 * Compute the tile-grid bounds (width/height) spanned by a set of placed
 * machines and belts.
 *
 * Width is the rightmost edge: machine right = x + (def width), belt right
 * = x + 1. Height is the bottommost edge: machine bottom = y + (def depth),
 * belt bottom = y + 1. The optional `gridWidth` / `gridHeight` seeds let a
 * caller start the accumulation from a known minimum (e.g. a row-derived
 * width that no machine reaches).
 *
 * Machine footprints read width/depth via optional chaining, so a machine
 * with no `def` falls back to a 1x1 footprint rather than throwing.
 *
 * @param {{x: number, y: number, def?: {width?: number, depth?: number}}[]} machines
 * @param {{x: number, y: number}[]} belts
 * @param {number} [gridWidth=0]  - starting minimum width
 * @param {number} [gridHeight=0] - starting minimum height
 * @returns {{gridWidth: number, gridHeight: number}}
 */
export function computeGridBounds(machines, belts, gridWidth = 0, gridHeight = 0) {
    for (const m of machines) {
        const right = m.x + (m.def?.width || 1);
        const bottom = m.y + (m.def?.depth || 1);
        if (right > gridWidth) gridWidth = right;
        if (bottom > gridHeight) gridHeight = bottom;
    }
    for (const b of belts) {
        if (b.x + 1 > gridWidth) gridWidth = b.x + 1;
        if (b.y + 1 > gridHeight) gridHeight = b.y + 1;
    }
    return { gridWidth, gridHeight };
}
