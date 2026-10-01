import { createShapeElement, refreshShapeElements } from './shapeRendering.js';
import { Shape } from './shapeClass.js';
import { extractLayers, filterStartingShapes } from './startingShapes.js';
import { copyGraphToClipboard, applyGraphLayout, renderGraph, renderSpaceGraph, reRenderGraph, refreshGraphColors } from './operationGraph.js';
import { showValidationErrors } from './shapeValidation.js';
import { parseThroughputMultiplier, buildSolutionLayout, solvedStatusText, solveFailureMessage, exploreStatus } from './solutionPresentation.js';
import { BlueprintRenderer } from './blueprintRenderer.js';
import { exportBlueprintString } from './blueprintExport.js';
import { loadState, saveState, clearState, captureState, applyState } from './persistence.js';
import { $, byId } from './domUtils.js';
import { clampExploreDepth, DEFAULT_EXPLORE_DEPTH, MAX_EXPLORE_DEPTH, DEFAULT_EXPLORE_MAX_NODES } from './exploreDepth.js';
import { copyImage, copyTextFrom, reportCopyFailure } from './clipboardFeedback.js';
import { runSolverJob, cancelActiveJob, isJobRunning } from './solverJob.js';
import { readStartingShapes, readEnabledOperations, operationItems, activeTab, onTabClick } from './uiControls.js';

// Blueprint State
let blueprintRenderer = null;
let currentBlueprintLayout = null;

// BlueprintRenderer.setLayout resets to floor 0 (and a fresh renderer starts
// there), so every layout or floor change re-reads the label from the renderer
// instead of tracking the floor separately.
function syncFloorIndicator() {
    byId('floor-indicator').textContent = `Floor ${blueprintRenderer?.currentFloor ?? 0}`;
}

// Persistence
let lastSolution = null;
let suspendPersist = false;
function persist() {
    if (suspendPersist) return;
    saveState(captureState({
        currentSolution: lastSolution,
        currentBlueprintFloor: blueprintRenderer?.currentFloor ?? 0,
    }));
}

function refreshShapeColors() {
    refreshGraphColors();
    refreshShapeElements();
}

function initializeDefaultShapes() {
    const container = byId('starting-shapes');
    ['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu', 'WuWuWuWu']
        .forEach((code) => container.appendChild(createShapeItem(code)));
}

function createShapeItem(shapeCode) {
    const item = document.createElement('div');
    item.className = 'shape-item';

    const display = createShapeElement(shapeCode);

    const removeBtn = document.createElement('span');
    removeBtn.className = 'remove-shape';
    removeBtn.textContent = '×';
    removeBtn.dataset.shape = shapeCode;

    item.appendChild(display);
    item.appendChild(removeBtn);

    return item;
}

// Add Shape Button
byId('add-shape-btn').addEventListener('click', () => {
    const input = byId('new-shape-input');
    const code = input.value.trim();
    if (!code) return alert('Please enter a shape code.');
    if (!showValidationErrors(code, 'starting shape')) return;

    byId('starting-shapes').appendChild(createShapeItem(code));
    input.value = '';
    persist();
});

// Remove Shape Button
byId('starting-shapes').addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-shape')) {
        e.target.parentElement.remove();
        persist();
    }
});

// Extract Shapes Modal
byId('extract-shapes-btn').addEventListener('click', () => {
    byId('extract-modal').style.display = 'flex';
});

byId('extract-cancel').addEventListener('click', () => {
    byId('extract-modal').style.display = 'none';
});

byId('extract-confirm').addEventListener('click', () => {
    const target = byId('target-shape').value.trim();
    const mode = $('input[name="extract-mode"]:checked').value;
    const includePins = byId('include-pins').checked;
    const includeColor = byId('include-color').checked;

    const modal = byId('extract-modal');

    if (!target) {
        alert('Please enter a target shape code.');
        modal.style.display = 'none';
        return;
    }
    if (!showValidationErrors(target, 'target shape')) {
        modal.style.display = 'none';
        return;
    }

    try {
        const container = byId('starting-shapes');
        container.innerHTML = '';

        const variants = extractLayers(
            Shape.fromShapeCode(target),
            mode,
            includePins,
            includeColor
        );

        variants.forEach((code) => container.appendChild(createShapeItem(code)));
        modal.style.display = 'none';
        persist();
    } catch (err) {
        alert(`Failed to extract shapes: ${err.message}`);
        modal.style.display = 'none';
    }
});

