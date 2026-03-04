import { BUILDING_DATA } from './buildingData.js';

/**
 * @typedef {Object} PlacedMachine
 * @property {string} operation
 * @property {number} x              - grid column (top-left)
 * @property {number} y              - grid row (top-left)
 * @property {number} floor          - always 0 in MVP
 * @property {string[]} inputShapes  - shape codes flowing in
 * @property {string[]} outputShapes - shape codes flowing out
 * @property {Object} params         - forwarded from solutionPath (e.g. {color})
 * @property {BuildingDef} def       - from BUILDING_DATA
 */

/**
 * @typedef {Object} PlacedBelt
 * @property {number} x
 * @property {number} y
 * @property {number} floor
 * @property {'N'|'S'|'E'|'W'} direction
 * @property {'normal'|'split'|'merge'} kind
 * @property {string} [shapeCode]
 */

/**
 * @typedef {Object} BlueprintLayout
 * @property {PlacedMachine[]} machines
 * @property {PlacedBelt[]} belts
 * @property {number} gridWidth
 * @property {number} gridHeight
 * @property {number} floorCount
 */

/** Vertical distance between machine rows in tiles */
const ROW_PITCH = 4;

/** Horizontal gap between machines within a row */
const MACHINE_GAP = 1;

// ---------------------------------------------------------------------------
// 1) extractTopology — build dependency graph from solutionPath
// ---------------------------------------------------------------------------

/**
 * Build a dependency graph from the solutionPath.
 *
 * Returns:
 *   nodes    — Map<stepIndex, { step, isBeltSplit }>
 *   edges    — Array<{ from: stepIndex, to: stepIndex, shapeId, shapeCode }>
 *   sources  — Map<shapeId, shapeCode>  (inputs that no step produces)
 *   producedBy — Map<shapeId, stepIndex> (which step produces each shape ID)
 *   consumers  — Map<shapeId, stepIndex[]> (which steps consume each shape ID)
 */
function extractTopology(solutionPath) {
    const nodes = new Map();          // stepIndex -> { step, isBeltSplit }
    const edges = [];                 // { from, to, shapeId, shapeCode }
    const producedBy = new Map();     // shapeId -> stepIndex
    const consumers = new Map();      // shapeId -> [stepIndex, ...]
    const sources = new Map();        // shapeId -> shapeCode (not produced by any step)

    // Register all steps as nodes and record what each step produces
    for (let i = 0; i < solutionPath.length; i++) {
        const step = solutionPath[i];
        const isBeltSplit = step.operation === 'Belt Split';
        nodes.set(i, { step, isBeltSplit });

        for (const out of step.outputs) {
            producedBy.set(out.id, i);
        }
    }

    // For Belt Split steps, propagate production through the split.
    // A Belt Split takes one input and produces two copies.  We want
    // downstream consumers to see the *original* producing step, not the
    // Belt Split itself.  So we resolve chains of Belt Splits.
    //
    // resolveProducer(shapeId) returns { stepIndex, shapeCode } where
    // stepIndex is the real (non-Belt-Split) producer, or null for sources.
    function resolveProducer(shapeId, visited) {
        if (visited && visited.has(shapeId)) return null; // cycle guard
        const stepIdx = producedBy.get(shapeId);
        if (stepIdx === undefined) return null;
        const node = nodes.get(stepIdx);
        if (!node.isBeltSplit) return { stepIndex: stepIdx };

        // Belt Split: trace back to its input
        const beltStep = node.step;
        if (beltStep.inputs.length === 0) return null;
        const upstreamId = beltStep.inputs[0].id;
        const v = visited || new Set();
        v.add(shapeId);
        return resolveProducer(upstreamId, v);
    }

    // Build edges and identify sources
    for (let i = 0; i < solutionPath.length; i++) {
        const step = solutionPath[i];
        for (const inp of step.inputs) {
            const resolved = resolveProducer(inp.id, null);
            if (resolved !== null) {
                // Edge from producing step to consuming step
                edges.push({
                    from: resolved.stepIndex,
                    to: i,
                    shapeId: inp.id,
                    shapeCode: inp.shape
                });
            } else if (!producedBy.has(inp.id)) {
                // Truly not produced by any step — it's a source shape.
                // (Belt Split outputs that trace back to a source are NOT
                // sources themselves — they'll be handled by Belt Split
                // position assignment in assignPositions.)
                sources.set(inp.id, inp.shape);
            }

            // Track consumers
            if (!consumers.has(inp.id)) consumers.set(inp.id, []);
            consumers.get(inp.id).push(i);
        }
    }

    return { nodes, edges, sources, producedBy, consumers };
}

