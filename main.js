import { createShapeCanvas, createShapeElement, colorValues } from './shapeRendering.js';
import { Shape } from './shapeClass.js';
import { extractLayers, filterStartingShapes } from './startingShapes.js';
import { cyInstance, copyGraphToClipboard, applyGraphLayout, renderGraph, renderSpaceGraph, reRenderGraph } from './operationGraph.js';
import { showValidationErrors } from './shapeValidation.js';
import { buildLayout, duplicateForThroughput } from './blueprintLayout.js';
import { BlueprintRenderer } from './blueprintRenderer.js';
import { exportBlueprintString } from './blueprintExport.js';
import { loadState, saveState, clearState, captureState, applyState } from './persistence.js';
import { getCurrentColorMode } from './colorMode.js';
import { SHAPE_LABEL_CLASS } from './domConstants.js';
import { $, $all, byId } from './domUtils.js';
import { clampExploreDepth, DEFAULT_EXPLORE_DEPTH, MAX_EXPLORE_DEPTH } from './exploreDepth.js';

// Blueprint State
let blueprintRenderer = null;
let currentBlueprintLayout = null;

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
    const container = byId('graph-container');
    if (!container || !cyInstance) return;

    const mode = getCurrentColorMode();

    // Update shape nodes
    cyInstance.nodes('.shape').forEach((node) => {
        const code = node.data('label');
        const canvas = createShapeCanvas(code, 120);
        node.data('shapeCanvas', canvas.toDataURL());
        node.trigger('style');
    });

    // Update color operations
    cyInstance.nodes('.colored-op').forEach((node) => {
        const parts = node.data('label').split(' ');
        if (parts.length < 2) return;
        const color = parts[1].replace(/[()]/g, '');
        const col = colorValues[mode]?.[color];
        if (col) node.style({ 'background-color': col });
    });

    // Refresh inline canvases
    $all('.shape-canvas').forEach((canvas) => {
        const code = canvas.dataset.shapeCode;
        if (!code) return;
        const newCanvas = createShapeCanvas(code, 40);
        newCanvas.className = 'shape-canvas';
        newCanvas.dataset.shapeCode = code;
        canvas.replaceWith(newCanvas);
    });
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

$all('.tab-button').forEach((btn) => {
    btn.addEventListener('click', () => {
        $all('.tab-button').forEach((b) => b.classList.remove('active'));
        $all('.tab-content').forEach((c) => c.classList.remove('active'));

        btn.classList.add('active');
        byId(btn.id.replace('-tab-btn', '-content')).classList.add('active');
        persist();
    });
});