onTabClick('sidebar', persist);

// Output views (Flowchart / Blueprint): the blueprint renderer exists only while
// its view is shown.
onTabClick('output', (view) => {
    if (view === 'blueprint') {
        if (!blueprintRenderer) {
            blueprintRenderer = new BlueprintRenderer(byId('blueprint-canvas'));
        }
        if (currentBlueprintLayout) {
            blueprintRenderer.setLayout(currentBlueprintLayout);
        }
    } else if (blueprintRenderer) {
        blueprintRenderer.destroy();
        blueprintRenderer = null;
    }
    syncFloorIndicator();
    persist();
});

operationItems().forEach((item) => {
    item.addEventListener('click', () => {
        item.classList.toggle('enabled');
        persist();
    });
});

// Clear flowchart + blueprint presentation for a failed/aborted solve so status,
// graph, blueprint, and lastSolution stay consistent (and reRenderGraph is a no-op).
// State is dropped before the view teardown so a throwing renderer cannot leave
// lastSolution or the blueprint layout pointing at a solve that is no longer drawn.
function clearSolutionPresentation() {
    lastSolution = null;
    currentBlueprintLayout = null;
    renderGraph(null);
    if (blueprintRenderer) {
        blueprintRenderer.setLayout(null);
    }
    syncFloorIndicator();
}

// Draw a solved result into every view — flowchart, blueprint layout (sized by
// the form's throughput multiplier), status line — and adopt it as lastSolution.
// The single presentation path for both a live solve and a restored one.
function presentSolution(solution) {
    renderGraph(solution.solutionPath);
    const multiplier = parseThroughputMultiplier(byId('throughput-multiplier')?.value);
    currentBlueprintLayout = buildSolutionLayout(solution.solutionPath, multiplier);
    if (blueprintRenderer) {
        blueprintRenderer.setLayout(currentBlueprintLayout);
    }
    syncFloorIndicator();
    byId('status').textContent = solvedStatusText(solution);
    lastSolution = solution;
}

byId('solve-btn').addEventListener('click', () => {
    const btn = byId('solve-btn');
    const status = byId('status');

    // This button owns the worker -> the click is a cancel; don't gather or
    // validate inputs.
    if (isJobRunning(btn)) {
        cancelActiveJob();
        return;
    }

    // Gather inputs
    const target = byId('target-shape').value.trim();
    let starting = readStartingShapes();
    const ops = readEnabledOperations();

    const maxLayers = parseInt(byId('max-layers').value) || 4;
    // Shared numeric control drives two distinct payload fields by method:
    // maxStatesPerLevel (BFS beam width) vs nodeBudget (Constructive per-node
    // A* cap). Never call this "Max States" — that name is the third budget,
    // maxStates (global ceiling), which the browser leaves uncapped.
    const budgetInput = parseInt(byId('max-states-per-level').value) || 1000;
    const preventWaste = byId('prevent-waste').checked;
    const orientationSensitive = byId('orientation-sensitive').checked;
    const monolayerPainting = byId('monolayer-painting').checked;
    const heuristicDivisor = parseFloat(byId('heuristic-divisor').value) || 0.1;
    const searchMethod = byId('search-method-select').value;
    const filterUnusedShapes = byId('filter-unused-shapes')?.checked ?? true;

    if (!showValidationErrors(target, 'target shape')) return;

    // Filter unused shapes if enabled
    if (filterUnusedShapes && starting.length > 0) {
        const originalCount = starting.length;
        starting = filterStartingShapes(starting, target);
        const removedCount = originalCount - starting.length;
        if (removedCount > 0) {
            console.log(`Filtered out ${removedCount} unused starting shapes`);
        }
    }

    // Validate remaining starting shapes
    for (const code of starting) {
        if (!showValidationErrors(code, 'starting shape')) return;
    }

    // Check if we have any starting shapes after filtering
    if (starting.length === 0) {
        alert('No valid starting shapes remain after filtering. Please add shapes that match the target.');
        return;
    }

    const startTime = performance.now();

    runSolverJob({
        btn,
        idleLabel: 'Solve',
        action: 'solve',
        onComplete: persist,
        onResultError: clearSolutionPresentation,
        data: {
            targetShapeCode: target,
            startingShapeCodes: starting,
            enabledOperations: ops,
            maxLayers,
            // Distinct identifiers end-to-end (see shapeSolver.js worker comment).
            maxStatesPerLevel: budgetInput,
            nodeBudget: budgetInput,
            preventWaste,
            orientationSensitive,
            monolayerPainting,
            heuristicDivisor,
            searchMethod
        },
        onResult(result) {
            if (result?.solutionPath) {
                presentSolution({
                    solutionPath: result.solutionPath,
                    depth: result.depth,
                    statesExplored: result.statesExplored,
                    solveTimeSec: ((performance.now() - startTime) / 1000).toFixed(2),
                    ...(result.strategyTrace && { strategyTrace: result.strategyTrace }),
                });
            } else {
                clearSolutionPresentation();
                status.textContent = solveFailureMessage(result);
            }
        }
    });
});