// ---------------------------------------------------------------------------
// 2) topoSort — Kahn's algorithm over the topology
// ---------------------------------------------------------------------------

/**
 * Topological sort via Kahn's algorithm.
 * Only sorts non-Belt-Split steps (those are pass-through and excluded from layout).
 *
 * @returns {number[]} Ordered step indices, sources first, sinks last.
 */
function topoSort(topology) {
    const { nodes, edges } = topology;

    // Collect only placeable (non-Belt-Split) step indices
    const placeableSteps = new Set();
    for (const [idx, node] of nodes) {
        if (!node.isBeltSplit) placeableSteps.add(idx);
    }

    // Build adjacency and in-degree for placeable steps only
    const inDegree = new Map();
    const adj = new Map();
    for (const idx of placeableSteps) {
        inDegree.set(idx, 0);
        adj.set(idx, []);
    }

    // We need edges between placeable steps.  The raw edges already resolve
    // Belt Splits (extractTopology resolves producers through Belt Splits),
    // but the *to* side might be a Belt Split.  We need to resolve that too.
    // Actually, the edges array has `to` pointing at the consuming step which
    // could be a Belt Split consuming the output of a real machine.
    // Let's build effective edges: for each raw edge, if `from` is placeable
    // and `to` is placeable, add directly.  If `to` is a Belt Split, follow
    // its outputs to find the real downstream consumers.

    function findDownstreamPlaceable(stepIdx, visited) {
        if (visited.has(stepIdx)) return [];
        visited.add(stepIdx);
        const node = nodes.get(stepIdx);
        if (!node) return [];
        if (!node.isBeltSplit) return [stepIdx];

        // Belt Split: follow its outputs to the consumers
        const results = [];
        for (const out of node.step.outputs) {
            // Find all steps that consume this output
            for (const edge of edges) {
                if (edge.shapeId === out.id && edge.to !== stepIdx) {
                    results.push(...findDownstreamPlaceable(edge.to, visited));
                }
            }
            // Also check: the output might be consumed by a step whose input has
            // the same ID (direct match without going through edges — the edges
            // were built from the `from` side resolved through Belt Splits, so
            // a Belt Split -> real machine edge would have `from` = real machine
            // upstream, `to` = real machine downstream.  So edges already skip
            // Belt Splits on the `from` side.  But the `to` side Belt Splits
            // need handling.)
        }
        return results;
    }

    // Collect effective edges between placeable steps
    const effectiveEdges = [];
    const edgeSet = new Set(); // dedup "from-to"

    for (const edge of edges) {
        // `from` is always a placeable step (resolved through Belt Splits)
        if (!placeableSteps.has(edge.from)) continue;

        const downstreams = placeableSteps.has(edge.to)
            ? [edge.to]
            : findDownstreamPlaceable(edge.to, new Set());

        for (const ds of downstreams) {
            const key = `${edge.from}-${ds}`;
            if (!edgeSet.has(key)) {
                edgeSet.add(key);
                effectiveEdges.push({
                    from: edge.from,
                    to: ds,
                    shapeCode: edge.shapeCode
                });
            }
        }
    }

    for (const eff of effectiveEdges) {
        inDegree.set(eff.to, (inDegree.get(eff.to) || 0) + 1);
        adj.get(eff.from).push(eff.to);
    }

    // Kahn's algorithm
    const queue = [];
    for (const [idx, deg] of inDegree) {
        if (deg === 0) queue.push(idx);
    }

    const sorted = [];
    while (queue.length > 0) {
        const cur = queue.shift();
        sorted.push(cur);
        for (const next of adj.get(cur)) {
            inDegree.set(next, inDegree.get(next) - 1);
            if (inDegree.get(next) === 0) {
                queue.push(next);
            }
        }
    }

    // If some nodes weren't reached (cycle), append them and warn
    const unreached = [...placeableSteps].filter(idx => !sorted.includes(idx));
    if (unreached.length > 0) {
        console.warn('Blueprint layout: cycle detected in topology, appending unreached steps:', unreached);
        sorted.push(...unreached);
    }

    return sorted;
}

