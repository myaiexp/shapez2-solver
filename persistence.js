export const STORAGE_KEY = 'shapez2-solver-state-v1';
export const SCHEMA_VERSION = 1;

const $ = (sel) => document.querySelector(sel);
const $all = (sel) => Array.from(document.querySelectorAll(sel));
const byId = (id) => document.getElementById(id);

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

export function captureState(runtime) {
    const inputs = {};
    for (const [field, { id, kind }] of Object.entries(INPUT_FIELDS)) {
        const el = byId(id);
        if (!el) continue;
        inputs[field] = kind === 'checked' ? el.checked : el.value;
    }
    inputs.startingShapes = $all('#starting-shapes .shape-item .shape-label').map((el) => el.textContent);
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
    if (state.solution && Array.isArray(state.solution.solutionPath)) {
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