byId('explore-btn').addEventListener('click', () => {
    const btn = byId('explore-btn');

    // This button owns the worker -> the click is a cancel; don't gather or
    // validate inputs.
    if (isJobRunning(btn)) {
        cancelActiveJob();
        return;
    }

    const starting = readStartingShapes();
    const ops = readEnabledOperations();
    // Empty/invalid -> a small default, never an effectively unbounded depth.
    // The worker also caps the graph at DEFAULT_EXPLORE_MAX_NODES, so a deep
    // request returns a partial graph instead of growing until the tab OOMs.
    const depthLimit = clampExploreDepth(byId('depth-limit-input').value);
    const maxLayers = parseInt(byId('max-layers').value) || 4;
    const targetShapeCode = byId('target-shape').value.trim() || null;
    // Empty target is optional for Explore (color-context heuristics only);
    // a non-empty value must pass the same allowlist Solve already uses.
    if (targetShapeCode && !showValidationErrors(targetShapeCode, 'target shape')) return;

    for (const code of starting) {
        if (!showValidationErrors(code, 'starting shape')) return;
    }

    runSolverJob({
        btn,
        idleLabel: 'Explore',
        action: 'explore',
        startStatus: 'Exploring...',
        data: { startingShapeCodes: starting, enabledOperations: ops, depthLimit, maxLayers, targetShapeCode },
        onResult(result) {
            if (!result) return;
            renderSpaceGraph(result);
            byId('status').textContent = exploreStatus(result, depthLimit);
        }
    });
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initializeDefaultShapes();
    byId('color-mode-select')?.addEventListener('change', refreshShapeColors);

    // Surface the explore-depth bounds on the input itself (single source of
    // truth: the same constants clampExploreDepth enforces). Seeding a value
    // makes the default explicit rather than implicit in an empty field; the
    // persisted value, restored below, still wins.
    const depthInput = byId('depth-limit-input');
    if (depthInput) {
        depthInput.max = String(MAX_EXPLORE_DEPTH);
        depthInput.placeholder = `Depth (${DEFAULT_EXPLORE_DEPTH})`;
        depthInput.title = `Operation steps to explore (1-${MAX_EXPLORE_DEPTH}). `
            + `The explored graph grows multiplicatively with depth and stops at ${DEFAULT_EXPLORE_MAX_NODES} nodes.`;
        if (!depthInput.value) depthInput.value = String(DEFAULT_EXPLORE_DEPTH);
    }

    // Search method toggle: A*/IDA*/Bidirectional use the heuristic divisor;
    // BFS shows beam width (maxStatesPerLevel); Constructive shows its per-node
    // A* budget (nodeBudget). Same DOM input, two payload keys — not the global
    // maxStates ceiling (browser stays uncapped and relies on Cancel).
    byId('search-method-select').addEventListener('change', (e) => {
        const method = e.target.value;
        const heuristicGroup = byId('heuristic-divisor').closest('.option-group');
        const budgetGroup = byId('max-states-per-level').closest('.option-group');
        const usesHeuristic = method === 'A*' || method === 'IDA*' || method === 'Bidirectional';
        const usesBudgetControl = method === 'BFS' || method === 'Constructive';
        heuristicGroup.style.display = usesHeuristic ? 'block' : 'none';
        budgetGroup.style.display = usesBudgetControl ? 'block' : 'none';
        // Same input, two concepts: BFS beam width vs Constructive nodeBudget.
        budgetGroup.querySelector('label').textContent =
            method === 'Constructive' ? 'Node Search Budget' : 'Max States Per Level';
    });

    // Initial toggle
    byId('search-method-select').dispatchEvent(new Event('change'));

    // Wire change listeners on persisted form inputs (save on every edit)
    const persistOnChange = [
        'target-shape', 'depth-limit-input', 'search-method-select',
        'max-states-per-level', 'heuristic-divisor',
        'prevent-waste', 'orientation-sensitive', 'monolayer-painting',
        'filter-unused-shapes', 'throughput-multiplier', 'max-layers',
        'color-mode-select',
    ];
    for (const id of persistOnChange) {
        byId(id)?.addEventListener('change', persist);
    }

    // Restore saved state
    const state = loadState();
    if (state) {
        suspendPersist = true;
        try {
            // applyState restores the form first, so presentSolution reads the
            // restored throughput multiplier. A solution that failed validation
            // comes back null and is never drawn or adopted.
            const { solution, restoredFloor } = applyState(state, { createShapeItem });
            if (solution) presentSolution(solution);
            if (state.view.activeOutputView === 'blueprint' && currentBlueprintLayout) {
                if (!blueprintRenderer) {
                    blueprintRenderer = new BlueprintRenderer(byId('blueprint-canvas'));
                }
                blueprintRenderer.setLayout(currentBlueprintLayout);
                if (restoredFloor > 0 && restoredFloor < currentBlueprintLayout.floorCount) {
                    blueprintRenderer.setFloor(restoredFloor);
                }
                syncFloorIndicator();
            }
            suspendPersist = false;
        } catch (err) {
            // applyState mutates form fields, shapes, tabs, and the graph in place,
            // so a throw can leave the UI half-applied. We can't cleanly unwind
            // that, so wipe the saved state and reload into a guaranteed-default
            // UI. Reload only if the wipe succeeded — otherwise the re-throw on the
            // next load would loop; leave persistence suspended so the half-applied
            // DOM isn't re-saved before navigation.
            console.warn('Failed to restore solver state; clearing saved state and reloading defaults.', err);
            if (clearState()) {
                location.reload();
            } else {
                suspendPersist = false;
            }
        }
    }
});