// ---------------------------------------------------------------------------
// 3) groupIntoRows — assign topologically-sorted steps to layout rows
// ---------------------------------------------------------------------------

/**
 * Group topologically-sorted steps into rows for the grid layout.
 *
 * Strategy: each step's row = 1 + max row of its upstream dependencies.
 * Steps with no upstream dependencies (sources only) go in row 0.
 * This ensures that a step is always below all of its inputs.
 *
 * Belt Split steps are excluded from rows (they're not placed as machines).
 *
 * @returns {Map<number, number[]>} rowIndex -> [stepIndices in that row]
 */
function groupIntoRows(sortedSteps, topology, solutionPath) {
    const { nodes, edges } = topology;

    // Build effective upstream map for placeable steps
    const placeableSteps = new Set(sortedSteps);
    const upstreamOf = new Map(); // stepIdx -> Set<stepIdx>
    for (const idx of placeableSteps) {
        upstreamOf.set(idx, new Set());
    }

    // Use the same effective-edge logic as topoSort
    for (const edge of edges) {
        if (!placeableSteps.has(edge.from)) continue;

        // Resolve `to` through Belt Splits
        const resolveTo = (toIdx, visited) => {
            if (visited.has(toIdx)) return [];
            visited.add(toIdx);
            if (placeableSteps.has(toIdx)) return [toIdx];
            const node = nodes.get(toIdx);
            if (!node || !node.isBeltSplit) return [];
            const results = [];
            for (const out of node.step.outputs) {
                for (const e of edges) {
                    if (e.shapeId === out.id && e.to !== toIdx) {
                        results.push(...resolveTo(e.to, visited));
                    }
                }
            }
            return results;
        };

        const targets = placeableSteps.has(edge.to)
            ? [edge.to]
            : resolveTo(edge.to, new Set());

        for (const t of targets) {
            upstreamOf.get(t).add(edge.from);
        }
    }

    // Assign row numbers: row = max(upstream rows) + 1, or 0 if no upstream
    const rowOf = new Map();
    for (const idx of sortedSteps) {
        const upstream = upstreamOf.get(idx);
        if (!upstream || upstream.size === 0) {
            rowOf.set(idx, 0);
        } else {
            let maxRow = -1;
            for (const u of upstream) {
                const r = rowOf.get(u);
                if (r !== undefined && r > maxRow) maxRow = r;
            }
            rowOf.set(idx, maxRow + 1);
        }
    }

    // Collect steps into rows
    const rows = new Map();
    for (const idx of sortedSteps) {
        const r = rowOf.get(idx);
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r).push(idx);
    }

    return rows;
}

// ---------------------------------------------------------------------------
// 4) assignPositions — place machines and route belts on the tile grid
// ---------------------------------------------------------------------------

/**
 * Assign concrete (x, y) positions to machines and generate belt tiles
 * connecting them.
 *
 * Machine flow is top-to-bottom:
 *   - Inputs enter from the back (top / North side)
 *   - Outputs exit from the front (bottom / South side)
 *
 * @returns {BlueprintLayout}
 */
