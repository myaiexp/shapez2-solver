import { refreshShapeElements } from './shapeRendering.js';
import { Shape } from './shapeClass.js';
import { extractLayers } from './startingShapes.js';
import { copyGraphToClipboard, applyGraphLayout, renderGraph, renderSpaceGraph, reRenderGraph, refreshGraphColors } from './operationGraph.js';
import { showValidationErrors } from './shapeValidation.js';
import { solvedStatusText, solveFailureMessage, exploreStatus, isSolvedResult } from './solutionPresentation.js';
import { BlueprintRenderer } from './blueprintRenderer.js';
import { createBlueprintView } from './blueprintView.js';
import { buildSolveRequest, buildExploreRequest } from './solveRequest.js';
import { exportBlueprintString } from './blueprintExport.js';
import { loadState, saveState, clearState, captureState, applyState, onPersistedInputChange } from './persistence.js';
import { $, byId } from './domUtils.js';
import { DEFAULT_EXPLORE_DEPTH, MAX_EXPLORE_DEPTH, DEFAULT_EXPLORE_MAX_NODES } from './exploreDepth.js';
import { copyImage, copyTextFrom, reportCopyFailure } from './clipboardFeedback.js';
import { runSolverJob, cancelActiveJob, isJobRunning } from './solverJob.js';
import { readStartingShapes, readEnabledOperations, operationItems, activeTab, onTabClick, setStartingShapes, addStartingShape, readMaxLayers, readLevelBudget, readHeuristicDivisor } from './uiControls.js';

// BlueprintRenderer.setLayout resets to floor 0 (and a fresh renderer starts
// there), so every layout or floor change re-reads the label from the renderer
// instead of tracking the floor separately.
function syncFloorIndicator() {
    byId('floor-indicator').textContent = `Floor ${blueprint.renderer?.currentFloor ?? 0}`;
}

const blueprint = createBlueprintView({
    createRenderer: () => new BlueprintRenderer(byId('blueprint-canvas')),
    onViewChanged: syncFloorIndicator,
});

// Persistence
let suspendPersist = false;
function persist() {
    if (suspendPersist) return;
    saveState(captureState({
        currentSolution: blueprint.solution,
        currentBlueprintFloor: blueprint.renderer?.currentFloor ?? 0,
    }));
}

function refreshShapeColors() {
    refreshGraphColors();
    refreshShapeElements();
}

function initializeDefaultShapes() {
    setStartingShapes(['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu', 'WuWuWuWu']);
}

// Add Shape Button
byId('add-shape-btn').addEventListener('click', () => {
    const input = byId('new-shape-input');
    const code = input.value.trim();
    if (!code) return alert('Please enter a shape code.');
    if (!showValidationErrors(code, 'starting shape')) return;

    addStartingShape(code);
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
        const variants = extractLayers(
            Shape.fromShapeCode(target),
            mode,
            includePins,
            includeColor
        );

        setStartingShapes(variants);
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
    blueprint.showOutputView(view);
    persist();
});

operationItems().forEach((item) => {
    item.addEventListener('click', () => {
        item.classList.toggle('enabled');
        persist();
    });
});

// Clear flowchart + blueprint presentation for a failed/aborted solve so status,
// graph, blueprint, and the stored solution stay consistent (and reRenderGraph
// is a no-op). State is dropped before the view teardown so a throwing renderer
// cannot leave the stored solution or the blueprint layout pointing at a solve
// that is no longer drawn.
function clearSolutionPresentation() {
    blueprint.forget();
    renderGraph(null);
    blueprint.blank();
}

