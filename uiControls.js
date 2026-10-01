// The one place that knows the sidebar's markup: the starting-shape list, the
// operation toggles, and the two tab groups' class/id conventions. main.js (the
// Solve / Explore / tab handlers) and persistence.js (capture / restore) both go
// through here, so a markup change is a single edit.
import { SHAPE_LABEL_CLASS } from './domConstants.js';
import { $, $all, byId } from './domUtils.js';

export const readStartingShapes = () =>
    $all(`#starting-shapes .shape-item .${SHAPE_LABEL_CLASS}`).map((el) => el.textContent);

export const operationItems = () => $all('#enabled-operations .operation-item');

export const readEnabledOperations = () =>
    operationItems().filter((el) => el.classList.contains('enabled')).map((el) => el.dataset.operation);

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