function assignPositions(rows, solutionPath, topology) {
    const { nodes, edges, sources, producedBy } = topology;

    const machines = [];
    const belts = [];

    // Sort row keys numerically
    const rowKeys = Array.from(rows.keys()).sort((a, b) => a - b);

    // --- Phase A: place machines row by row ---

    // machinePos: stepIndex -> { x, y, width, def }
    const machinePos = new Map();

    // Track the x-column of each output port: stepIndex -> [{ x, shapeId, shapeCode }]
    const outputPorts = new Map();

    // Source entry belts: shapeId -> { x, y, shapeCode }
    const sourceEntries = new Map();

    // First, figure out how wide each row is to center everything later
    const rowWidths = new Map();
    for (const rowIdx of rowKeys) {
        const stepsInRow = rows.get(rowIdx);
        let width = 0;
        for (let i = 0; i < stepsInRow.length; i++) {
            const stepIdx = stepsInRow[i];
            const step = solutionPath[stepIdx];
            const def = BUILDING_DATA[step.operation];
            if (!def) continue; // shouldn't happen for non-Belt-Split steps
            const machineWidth = def.width || 1;
            width += machineWidth;
            if (i < stepsInRow.length - 1) width += MACHINE_GAP;
        }
        rowWidths.set(rowIdx, width);
    }

    // Also account for source entry columns needed above row 0
    // Collect all source shapes
    const allSourceIds = Array.from(sources.keys());

    // Determine total grid width: max of all row widths and source entries
    let maxRowWidth = 0;
    for (const w of rowWidths.values()) {
        if (w > maxRowWidth) maxRowWidth = w;
    }
    // Source entries: each gets one column, packed with 1-tile gaps
    const sourceWidth = allSourceIds.length > 0
        ? allSourceIds.length + (allSourceIds.length - 1) * MACHINE_GAP
        : 0;
    if (sourceWidth > maxRowWidth) maxRowWidth = sourceWidth;

    // Ensure minimum width
    if (maxRowWidth < 1) maxRowWidth = 1;

    // Place source entry points at the very top (y = 0)
    const sourceY = 0;
    let sourceX = Math.floor((maxRowWidth - sourceWidth) / 2);
    if (sourceX < 0) sourceX = 0;

    for (let i = 0; i < allSourceIds.length; i++) {
        const shapeId = allSourceIds[i];
        const shapeCode = sources.get(shapeId);
        const x = sourceX + i * (1 + MACHINE_GAP);
        sourceEntries.set(shapeId, { x, y: sourceY, shapeCode });

        // Place a source entry belt (flowing south into the factory)
        belts.push({
            x,
            y: sourceY,
            floor: 0,
            direction: 'S',
            kind: 'normal',
            shapeCode
        });
    }

    // Machine rows start after the source entries, with ROW_PITCH gap
    const firstMachineY = allSourceIds.length > 0 ? sourceY + ROW_PITCH : 0;

    for (const rowIdx of rowKeys) {
        const stepsInRow = rows.get(rowIdx);
        const y = firstMachineY + rowIdx * ROW_PITCH;

        // Calculate this row's total width for centering
        const rw = rowWidths.get(rowIdx) || 0;
        let curX = Math.floor((maxRowWidth - rw) / 2);
        if (curX < 0) curX = 0;

        for (const stepIdx of stepsInRow) {
            const step = solutionPath[stepIdx];
            const def = BUILDING_DATA[step.operation];
            if (!def) continue;

            const machineWidth = def.width || 1;
            const machineDepth = def.depth || 1;

            machines.push({
                operation: step.operation,
                x: curX,
                y,
                floor: 0,
                inputShapes: step.inputs.map(inp => inp.shape),
                outputShapes: step.outputs.map(out => out.shape),
                params: step.params || {},
                def
            });

            machinePos.set(stepIdx, { x: curX, y, width: machineWidth, depth: machineDepth, def });

            // Record output ports
            const ports = [];
            for (let oi = 0; oi < step.outputs.length; oi++) {
                const out = step.outputs[oi];
                const portOffset = def.outputs[oi] ? def.outputs[oi].offset : oi;
                ports.push({
                    x: curX + portOffset,
                    y: y + machineDepth, // front face = bottom edge + depth
                    shapeId: out.id,
                    shapeCode: out.shape
                });
            }
            outputPorts.set(stepIdx, ports);

            curX += machineWidth + MACHINE_GAP;
        }
    }

    // --- Phase B: route belts between output ports and input ports ---

    // Build a lookup: shapeId -> output port position
    const outputPortLookup = new Map(); // shapeId -> { x, y, shapeCode }
    for (const [stepIdx, ports] of outputPorts) {
        for (const port of ports) {
            outputPortLookup.set(port.shapeId, {
                x: port.x,
                y: port.y,
                shapeCode: port.shapeCode
            });
        }
    }

    // Also add source entries to the lookup
    for (const [shapeId, entry] of sourceEntries) {
        outputPortLookup.set(shapeId, {
            x: entry.x,
            y: entry.y + 1, // belt exits from source tile going south
            shapeCode: entry.shapeCode
        });
    }

    // Belt Split handling: a Belt Split step's input shape ID maps to its
    // outputs.  We need to propagate the physical position of the upstream
    // output through Belt Splits so that each downstream consumer can find
    // its source position.
    //
    // For each Belt Split, we place a split belt at the upstream output
    // position and create virtual output entries for each of the split's
    // outputs.

    // Resolve Belt Split outputs
    for (let i = 0; i < solutionPath.length; i++) {
        const step = solutionPath[i];
        if (step.operation !== 'Belt Split') continue;

        const inputId = step.inputs[0].id;
        const upstreamPos = outputPortLookup.get(inputId);
        if (!upstreamPos) continue;

        // Place a split belt at the upstream position
        belts.push({
            x: upstreamPos.x,
            y: upstreamPos.y,
            floor: 0,
            direction: 'S',
            kind: 'split',
            shapeCode: step.inputs[0].shape
        });

        // Each output of the Belt Split gets a virtual position
        // If multiple outputs, spread them horizontally
        for (let oi = 0; oi < step.outputs.length; oi++) {
            const out = step.outputs[oi];
            const offsetX = oi === 0 ? 0 : oi; // first output stays in-line
            outputPortLookup.set(out.id, {
                x: upstreamPos.x + offsetX,
                y: upstreamPos.y + 1,
                shapeCode: out.shape
            });
        }
    }

    // Now route belts for each non-Belt-Split step's inputs
    const placeableSteps = new Set();
    for (const [idx, node] of nodes) {
        if (!node.isBeltSplit) placeableSteps.add(idx);
    }

    for (const stepIdx of placeableSteps) {
        const step = solutionPath[stepIdx];
        const pos = machinePos.get(stepIdx);
        if (!pos) continue;
        const def = pos.def;

        for (let ii = 0; ii < step.inputs.length; ii++) {
            const inp = step.inputs[ii];
            // For multi-input machines with same offset on different floors (e.g. Stacker),
            // spread inputs across columns to avoid overlapping belts in 2D layout.
            let inputOffset = def.inputs[ii] ? def.inputs[ii].offset : ii;
            if (ii > 0 && def.inputs[ii] && def.inputs[ii - 1] &&
                def.inputs[ii].offset === def.inputs[ii - 1].offset) {
                inputOffset = ii; // Use sequential offset instead
            }
            const inputX = pos.x + inputOffset;
            const inputY = pos.y; // back face = top of machine

            // Find where this shape comes from
            const src = outputPortLookup.get(inp.id);
            if (!src) continue;

            // Route a simple belt path from src to input port
            // Strategy: go south from src to the right y, then go east/west
            // to the right x, or route vertically then horizontally.
            routeBelt(belts, src.x, src.y, inputX, inputY, inp.shape, def, ii);
        }
    }

    // --- Phase C: compute grid bounds ---

    let gridWidth = maxRowWidth;
    let gridHeight = 0;

    for (const m of machines) {
        const mDef = m.def;
        const right = m.x + (mDef.width || 1);
        const bottom = m.y + (mDef.depth || 1);
        if (right > gridWidth) gridWidth = right;
        if (bottom > gridHeight) gridHeight = bottom;
    }
    for (const b of belts) {
        if (b.x + 1 > gridWidth) gridWidth = b.x + 1;
        if (b.y + 1 > gridHeight) gridHeight = b.y + 1;
    }

    return {
        machines,
        belts,
        gridWidth,
        gridHeight,
        floorCount: 1
    };
}

