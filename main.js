// Imports
import { createShapeCanvas, createShapeElement, colorValues } from './shapeRendering.js';
import { Shape, _extractLayers, _filterStartingShapes } from './shapeOperations.js';
import { cyInstance, copyGraphToClipboard, applyGraphLayout, renderGraph, renderSpaceGraph, reRenderGraph } from './operationGraph.js';
import { showValidationErrors } from './shapeValidation.js';
import { SHAPE_TYPES, COLOR_TYPES, buildShapeCode, parseShapeCode, getShapeInfo, getColorInfo, createDefaultParts } from './shapeColorData.js';
import { buildLayout, duplicateForThroughput } from './blueprintLayout.js';
import { BlueprintRenderer } from './blueprintRenderer.js';
import { exportBlueprintString } from './blueprintExport.js';
import { loadState, saveState, captureState, applyState, STORAGE_KEY } from './persistence.js';

// Utility Helpers
const $ = (sel) => document.querySelector(sel);
const $all = (sel) => Array.from(document.querySelectorAll(sel));
const byId = (id) => document.getElementById(id);

export function getCurrentColorMode() {
    return byId('color-mode-select')?.value || 'rgb';
}

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

// Refresh Colors
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

// Default Shapes
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

        const variants = _extractLayers(
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

// Tabs
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

// Solver Worker
let solverWorker = null;
byId('solve-btn').addEventListener('click', () => {
    const btn = byId('solve-btn');
    const status = byId('status');

    const solving = btn.textContent === 'Solve';
    if (!solving) {
        if (solverWorker) {
            solverWorker.postMessage({ action: 'cancel' });
            solverWorker.terminate();
            solverWorker = null;
        }
        btn.textContent = 'Solve';
        status.textContent = 'Cancelled.';
        return;
    }

    // Gather inputs
    const target = byId('target-shape').value.trim();
    let starting = $all('#starting-shapes .shape-item .shape-label').map((x) => x.textContent);
    const ops = $all('#enabled-operations .operation-item.enabled').map((x) => x.dataset.operation);

    const maxLayers = parseInt(byId('max-layers').value) || 4;
    const maxStates = parseInt(byId('max-states-per-level').value) || 1000;
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
        starting = _filterStartingShapes(starting, target);
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

    // Start worker
    if (solverWorker) solverWorker.terminate();
    solverWorker = new Worker(new URL('./shapeSolver.js', import.meta.url), { type: 'module' });

    const startTime = performance.now();

    solverWorker.onmessage = ({ data }) => {
        const { type, message, result } = data;

        if (type === 'status') {
            status.textContent = message;
            return;
        }

        if (type === 'result') {
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
                status.textContent = `Solved in ${t}s at Depth ${result.depth} → ${result.statesExplored} States`;
                lastSolution = {
                    solutionPath: result.solutionPath,
                    depth: result.depth,
                    statesExplored: result.statesExplored,
                    solveTimeSec: t,
                };
            } else {
                currentBlueprintLayout = null;
                status.textContent = 'No solution found.';
                lastSolution = null;
            }

            btn.textContent = 'Solve';
            solverWorker.terminate();
            solverWorker = null;
            persist();
        }
    };

    btn.textContent = 'Cancel';
    solverWorker.postMessage({
        action: 'solve',
        data: {
            targetShapeCode: target,
            startingShapeCodes: starting,
            enabledOperations: ops,
            maxLayers,
            maxStatesPerLevel: maxStates,
            preventWaste,
            orientationSensitive,
            monolayerPainting,
            heuristicDivisor,
            searchMethod
        }
    });
});

// Space Explorer
let spaceWorker = null;
byId('explore-btn').addEventListener('click', () => {
    const btn = byId('explore-btn');
    const status = byId('status');
    const exploring = btn.textContent === 'Explore';

    if (!exploring) {
        if (spaceWorker) {
            spaceWorker.postMessage({ action: 'cancel' });
            spaceWorker.terminate();
            spaceWorker = null;
        }
        btn.textContent = 'Explore';
        status.textContent = 'Cancelled.';
        return;
    }

    const starting = $all('#starting-shapes .shape-item .shape-label').map((x) => x.textContent);
    const ops = $all('#enabled-operations .operation-item.enabled').map((x) => x.dataset.operation);
    const depthLimit = parseInt(byId('depth-limit-input').value) || 999;
    const maxLayers = parseInt(byId('max-layers').value) || 4;

    for (const code of starting) {
        if (!showValidationErrors(code, 'starting shape')) return;
    }

    if (spaceWorker) spaceWorker.terminate();
    spaceWorker = new Worker(new URL('./shapeSolver.js', import.meta.url), { type: 'module' });

    spaceWorker.onmessage = ({ data }) => {
        const { type, message, result } = data;

        if (type === 'status') {
            status.textContent = message;
            return;
        }

        if (type === 'result') {
            btn.textContent = 'Explore';
            
            if (result) {
                renderSpaceGraph(result);
            }

            spaceWorker.terminate();
            spaceWorker = null;
        }
    };

    btn.textContent = 'Cancel';
    status.textContent = 'Exploring...';

    spaceWorker.postMessage({
        action: 'explore',
        data: { startingShapeCodes: starting, enabledOperations: ops, depthLimit, maxLayers }
    });
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initializeDefaultShapes();
    byId('color-mode-select')?.addEventListener('change', refreshShapeColors);

    // Search method toggle
    byId('search-method-select').addEventListener('change', (e) => {
        const method = e.target.value;
        const heuristicGroup = byId('heuristic-divisor').closest('.option-group');
        const maxStatesGroup = byId('max-states-per-level').closest('.option-group');
        if (method === 'A*' || method === 'IDA*' || method === 'Bidirectional') {
            heuristicGroup.style.display = 'block';
            maxStatesGroup.style.display = method === 'BFS' ? 'block' : 'none';
        } else {
            heuristicGroup.style.display = 'none';
            maxStatesGroup.style.display = 'block';
        }
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
            const { restoredFloor } = applyState(state, {
                renderGraph,
                applyGraphLayout,
                buildLayout,
                duplicateForThroughput,
                BlueprintRenderer,
                createShapeItem,
                setBlueprintLayout: (layout) => { currentBlueprintLayout = layout; },
            });
            if (state.solution) {
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
        } catch (err) {
            console.warn('Failed to restore solver state, clearing.', err);
            try { localStorage.removeItem(STORAGE_KEY); } catch {}
        } finally {
            suspendPersist = false;
        }
    }
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

// Floor Controls
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

