import { buildLayout, duplicateForThroughput } from './blueprintLayout.js';

// Throughput multiplier from the form's raw value: a positive integer, else 1
// (blank, '0', negatives and non-numbers all mean "no duplication").
export function parseThroughputMultiplier(value) {
    const n = parseInt(value, 10);
    return n >= 1 ? n : 1;
}

export function buildSolutionLayout(solutionPath, multiplier) {
    const layout = buildLayout(solutionPath);
    return multiplier > 1 ? duplicateForThroughput(layout, multiplier) : layout;
}

// Compact one-line summary of which Constructive strategies fired, derived from
// the strategyTrace alone: method breakdown (splits → direct-searches), total op
// count, and how many sub-shapes were shared (reused) across the plan.
export function summarizeStrategyTrace(trace) {
    const methodCounts = {};
    const targetCounts = {};
    (function walk(node) {
        methodCounts[node.method] = (methodCounts[node.method] || 0) + 1;
        targetCounts[node.target] = (targetCounts[node.target] || 0) + 1;
        node.children.forEach(walk);
    })(trace);
    const reused = Object.values(targetCounts).filter((c) => c > 1).length;
    const splits = Object.entries(methodCounts)
        .filter(([m]) => m !== 'direct-search')
        .map(([m, c]) => `${m} ×${c}`);
    const searches = methodCounts['direct-search'] || 0;
    const breakdown = splits.length ? `${splits.join(', ')} → ${searches} direct-searches` : 'direct-search';
    return `Constructive: ${breakdown} | ${trace.opCount} ops | reused ${reused}`;
}

// Status line for a solved result — shared by a live solve and a restored one,
// so both read the same (including the Constructive summary when present).
export function solvedStatusText(solution) {
    const base = `Solved in ${solution.solveTimeSec}s at Depth ${solution.depth} → ${solution.statesExplored} States`;
    return solution.strategyTrace ? `${base} | ${summarizeStrategyTrace(solution.strategyTrace)}` : base;
}

// result.aborted code → status-line builder for a solve that found no path.
const ABORT_MESSAGES = {
    maxStates: (result) => `No solution found — search hit the state limit (${result.statesExplored} states). Try BFS, a larger heuristic divisor, or a simpler target.`,
    preventWaste: () => 'No solution found — a plan exists but leftover waste cannot be removed (enable Trash, or disable Prevent Waste).',
    'path-invalid': () => 'No solution found — constructive assembly produced a path that does not hold the target.',
    'no-decomposition': (result) => `No solution found — no constructive split solved this target within the node budget (${result.statesExplored} states).`,
};

// Status line for a failed solve; `result` may be null when the worker sent nothing.
export function solveFailureMessage(result) {
    const build = Object.hasOwn(ABORT_MESSAGES, result?.aborted) ? ABORT_MESSAGES[result.aborted] : null;
    return build ? build(result) : 'No solution found.';
}

// Status line for an explore result; shapeExplorerCore's maxNodes abort means
// the last level is partial.
export function exploreStatus(result, depthLimit) {
    const counts = `${result.shapes.length} shapes, ${result.ops.length} ops`;
    return result.aborted === 'maxNodes'
        ? `Explored ${counts} — stopped at the ${result.maxNodes}-node cap partway through depth ${result.depth} of ${depthLimit}. Lower the depth or disable operations for a complete graph.`
        : `Exploration complete — ${counts}.`;
}