// ---------------------------------------------------------------------------
// Belt routing helper
// ---------------------------------------------------------------------------

/**
 * Route belt tiles from (fromX, fromY) to (toX, toY).
 * Uses an L-shaped path: horizontal first (at source row), then vertical
 * down into the target machine's back face.  This keeps horizontal segments
 * in the gap space between machine rows instead of overlapping machine tiles.
 *
 * If the step has multiple inputs (merge), annotate the merge point.
 *
 * @param {PlacedBelt[]} belts - array to push belt tiles into
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @param {string} shapeCode
 * @param {BuildingDef} def - building definition of the target machine
 * @param {number} inputIndex - which input port this belt feeds
 */
function routeBelt(belts, fromX, fromY, toX, toY, shapeCode, def, inputIndex) {
    // Determine if this is a merge input (machine has >1 input)
    const isMerge = def.inputs.length > 1 && inputIndex > 0;

    let x = fromX;
    let y = fromY;

    // Horizontal segment first: move east or west at source row
    if (x < toX) {
        while (x < toX) {
            belts.push({
                x,
                y,
                floor: 0,
                direction: 'E',
                kind: 'normal',
                shapeCode
            });
            x++;
        }
    } else if (x > toX) {
        while (x > toX) {
            belts.push({
                x,
                y,
                floor: 0,
                direction: 'W',
                kind: 'normal',
                shapeCode
            });
            x--;
        }
    }

    // Vertical segment: move south toward the target machine's back face
    while (y < toY) {
        belts.push({
            x,
            y,
            floor: 0,
            direction: 'S',
            kind: 'normal',
            shapeCode
        });
        y++;
    }

    // Guard: if we need to go north (shouldn't happen in normal layout)
    while (y > toY) {
        belts.push({
            x,
            y,
            floor: 0,
            direction: 'N',
            kind: 'normal',
            shapeCode
        });
        y--;
    }

    // Place a merge belt just above the target machine if this feeds a multi-input
    if (isMerge) {
        belts.push({
            x: toX,
            y: toY - 1,
            floor: 0,
            direction: 'S',
            kind: 'merge',
            shapeCode
        });
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a solver solutionPath into a spatial factory layout.
 *
 * @param {Object[]} solutionPath - Array of step objects from the solver.
 *   Each step has: { operation, inputs: [{id, shape}], outputs: [{id, shape}], params }
 *
 * @returns {BlueprintLayout} Layout with placed machines and belt tiles.
 */
export function buildLayout(solutionPath) {
    if (!solutionPath || solutionPath.length === 0) {
        return {
            machines: [],
            belts: [],
            gridWidth: 0,
            gridHeight: 0,
            floorCount: 1
        };
    }

    // Step 1: build dependency graph
    const topology = extractTopology(solutionPath);

    // Step 2: topological sort (excluding Belt Splits)
    const sorted = topoSort(topology);

    // Step 3: group into rows
    const rows = groupIntoRows(sorted, topology, solutionPath);

    // Step 4: assign positions and route belts
    const layout = assignPositions(rows, solutionPath, topology);

    return layout;
}
