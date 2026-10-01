import { SHAPE_LABEL_CLASS } from './domConstants.js';
import { $, $all, byId } from './domUtils.js';
import { operations } from './shapeSolverOperations.js';

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
// shape code and an id; ops with needsColor (Painter / Crystal Generator, via
// the shared operations table) additionally need a params.color string, which
// the renderer dereferences unconditionally.
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
    if (operations[step.operation]?.needsColor && (!step.params || typeof step.params.color !== 'string')) return false;
    return true;
}

// True for an empty path (a valid "no steps" solution) or one whose every step is
// structurally sound. Rejects the corrupt-but-versioned payloads described above.
export function isValidSolutionPath(path) {
    return Array.isArray(path) && path.every(isValidStep);
}

// A Constructive strategyTrace node: method/target strings and child nodes. The
// root also carries opCount. Only the status-line summary reads it, so a corrupt
// trace is dropped rather than failing the whole restore.
function isValidTraceNode(node) {
    return !!node && typeof node === 'object'
        && typeof node.method === 'string' && typeof node.target === 'string'
        && Array.isArray(node.children) && node.children.every(isValidTraceNode);
}

function isValidStrategyTrace(trace) {
    return isValidTraceNode(trace) && typeof trace.opCount === 'number';
}

// The persisted solution in the shape a live solve presents, or null when its
// path fails isValidSolutionPath.
function restorableSolution(solution) {
    if (!solution || !isValidSolutionPath(solution.solutionPath)) return null;
    const { solutionPath, depth, statesExplored, solveTimeSec, strategyTrace } = solution;
    return {
        solutionPath, depth, statesExplored, solveTimeSec,
        ...(isValidStrategyTrace(strategyTrace) && { strategyTrace }),
    };
}

// The string entries of a persisted list, or null when the value isn't an array.
function stringList(value) {
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : null;
}

// Switch a tab group only when the named button and panel both exist. Clearing
// first and then failing the lookup (a stale or corrupt tab name) would leave the
// group with no active tab — a blank sidebar or output pane.
function activateTab(buttonClass, contentClass, btn, content) {
    if (!btn || !content) return;
    $all(`.${buttonClass}`).forEach((b) => b.classList.remove('active'));
    $all(`.${contentClass}`).forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    content.classList.add('active');
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

// Form, shapes, ops, tabs and graph selects are written straight into the page;
// the solution is only validated and handed back — main.js's presentSolution
// draws it, the same path a live solve takes. deps.createShapeItem builds a
// starting-shape row.
export function applyState(state, deps) {
    for (const [field, { id, kind }] of Object.entries(INPUT_FIELDS)) {
        const el = byId(id);
        if (!el || !(field in state.inputs)) continue;
        if (kind === 'checked') el.checked = !!state.inputs[field];
        else el.value = state.inputs[field];
    }

    // Like the form fields above, an absent list means "no saved value" and leaves
    // the page defaults alone; an explicit [] clears. A non-array (a corrupt string
    // would otherwise be iterated char-by-char into bogus shapes) counts as absent.
    const startingShapes = stringList(state.inputs.startingShapes);
    if (startingShapes) {
        const startingContainer = byId('starting-shapes');
        startingContainer.replaceChildren();
        for (const code of startingShapes) {
            startingContainer.appendChild(deps.createShapeItem(code));
        }
    }

    const enabledOperations = stringList(state.inputs.enabledOperations);
    if (enabledOperations) {
        const enabledSet = new Set(enabledOperations);
        $all('#enabled-operations .operation-item').forEach((el) => {
            el.classList.toggle('enabled', enabledSet.has(el.dataset.operation));
        });
    }

    byId('search-method-select').dispatchEvent(new Event('change'));

    const sidebarTab = state.view.activeSidebarTab;
    if (sidebarTab) {
        activateTab('tab-button', 'tab-content', byId(`${sidebarTab}-tab-btn`), byId(`${sidebarTab}-content`));
    }
    const outputView = state.view.activeOutputView;
    if (outputView) {
        activateTab('view-tab-button', 'view-tab-content', byId(`${outputView}-view-tab-btn`), byId(`${outputView}-view`));
    }

    const directionSel = byId('direction-select');
    if (state.view.graphDirection && directionSel) directionSel.value = state.view.graphDirection;
    const edgeStyleSel = byId('edge-style-select');
    if (state.view.edgeStyle && edgeStyleSel) edgeStyleSel.value = state.view.edgeStyle;

    return {
        solution: restorableSolution(state.solution),
        restoredFloor: state.view.blueprintFloor ?? 0,
    };
}
