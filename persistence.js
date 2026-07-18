import { SHAPE_LABEL_CLASS } from './domConstants.js';
import { $, $all, byId } from './domUtils.js';

export const STORAGE_KEY = 'shapez2-solver-state-v1';
export const SCHEMA_VERSION = 1;

const INPUT_FIELDS = {
    target: { id: 'target-shape', kind: 'value' },
    depthLimit: { id: 'depth-limit-input', kind: 'value' },
    searchMethod: { id: 'search-method-select', kind: 'value' },
    maxStatesPerLevel: { id: 'max-states-per-level', kind: 'value' },
    heuristicDivisor: { id: 'heuristic-divisor', kind: 'value' },
    preventWaste: { id: 'prevent-waste', kind: 'checked' },
    orientationSensitive: { id: 'orientation-sensitive', kind: 'checked' },
    monolayerPainting: { id: 'monolayer-painting', kind: 'checked' },
    filterUnusedShapes: { id: 'filter-unused-shapes', kind: 'checked' },
    throughputMultiplier: { id: 'throughput-multiplier', kind: 'value' },
    maxLayers: { id: 'max-layers', kind: 'value' },
    colorMode: { id: 'color-mode-select', kind: 'value' },
};

export function loadState() {
    let raw;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;
    let state;
    try {
        state = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!state || state.version !== SCHEMA_VERSION) return null;
    if (!state.inputs || !state.view) return null;
    return state;
}

export function saveState(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
        console.warn('Failed to persist solver state:', err);
    }
}

// Wipe persisted solver state so the next page load uses defaults.
// Used by the Reset button and the restore-failure path; storage errors are
// swallowed like save/load. Returns true iff the key was actually removed —
// callers that reload on failure check this to avoid a reload loop when the
// backing store itself is throwing.
export function clearState() {
    try {
        localStorage.removeItem(STORAGE_KEY);
        return true;
    } catch (err) {
        console.warn('Failed to clear solver state:', err);
        return false;
    }
}

// Structural validation of a persisted solutionPath before it reaches the graph
// / blueprint renderers. loadState only checks the top-level version/inputs/view
// shape, so a versioned-but-corrupt solution would otherwise flow straight into
// renderGraph/buildLayout — either throwing mid-render (leaving a half-applied
// UI) or drawing an inconsistent graph. Each step must carry a non-empty
// operation name plus input/output endpoint arrays whose entries expose a string
// shape code and an id; colored ops (Painter / Crystal Generator) additionally
// need a params.color string, which the renderer dereferences unconditionally.
const COLORED_OPS = new Set(['Painter', 'Crystal Generator']);

function isValidEndpoint(e) {
    return !!e && typeof e === 'object'
        && typeof e.shape === 'string' && e.shape.length > 0
        && (typeof e.id === 'string' || typeof e.id === 'number');
}

function isValidStep(step) {
    if (!step || typeof step !== 'object') return false;
    if (typeof step.operation !== 'string' || step.operation.length === 0) return false;
    if (!Array.isArray(step.inputs) || !step.inputs.every(isValidEndpoint)) return false;
    if (!Array.isArray(step.outputs) || !step.outputs.every(isValidEndpoint)) return false;
    if (COLORED_OPS.has(step.operation) && (!step.params || typeof step.params.color !== 'string')) return false;
    return true;
}

// True for an empty path (a valid "no steps" solution) or one whose every step is
// structurally sound. Rejects the corrupt-but-versioned payloads described above.
export function isValidSolutionPath(path) {
    return Array.isArray(path) && path.every(isValidStep);
}

export function captureState(runtime) {
    const inputs = {};
    for (const [field, { id, kind }] of Object.entries(INPUT_FIELDS)) {
        const el = byId(id);
        if (!el) continue;
        inputs[field] = kind === 'checked' ? el.checked : el.value;
    }
    inputs.startingShapes = $all(`#starting-shapes .shape-item .${SHAPE_LABEL_CLASS}`).map((el) => el.textContent);
    inputs.enabledOperations = $all('#enabled-operations .operation-item.enabled').map((el) => el.dataset.operation);

    const sidebarBtn = $('.tab-button.active');
    const viewBtn = $('.view-tab-button.active');

    return {
        version: SCHEMA_VERSION,
        inputs,
        solution: runtime.currentSolution,
        view: {
            activeSidebarTab: sidebarBtn ? sidebarBtn.id.replace('-tab-btn', '') : 'shapes',
            activeOutputView: viewBtn ? viewBtn.id.replace('-view-tab-btn', '') : 'flowchart',
            graphDirection: byId('direction-select')?.value ?? 'TB',
            edgeStyle: byId('edge-style-select')?.value ?? '',
            blueprintFloor: runtime.currentBlueprintFloor ?? 0,
        },
    };
}

export function applyState(state, deps) {
    for (const [field, { id, kind }] of Object.entries(INPUT_FIELDS)) {
        const el = byId(id);
        if (!el || !(field in state.inputs)) continue;
        if (kind === 'checked') el.checked = !!state.inputs[field];
        else el.value = state.inputs[field];
    }

    const startingContainer = byId('starting-shapes');
    startingContainer.replaceChildren();
    for (const code of state.inputs.startingShapes ?? []) {
        startingContainer.appendChild(deps.createShapeItem(code));
    }

    const enabledSet = new Set(state.inputs.enabledOperations ?? []);
    $all('#enabled-operations .operation-item').forEach((el) => {
        el.classList.toggle('enabled', enabledSet.has(el.dataset.operation));
    });

    byId('search-method-select').dispatchEvent(new Event('change'));

    const sidebarTab = state.view.activeSidebarTab;
    if (sidebarTab) {
        $all('.tab-button').forEach((b) => b.classList.remove('active'));
        $all('.tab-content').forEach((c) => c.classList.remove('active'));
        const btn = byId(`${sidebarTab}-tab-btn`);
        const content = byId(`${sidebarTab}-content`);
        if (btn && content) {
            btn.classList.add('active');
            content.classList.add('active');
        }
    }

    const outputView = state.view.activeOutputView;
    if (outputView) {
        $all('.view-tab-button').forEach((b) => b.classList.remove('active'));
        $all('.view-tab-content').forEach((c) => c.classList.remove('active'));
        const btn = byId(`${outputView}-view-tab-btn`);
        const content = byId(`${outputView}-view`);
        if (btn && content) {
            btn.classList.add('active');
            content.classList.add('active');
        }
    }

    const directionSel = byId('direction-select');
    if (state.view.graphDirection && directionSel) directionSel.value = state.view.graphDirection;
    const edgeStyleSel = byId('edge-style-select');
    if (state.view.edgeStyle && edgeStyleSel) edgeStyleSel.value = state.view.edgeStyle;

    let restoredSolution = false;
    if (state.solution && isValidSolutionPath(state.solution.solutionPath)) {
        deps.renderGraph(state.solution.solutionPath);
        if (state.view.graphDirection) deps.applyGraphLayout(state.view.graphDirection);

        let layout = deps.buildLayout(state.solution.solutionPath);
        const multiplier = parseInt(state.inputs.throughputMultiplier, 10) || 1;
        if (multiplier > 1) layout = deps.duplicateForThroughput(layout, multiplier);
        deps.setBlueprintLayout(layout);

        byId('status').textContent =
            `Solved in ${state.solution.solveTimeSec}s at Depth ${state.solution.depth} → ${state.solution.statesExplored} States`;
        restoredSolution = true;
    }

    return {
        restoredSolution,
        restoredFloor: state.view.blueprintFloor ?? 0,
    };
}
