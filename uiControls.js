// The one place that knows the sidebar's markup: it builds and reads the
// starting-shape rows, reads the operation toggles and the numeric solver
// fields, and owns the two tab groups' class/id conventions. main.js and
// persistence.js both go through here, so a markup change is a single edit.
import { createShapeElement } from './shapeRendering.js';
import { SHAPE_LABEL_CLASS } from './domConstants.js';
import { $, $all, byId } from './domUtils.js';

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

// Same fallbacks Solve and Explore used to spell inline (`parseInt(v) || n`).
// 0 and NaN both mean "the field is blank or junk" and take the default.
function readInt(id, fallback) {
    return parseInt(byId(id).value) || fallback;
}

export const readMaxLayers = () => readInt('max-layers', 4);
export const readLevelBudget = () => readInt('max-states-per-level', 1000);
export const readHeuristicDivisor = () => parseFloat(byId('heuristic-divisor').value) || 0.1;

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
