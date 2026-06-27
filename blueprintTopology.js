/**
 * @typedef {Object} Topology
 * @property {Map<number, {step: Object, isBeltSplit: boolean}>} nodes
 * @property {Array<{from: number, to: number, shapeId: string, shapeCode: string}>} edges
 * @property {Map<string, string>} sources
 * @property {Map<string, number>} producedBy
 * @property {Map<string, number[]>} consumers
 */

// ---------------------------------------------------------------------------
// 0) findDownstreamPlaceable — resolve a step's real downstream consumers
//    forward through Belt Splits (shared by topoSort and groupIntoRows)
// ---------------------------------------------------------------------------

/**
 * Walk forward through Belt Splits (pass-through nodes) to the real downstream
 * placeable (non-Belt-Split) consumer steps.
 *
 * A placeable step resolves to itself; a Belt Split resolves to the steps that
 * consume each of its outputs, followed recursively since splits can chain.
 * Missing nodes terminate the walk. `visited` guards against cycles and is
 * mutated across the recursion.
 *
 * Note: a non-Belt-Split node is exactly a placeable step in both call sites
 * (topoSort's `placeableSteps` and groupIntoRows' `placeableSteps` are each the
 * full set of non-Belt-Split steps), so testing `!node.isBeltSplit` here is
 * equivalent to the `placeableSteps.has(...)` check the callers used inline.
 *
 * @param {number} stepIdx        step to resolve
 * @param {Set<number>} visited   cycle guard (mutated)
 * @param {Map<number, {step: Object, isBeltSplit: boolean}>} nodes  topology.nodes
 * @param {Array<{from: number, to: number, shapeId: string}>} edges topology.edges
 * @returns {number[]} placeable step indices reachable downstream
 */
function findDownstreamPlaceable(stepIdx, visited, nodes, edges) {
    if (visited.has(stepIdx)) return [];
    visited.add(stepIdx);
    const node = nodes.get(stepIdx);
    if (!node) return [];
    if (!node.isBeltSplit) return [stepIdx];

    // Belt Split: follow each output to the steps that consume it.
    const results = [];
    for (const out of node.step.outputs) {
        for (const edge of edges) {
            if (edge.shapeId === out.id && edge.to !== stepIdx) {
                results.push(...findDownstreamPlaceable(edge.to, visited, nodes, edges));
            }
        }
    }
    return results;
}

/**
 * Resolve the topology's raw edges into effective from→to pairs between
 * placeable (non-Belt-Split) steps.
 *
 * `from` is always already placeable — extractTopology resolves producers back
 * through Belt Splits — so only the `to` side may be a Belt Split, which we walk
 * forward to its real downstream consumers via findDownstreamPlaceable. Edges
 * are deduped on `from-to`, so repeated shape flows between the same pair
 * collapse to a single effective edge.
 *
 * Shared by topoSort (for in-degree/adjacency) and groupIntoRows (for upstream
 * sets), which previously rebuilt this loop independently and could drift.
 *
 * @param {Topology} topology
 * @param {Set<number>} placeableSteps  non-Belt-Split step indices
 * @returns {Array<{from: number, to: number, shapeCode: string}>}
 */
function buildEffectiveEdges(topology, placeableSteps) {
    const { nodes, edges } = topology;
    const effectiveEdges = [];
    const edgeSet = new Set(); // dedup "from-to"

    for (const edge of edges) {
        // `from` is always a placeable step (resolved through Belt Splits)
        if (!placeableSteps.has(edge.from)) continue;

        const downstreams = placeableSteps.has(edge.to)
            ? [edge.to]
            : findDownstreamPlaceable(edge.to, new Set(), nodes, edges);

        for (const ds of downstreams) {
            const key = `${edge.from}-${ds}`;
            if (!edgeSet.has(key)) {
                edgeSet.add(key);
                effectiveEdges.push({ from: edge.from, to: ds, shapeCode: edge.shapeCode });
            }
        }
    }

    return effectiveEdges;
}

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
export function extractTopology(solutionPath) {
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
export function topoSort(topology) {
    const { nodes } = topology;

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

    // Effective edges between placeable steps (resolves the `to` side through
    // Belt Splits; shared with groupIntoRows).
    for (const eff of buildEffectiveEdges(topology, placeableSteps)) {
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
export function groupIntoRows(sortedSteps, topology, solutionPath) {
    // Build effective upstream map for placeable steps
    const placeableSteps = new Set(sortedSteps);
    const upstreamOf = new Map(); // stepIdx -> Set<stepIdx>
    for (const idx of placeableSteps) {
        upstreamOf.set(idx, new Set());
    }

    // Effective edges (resolving `to` through Belt Splits) — shared with topoSort.
    for (const eff of buildEffectiveEdges(topology, placeableSteps)) {
        upstreamOf.get(eff.to).add(eff.from);
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
