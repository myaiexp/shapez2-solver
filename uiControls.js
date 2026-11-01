// The one place that knows the sidebar's markup: it builds and reads the
// starting-shape rows, reads the operation toggles and every saved form field,
// shows the controls the search method uses, and owns the two tab groups'
// class/id conventions. main.js and persistence.js both go through here, so a
// markup change is a single edit.
import { createShapeElement } from './shapeRendering.js';
import { COLOR_MODE_SELECT_ID, SHAPE_LABEL_CLASS } from './domConstants.js';
import { $, $all, byId } from './domUtils.js';
import { DEFAULT_EXPLORE_DEPTH, MAX_EXPLORE_DEPTH, DEFAULT_EXPLORE_MAX_NODES } from './exploreDepth.js';

// Every saved form field: its key in the persisted `inputs` (renaming a key drops
// that field from existing saves), its element id, and the element property that
// holds its value. persistence.js walks this table and the readers below look up
// their ids here, so a field is declared once.
export const FORM_FIELDS = {
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
    colorMode: { id: COLOR_MODE_SELECT_ID, kind: 'value' },
};

const fieldEl = (name) => byId(FORM_FIELDS[name].id);
const fieldValue = (name) => fieldEl(name)[FORM_FIELDS[name].kind];

export const onFieldChange = (name, handler) => fieldEl(name).addEventListener('change', handler);

// Row markup the remove handler and the restore path both depend on: a
// .shape-item containing the rendered code and a .remove-shape button.
export function createShapeItem(shapeCode) {
    const item = document.createElement('div');
    item.className = 'shape-item';

    const removeBtn = document.createElement('span');
    removeBtn.className = 'remove-shape';
    removeBtn.textContent = '×';
    removeBtn.dataset.shape = shapeCode;

    item.appendChild(createShapeElement(shapeCode));
    item.appendChild(removeBtn);
    return item;
}

export function setStartingShapes(codes) {
    const container = byId('starting-shapes');
    container.replaceChildren();
    for (const code of codes) container.appendChild(createShapeItem(code));
}

export function addStartingShape(code) {
    byId('starting-shapes').appendChild(createShapeItem(code));
}

export const readStartingShapes = () =>
    $all(`#starting-shapes .shape-item .${SHAPE_LABEL_CLASS}`).map((el) => el.textContent);

export const operationItems = () => $all('#enabled-operations .operation-item');

export const readEnabledOperations = () =>
    operationItems().filter((el) => el.classList.contains('enabled')).map((el) => el.dataset.operation);

// 0 and NaN both mean "the field is blank or junk" and take the default.
function readInt(name, fallback) {
    return parseInt(fieldValue(name)) || fallback;
}

export const readMaxLayers = () => readInt('maxLayers', 4);
export const readTargetShape = () => fieldValue('target').trim();
// Unparsed: buildExploreRequest clamps it.
export const readExploreDepth = () => fieldValue('depthLimit');
export const readThroughputMultiplier = () => fieldValue('throughputMultiplier');

// The form's half of buildSolveRequest's arguments, under the names it destructures.
export function readSolveOptions() {
    return {
        maxLayers: readMaxLayers(),
        budget: readInt('maxStatesPerLevel', 1000),
        preventWaste: fieldValue('preventWaste'),
        orientationSensitive: fieldValue('orientationSensitive'),
        monolayerPainting: fieldValue('monolayerPainting'),
        heuristicDivisor: parseFloat(fieldValue('heuristicDivisor')) || 0.1,
        searchMethod: fieldValue('searchMethod'),
        filterUnusedShapes: fieldValue('filterUnusedShapes'),
    };
}

// A*/IDA*/Bidirectional use the heuristic divisor; BFS shows beam width
// (maxStatesPerLevel); Constructive shows its per-node A* budget (nodeBudget).
// Same input, two payload keys — not the global maxStates ceiling (the browser
// stays uncapped and relies on Cancel).
export function syncSearchMethodControls() {
    const method = fieldValue('searchMethod');
    const heuristicGroup = fieldEl('heuristicDivisor').closest('.option-group');
    const budgetGroup = fieldEl('maxStatesPerLevel').closest('.option-group');
    const usesHeuristic = method === 'A*' || method === 'IDA*' || method === 'Bidirectional';
    const usesBudgetControl = method === 'BFS' || method === 'Constructive';
    heuristicGroup.style.display = usesHeuristic ? 'block' : 'none';
    budgetGroup.style.display = usesBudgetControl ? 'block' : 'none';
    budgetGroup.querySelector('label').textContent =
        method === 'Constructive' ? 'Node Search Budget' : 'Max States Per Level';
}

// Put the explore-depth bounds on the input, from the same constants
// clampExploreDepth enforces. Seeding a value makes the default explicit rather
// than implicit in an empty field; a restored value overwrites it.
export function initExploreDepthInput() {
    const input = fieldEl('depthLimit');
    input.max = String(MAX_EXPLORE_DEPTH);
    input.placeholder = `Depth (${DEFAULT_EXPLORE_DEPTH})`;
    input.title = `Operation steps to explore (1-${MAX_EXPLORE_DEPTH}). `
        + `The explored graph grows multiplicatively with depth and stops at ${DEFAULT_EXPLORE_MAX_NODES} nodes.`;
    if (!input.value) input.value = String(DEFAULT_EXPLORE_DEPTH);
}

// A tab's name ('shapes', 'blueprint', …) maps to its button and panel ids.
const TAB_GROUPS = {
    sidebar: { buttonClass: 'tab-button', contentClass: 'tab-content', suffix: '-tab-btn', contentId: (n) => `${n}-content` },
    output: { buttonClass: 'view-tab-button', contentClass: 'view-tab-content', suffix: '-view-tab-btn', contentId: (n) => `${n}-view` },
};

const tabNameOf = (group, btn) => btn.id.slice(0, -TAB_GROUPS[group].suffix.length);

// Name of the group's active tab, or null when none is marked active.
export function activeTab(group) {
    const btn = $(`.${TAB_GROUPS[group].buttonClass}.active`);
    return btn ? tabNameOf(group, btn) : null;
}

// Switch a tab group only when the named button and panel both exist. Clearing
// first and then failing the lookup (a stale or corrupt tab name) would leave the
// group with no active tab — a blank sidebar or output pane. Returns whether it
// switched.
export function activateTab(group, name) {
    const { buttonClass, contentClass, suffix, contentId } = TAB_GROUPS[group];
    const btn = byId(`${name}${suffix}`);
    const content = byId(contentId(name));
    if (!btn || !content) return false;
    $all(`.${buttonClass}`).forEach((b) => b.classList.remove('active'));
    $all(`.${contentClass}`).forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    content.classList.add('active');
    return true;
}

// Activate the clicked tab, then call `onSwitch(name)`.
export function onTabClick(group, onSwitch) {
    $all(`.${TAB_GROUPS[group].buttonClass}`).forEach((btn) => {
        btn.addEventListener('click', () => {
            const name = tabNameOf(group, btn);
            if (activateTab(group, name)) onSwitch(name);
        });
    });
}
