// Blueprint renderer lifetime (audit #11336 / #11337) — run with:
//   node tests/shared/blueprintView.test.js
//
// Restoring the Blueprint tab with no saved solution must still create a
// renderer, because present() only draws when one exists. Changing the
// throughput multiplier after a solve must rebuild the layout the Copy
// Blueprint button exports; the select used to save the new value and leave
// the canvas on the old one until reload.
import { createBlueprintView } from '../../blueprintView.js';
import { buildSolutionLayout } from '../../solutionPresentation.js';
import { LAYOUT_FIXTURES } from './layoutFixtures.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

function sameLayout(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

const path = LAYOUT_FIXTURES[0].solutionPath;
const solution = { solutionPath: path, depth: 2, statesExplored: 4, solveTimeSec: '0.10' };

function harness() {
    const created = [];
    let destroyed = 0;
    const pushed = [];
    const view = createBlueprintView({
        createRenderer() {
            const renderer = {
                currentFloor: 0,
                setLayout(layout) { pushed.push(layout); this.layout = layout; },
                setFloor(floor) { this.currentFloor = floor; },
                destroy() { destroyed++; },
            };
            created.push(renderer);
            return renderer;
        },
    });
    return { view, created, pushed, destroyed: () => destroyed };
}

{
    const { view, created, pushed } = harness();
    view.showOutputView('blueprint');
    check('restore with no solution still creates a renderer', created.length === 1 && view.renderer != null);
    check('restore with no solution does not push a layout', pushed.length === 0);

    view.present(solution, '1');
    check('a later solve draws into the restored renderer', pushed.length === 1 && sameLayout(pushed[0], buildSolutionLayout(path, 1)));
    check('the solve is the stored solution', view.solution === solution);
}

{
    const { view, created, pushed } = harness();
    view.showOutputView('blueprint');
    view.setThroughputMultiplier('3');
    check('multiplier with no solution does not invent a layout', view.setThroughputMultiplier('4') === false && pushed.length === 0 && created.length === 1);

    view.present(solution, '1');
    const before = pushed.length;
    check('multiplier change rebuilds and pushes the layout', view.setThroughputMultiplier('3') === true);
    check('×3 layout matches buildSolutionLayout', sameLayout(pushed.at(-1), buildSolutionLayout(path, 3)));
    check('the push is a new layout, not the ×1 one', pushed.length === before + 1 && !sameLayout(pushed.at(-1), buildSolutionLayout(path, 1)));
}

{
    const { view, created, pushed, destroyed } = harness();
    view.present(solution, '2');
    check('present before the tab exists stores the layout without a renderer', view.renderer == null && created.length === 0 && pushed.length === 0);
    view.showOutputView('blueprint');
    check('opening the tab creates a renderer and applies the stored layout',
        created.length === 1 && pushed.length === 1 && sameLayout(pushed[0], buildSolutionLayout(path, 2)));
    view.showOutputView('flowchart');
    check('leaving the tab destroys the renderer and keeps the layout',
        destroyed() === 1 && view.renderer == null && view.layout != null);
    view.showOutputView('blueprint');
    check('returning to the tab creates a fresh renderer and reapplies the layout',
        created.length === 2 && pushed.length === 2 && sameLayout(pushed.at(-1), view.layout));
}

{
    const { view, pushed } = harness();
    view.showOutputView('blueprint');
    view.present(solution, '1');
    view.forget();
    check('forget drops the solution and layout before the canvas is blanked', view.solution == null && view.layout == null);
    view.blank();
    check('blank pushes null to the existing renderer', pushed.at(-1) === null);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