// View Tab Switching (Flowchart / Blueprint)
$all('.view-tab-button').forEach((btn) => {
    btn.addEventListener('click', () => {
        $all('.view-tab-button').forEach((b) => b.classList.remove('active'));
        $all('.view-tab-content').forEach((c) => c.classList.remove('active'));

        btn.classList.add('active');
        const viewId = btn.id.replace('-tab-btn', '');
        byId(viewId).classList.add('active');

        if (viewId === 'blueprint-view') {
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
        persist();
    });
});

// Operation Toggle
$all('.operation-item').forEach((item) => {
    item.addEventListener('click', () => {
        item.classList.toggle('enabled');
        persist();
    });
});

// Compact one-line summary of which Constructive strategies fired, derived from
// the strategyTrace alone: method breakdown (splits → direct-searches), total op
// count, and how many sub-shapes were shared (reused) across the plan.
function summarizeStrategyTrace(trace) {
    const methodCounts = {};
    const targetCounts = {};
    (function walk(node) {
        methodCounts[node.method] = (methodCounts[node.method] || 0) + 1;
        targetCounts[node.target] = (targetCounts[node.target] || 0) + 1;
        node.children.forEach(walk);
    })(trace);
    const reused = Object.values(targetCounts).filter((c) => c > 1).length;
    const splits = Object.entries(methodCounts)
        .filter(([m]) => m !== 'direct-search')
        .map(([m, c]) => `${m} ×${c}`);
    const searches = methodCounts['direct-search'] || 0;
    const breakdown = splits.length ? `${splits.join(', ')} → ${searches} direct-searches` : 'direct-search';
    return `Constructive: ${breakdown} | ${trace.opCount} ops | reused ${reused}`;
}

let solverWorker = null;
// The single button that currently owns the shared worker ({ btn, idleLabel }),
// or null when idle. Solve and Explore share one worker, so this — not the
// per-call `btn` closure, and never the button's label text — is the source of
// truth for which action is running. Label text is presentation only: routing a
// click off it would couple control flow to display copy (a label tweak or i18n
// would silently mis-route clicks). Tracking ownership here also lets a new job
// reset the OTHER action's button.
let activeJob = null;
// Monotonic generation for the shared worker slot. finishJob() bumps it so any
// already-queued main-thread message from a terminated worker is ignored even
// if its handler still runs after cancel/replace (classic multi-job race).
let jobGeneration = 0;

// True while `btn` owns the worker, i.e. a click on it means "cancel", not "start".
const isJobRunning = (btn) => activeJob?.btn === btn;

// Reset whichever button owns the worker back to its idle label and tear the
// worker down. Called on every terminal outcome (cancel, result, error, crash)
// AND before starting a new job — so starting Explore mid-Solve (or vice versa)
// can never leave the other button stuck on 'Cancel'.
function finishJob() {
    // Invalidate first so a message already scheduled for this turn cannot land
    // after teardown and clobber status / graph / persisted solution.
    jobGeneration += 1;
    if (activeJob) {
        activeJob.btn.textContent = activeJob.idleLabel;
        activeJob = null;
    }
    if (solverWorker) {
        // Drop handlers before terminate so a late event has no listener to run
        // (generation still guards the case where a callback was already queued).
        solverWorker.onmessage = null;
        solverWorker.onerror = null;
        solverWorker.onmessageerror = null;
        solverWorker.terminate();
        solverWorker = null;
    }
}

// Stop the in-flight job and release the UI. The single cancel path: both click
// handlers route here when their button owns the worker.
function cancelActiveJob() {
    if (solverWorker) solverWorker.postMessage({ action: 'cancel' });
    finishJob();
    byId('status').textContent = 'Cancelled.';
}

// Clear flowchart + blueprint presentation for a failed/aborted solve so status,
// graph, blueprint, and lastSolution stay consistent (and reRenderGraph is a no-op).
function clearSolutionPresentation() {
    renderGraph(null);
    currentBlueprintLayout = null;
    if (blueprintRenderer) {
        blueprintRenderer.setLayout(null);
    }
    lastSolution = null;
}

// Starts a job — never cancels one. Callers guard with isJobRunning() and route
// cancel clicks to cancelActiveJob() before gathering any inputs.
function runSolverWorker({ btn, idleLabel, action, data, onResult, persistOnComplete = false, startStatus }) {
    const status = byId('status');

    // finishJob() resets any in-flight job's button (which must be the OTHER
    // action, since a click on this btn while it owns the worker was routed to
    // cancelActiveJob) and kills its worker before we spin up a fresh one.
    finishJob();
    // Capture after finishJob so this job owns the post-teardown generation.
    const jobId = jobGeneration;
    const isCurrent = () => jobId === jobGeneration;

    solverWorker = new Worker(new URL('./shapeSolver.js', import.meta.url), { type: 'module' });
    activeJob = { btn, idleLabel };

    solverWorker.onmessage = ({ data: msg }) => {
        if (!isCurrent()) return;
        const { type, message, result } = msg;

        if (type === 'status') {
            status.textContent = message;
            return;
        }

        if (type === 'error') {
            status.textContent = message;
            finishJob();
            return;
        }

        if (type === 'result') {
            try {
                onResult(result);
                // Re-check after onResult: a nested cancel during the callback
                // (unlikely but cheap) must not persist a superseded solution.
                if (persistOnComplete && isCurrent()) persist();
            } catch (err) {
                if (isCurrent()) status.textContent = `Error: ${err.message}`;
            } finally {
                if (isCurrent()) finishJob();
            }
        }
    };

    // A worker that throws before posting a terminal message (onerror) or sends
    // an undeserializable one (onmessageerror) still has to release the UI.
    solverWorker.onerror = (e) => {
        if (!isCurrent()) return;
        status.textContent = `Error: ${e.message || 'worker crashed'}`;
        finishJob();
    };
    solverWorker.onmessageerror = () => {
        if (!isCurrent()) return;
        status.textContent = 'Error: worker sent an unreadable message.';
        finishJob();
    };

    btn.textContent = 'Cancel';
    if (startStatus) status.textContent = startStatus;
    solverWorker.postMessage({ action, data });
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
    let starting = $all(`#starting-shapes .shape-item .${SHAPE_LABEL_CLASS}`).map((x) => x.textContent);
    const ops = $all('#enabled-operations .operation-item.enabled').map((x) => x.dataset.operation);

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

    runSolverWorker({
        btn,
        idleLabel: 'Solve',
        action: 'solve',
        persistOnComplete: true,
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
                renderGraph(result.solutionPath);
                let layout = buildLayout(result.solutionPath);
                const multiplier = parseInt(byId('throughput-multiplier')?.value || '1', 10);
                if (multiplier > 1) {
                    layout = duplicateForThroughput(layout, multiplier);
                }
                currentBlueprintLayout = layout;
                if (blueprintRenderer) {
                    blueprintRenderer.setLayout(currentBlueprintLayout);
                }
                const t = ((performance.now() - startTime) / 1000).toFixed(2);
                let statusText = `Solved in ${t}s at Depth ${result.depth} → ${result.statesExplored} States`;
                if (result.strategyTrace) {
                    statusText += ` | ${summarizeStrategyTrace(result.strategyTrace)}`;
                }
                status.textContent = statusText;
                lastSolution = {
                    solutionPath: result.solutionPath,
                    depth: result.depth,
                    statesExplored: result.statesExplored,
                    solveTimeSec: t,
                };
            } else {
                clearSolutionPresentation();
                if (result?.aborted === 'maxStates') {
                    status.textContent = `No solution found — search hit the state limit (${result.statesExplored} states). Try BFS, a larger heuristic divisor, or a simpler target.`;
                } else if (result?.aborted === 'preventWaste') {
                    status.textContent = 'No solution found — a plan exists but leftover waste cannot be removed (enable Trash, or disable Prevent Waste).';
                } else if (result?.aborted === 'path-invalid') {
                    status.textContent = 'No solution found — constructive assembly produced a path that does not hold the target.';
                } else if (result?.aborted === 'no-decomposition') {
                    status.textContent = `No solution found — no constructive split solved this target within the node budget (${result.statesExplored} states).`;
                } else {
                    status.textContent = 'No solution found.';
                }
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

    const starting = $all(`#starting-shapes .shape-item .${SHAPE_LABEL_CLASS}`).map((x) => x.textContent);
    const ops = $all('#enabled-operations .operation-item.enabled').map((x) => x.dataset.operation);
    // Empty/invalid -> a small default, never an effectively unbounded depth:
    // the explorer BFS has no state cap, so depth is the only thing keeping the
    // graph (and the tab) from growing without bound.
    const depthLimit = clampExploreDepth(byId('depth-limit-input').value);
    const maxLayers = parseInt(byId('max-layers').value) || 4;
    const targetShapeCode = byId('target-shape').value.trim() || null;

    for (const code of starting) {
        if (!showValidationErrors(code, 'starting shape')) return;
    }

    runSolverWorker({
        btn,
        idleLabel: 'Explore',
        action: 'explore',
        startStatus: 'Exploring...',
        data: { startingShapeCodes: starting, enabledOperations: ops, depthLimit, maxLayers, targetShapeCode },
        onResult(result) {
            if (result) {
                renderSpaceGraph(result);
            }
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
            + `The explored graph grows multiplicatively with depth.`;
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
            const { restoredSolution, restoredFloor } = applyState(state, {
                renderGraph,
                applyGraphLayout,
                buildLayout,
                duplicateForThroughput,
                BlueprintRenderer,
                createShapeItem,
                setBlueprintLayout: (layout) => { currentBlueprintLayout = layout; },
            });
            // Only adopt the persisted solution if applyState actually validated
            // and rendered it — otherwise lastSolution would point at a solution
            // the graph/blueprint never drew, leaving the two inconsistent.
            if (restoredSolution && state.solution) {
                lastSolution = state.solution;
            }
            if (state.view.activeOutputView === 'blueprint' && currentBlueprintLayout) {
                if (!blueprintRenderer) {
                    blueprintRenderer = new BlueprintRenderer(byId('blueprint-canvas'));
                }
                blueprintRenderer.setLayout(currentBlueprintLayout);
                if (restoredFloor > 0 && restoredFloor < currentBlueprintLayout.floorCount) {
                    blueprintRenderer.setFloor(restoredFloor);
                    byId('floor-indicator').textContent = `Floor ${restoredFloor}`;
                }
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

// Graph Controls
byId('snapshot-btn').addEventListener('click', async () => {
    const blueprintActive = byId('blueprint-view').classList.contains('active');
    if (blueprintActive && blueprintRenderer) {
        try {
            const blob = await blueprintRenderer.exportPng();
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
        } catch (err) {
            console.error('Failed to copy blueprint:', err);
        }
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
        byId('floor-indicator').textContent = `Floor ${next}`;
        persist();
    }
});
byId('copy-blueprint-btn').addEventListener('click', async () => {
    if (!currentBlueprintLayout || currentBlueprintLayout.machines.length === 0) return;
    try {
        const str = await exportBlueprintString(currentBlueprintLayout);
        await navigator.clipboard.writeText(str);
        const btn = byId('copy-blueprint-btn');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch (err) {
        console.error('Blueprint export failed:', err);
    }
});

byId('floor-down-btn').addEventListener('click', () => {
    if (!blueprintRenderer) return;
    const next = blueprintRenderer.currentFloor - 1;
    if (next >= 0) {
        blueprintRenderer.setFloor(next);
        byId('floor-indicator').textContent = `Floor ${next}`;
        persist();
    }
});

