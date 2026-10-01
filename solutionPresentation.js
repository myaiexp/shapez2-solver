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
