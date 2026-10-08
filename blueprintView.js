// Blueprint renderer lifetime. The renderer exists for the whole time the
// Blueprint tab is showing, including a restore that has no layout yet —
// present() only pushes a layout when a renderer is already there, so a tab
// restored empty would otherwise stay blank after the next solve. Changing the
// throughput multiplier rebuilds the layout from the last solution; Copy
// Blueprint exports that layout, not the multiplier from solve time.
import { parseThroughputMultiplier, buildSolutionLayout } from './solutionPresentation.js';

export function createBlueprintView({ createRenderer, onViewChanged }) {
    let renderer = null;
    let layout = null;
    let solution = null;

    function notify() {
        onViewChanged?.();
    }

    function showOutputView(view) {
        if (view === 'blueprint') {
            if (!renderer) renderer = createRenderer();
            if (layout) renderer.setLayout(layout);
        } else if (renderer) {
            renderer.destroy();
            renderer = null;
        }
        notify();
    }

    function present(next, multiplierRaw) {
        solution = next;
        layout = buildSolutionLayout(next.solutionPath, parseThroughputMultiplier(multiplierRaw));
        if (renderer) renderer.setLayout(layout);
        notify();
        return layout;
    }

    // No solution yet: the form can change without inventing a layout.
    function setThroughputMultiplier(multiplierRaw) {
        if (!solution) return false;
        present(solution, multiplierRaw);
        return true;
    }

    // Split so the caller can clear the flowchart between dropping the solution
    // and blanking the canvas. A throw from either view cannot leave the stored
    // solution pointing at a solve that is no longer current.
    function forget() {
        solution = null;
        layout = null;
    }

    function blank() {
        if (renderer) renderer.setLayout(null);
        notify();
    }

    return {
        showOutputView,
        present,
        setThroughputMultiplier,
        forget,
        blank,
        get renderer() { return renderer; },
        get layout() { return layout; },
        get solution() { return solution; },
    };
}
