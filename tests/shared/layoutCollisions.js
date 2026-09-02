// Collision counters for layout snapshots. Belt routing is L-shaped with no
// obstacle avoidance, so overlapping belt tiles are expected today; the
// snapshot records the count so a routing change that doubles (or clears)
// them is a visible diff rather than a silent one.

function tileKey(x, y, floor) {
    return `${x},${y},${floor}`;
}

/** Count of distinct (x, y, floor) positions that carry more than one belt. */
export function overlappingBeltTiles(belts) {
    const counts = new Map();
    for (const b of belts) {
        const key = tileKey(b.x, b.y, b.floor);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    let overlapping = 0;
    for (const n of counts.values()) {
        if (n > 1) overlapping++;
    }
    return overlapping;
}

function machineFootprintKeys(machine) {
    const width = machine.def?.width || 1;
    const depth = machine.def?.depth || 1;
    const floors = machine.def?.floors || 1;
    const baseFloor = machine.floor ?? 0;
    const keys = [];
    for (let dx = 0; dx < width; dx++) {
        for (let dy = 0; dy < depth; dy++) {
            for (let df = 0; df < floors; df++) {
                keys.push(tileKey(machine.x + dx, machine.y + dy, baseFloor + df));
            }
        }
    }
    return keys;
}

/** Count of distinct belt (x, y, floor) positions that sit on a machine footprint. */
export function beltsOverMachineFootprint(belts, machines) {
    const footprint = new Set();
    for (const m of machines) {
        for (const key of machineFootprintKeys(m)) footprint.add(key);
    }
    const hit = new Set();
    for (const b of belts) {
        const key = tileKey(b.x, b.y, b.floor);
        if (footprint.has(key)) hit.add(key);
    }
    return hit.size;
}
