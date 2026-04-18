/**
 * @typedef {Object} Topology
 * @property {Map<number, {step: Object, isBeltSplit: boolean}>} nodes
 * @property {Array<{from: number, to: number, shapeId: string, shapeCode: string}>} edges
 * @property {Map<string, string>} sources
 * @property {Map<string, number>} producedBy
 * @property {Map<string, number[]>} consumers
 */

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
export function groupIntoRows(sortedSteps, topology, solutionPath) {
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