// Draw a solved result into every view — flowchart, blueprint layout (sized by
// the form's throughput multiplier), status line — and adopt it as the current
// solution. The single presentation path for both a live solve and a restored one.
function presentSolution(solution) {
    renderGraph(solution.solutionPath);
    blueprint.present(solution, byId('throughput-multiplier')?.value);
    byId('status').textContent = solvedStatusText(solution);
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

    const preventWaste = byId('prevent-waste').checked;
    const orientationSensitive = byId('orientation-sensitive').checked;
    const monolayerPainting = byId('monolayer-painting').checked;
    const searchMethod = byId('search-method-select').value;
    const filterUnusedShapes = byId('filter-unused-shapes')?.checked ?? true;

    if (!showValidationErrors(target, 'target shape')) return;

    // Filter unused shapes if enabled. The shared budget box is one number
    // with two payload names (maxStatesPerLevel / nodeBudget). buildSolveRequest
    // does not send maxStates — the browser leaves that ceiling uncapped.
    const { request, filteredOut } = buildSolveRequest({
        targetShapeCode: target,
        startingShapeCodes: starting,
        enabledOperations: ops,
        maxLayers: readMaxLayers(),
        budget: readLevelBudget(),
        preventWaste,
        orientationSensitive,
        monolayerPainting,
        heuristicDivisor: readHeuristicDivisor(),
        searchMethod,
        filterUnusedShapes,
    });
    if (filteredOut > 0) {
        console.log(`Filtered out ${filteredOut} unused starting shapes`);
    }

    for (const code of request.startingShapeCodes) {
        if (!showValidationErrors(code, 'starting shape')) return;
    }

    if (request.startingShapeCodes.length === 0) {
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
        data: request,
        onResult(result) {
            if (isSolvedResult(result)) {
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
    const targetRaw = byId('target-shape').value;
    const targetShapeCode = targetRaw.trim() || null;
    // Empty target is optional for Explore (color-context heuristics only);
    // a non-empty value must pass the same allowlist Solve already uses.
    if (targetShapeCode && !showValidationErrors(targetShapeCode, 'target shape')) return;

    for (const code of starting) {
        if (!showValidationErrors(code, 'starting shape')) return;
    }

    // Empty/invalid depth -> a small default, never an effectively unbounded
    // depth. The worker also caps the graph at DEFAULT_EXPLORE_MAX_NODES, so a
    // deep request returns a partial graph instead of growing until the tab OOMs.
    const data = buildExploreRequest({
        startingShapeCodes: starting,
        enabledOperations: ops,
        depthLimit: byId('depth-limit-input').value,
        maxLayers: readMaxLayers(),
        targetShapeCode: targetRaw,
    });

    runSolverJob({
        btn,
        idleLabel: 'Explore',
        action: 'explore',
        startStatus: 'Exploring...',
        data,
        onResult(result) {
            if (!result) return;
            renderSpaceGraph(result);
            byId('status').textContent = exploreStatus(result, data.depthLimit);
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

    // Rebuild the blueprint when the multiplier changes after a solve. The
    // generic listener below also saves the new value; this one runs first so
    // the layout Copy Blueprint exports matches the select.
    byId('throughput-multiplier')?.addEventListener('change', () => {
        blueprint.setThroughputMultiplier(byId('throughput-multiplier').value);
    });
    onPersistedInputChange(persist);

    // Restore saved state
    const state = loadState();
    if (state) {
        suspendPersist = true;
        try {
            // applyState restores the form first, so presentSolution reads the
            // restored throughput multiplier. A solution that failed validation
            // comes back null and is never drawn or adopted.
            const { solution, restoredFloor } = applyState(state);
            if (solution) presentSolution(solution);
            // Create the renderer whenever the Blueprint tab is restored, even
            // with no layout. presentSolution only draws if a renderer exists,
            // so a later solve on this tab would otherwise leave the canvas blank.
            if (state.view.activeOutputView === 'blueprint') {
                blueprint.showOutputView('blueprint');
                const layout = blueprint.layout;
                const renderer = blueprint.renderer;
                if (layout && renderer && restoredFloor > 0 && restoredFloor < layout.floorCount) {
                    renderer.setFloor(restoredFloor);
                    syncFloorIndicator();
                }
            }
            suspendPersist = false;
        } catch (err) {
            // applyState writes form fields, shapes, tabs and graph selects, and
            // presentSolution draws. A throw from either can leave the UI
            // half-applied. We can't cleanly unwind
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
    if (activeTab('output') === 'blueprint' && blueprint.renderer) {
        const renderer = blueprint.renderer;
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
    if (!blueprint.renderer || !blueprint.layout) return;
    const next = blueprint.renderer.currentFloor + 1;
    if (next < blueprint.layout.floorCount) {
        blueprint.renderer.setFloor(next);
        syncFloorIndicator();
        persist();
    }
});
byId('copy-blueprint-btn').addEventListener('click', () => {
    const layout = blueprint.layout;
    if (!layout || layout.machines.length === 0) {
        reportCopyFailure('blueprint string', 'there is no blueprint yet');
        return;
    }
    copyTextFrom(() => exportBlueprintString(layout), 'blueprint string');
});

byId('floor-down-btn').addEventListener('click', () => {
    if (!blueprint.renderer) return;
    const next = blueprint.renderer.currentFloor - 1;
    if (next >= 0) {
        blueprint.renderer.setFloor(next);
        syncFloorIndicator();
        persist();
    }
});