// Wipe localStorage and reload so all inputs/options/solution return to defaults.
byId('reset-state-btn').addEventListener('click', () => {
    if (!confirm('Clear saved solver state and reload defaults?')) return;
    clearState();
    location.reload();
});

byId('snapshot-btn').addEventListener('click', () => {
    if (activeTab('output') === 'blueprint' && blueprintRenderer) {
        const renderer = blueprintRenderer;
        copyImage(() => renderer.exportPng(), 'blueprint image');
    } else {
        copyGraphToClipboard();
    }
});
byId('direction-select').addEventListener('change', (e) => {
    applyGraphLayout(e.target.value);
    persist();
});
byId('edge-style-select').addEventListener('change', () => {
    reRenderGraph();
    persist();
});

byId('floor-up-btn').addEventListener('click', () => {
    if (!blueprintRenderer || !currentBlueprintLayout) return;
    const next = blueprintRenderer.currentFloor + 1;
    if (next < currentBlueprintLayout.floorCount) {
        blueprintRenderer.setFloor(next);
        syncFloorIndicator();
        persist();
    }
});
byId('copy-blueprint-btn').addEventListener('click', () => {
    const layout = currentBlueprintLayout;
    if (!layout || layout.machines.length === 0) {
        reportCopyFailure('blueprint string', 'there is no blueprint yet');
        return;
    }
    copyTextFrom(() => exportBlueprintString(layout), 'blueprint string');
});

byId('floor-down-btn').addEventListener('click', () => {
    if (!blueprintRenderer) return;
    const next = blueprintRenderer.currentFloor - 1;
    if (next >= 0) {
        blueprintRenderer.setFloor(next);
        syncFloorIndicator();
        persist();
    }
});

