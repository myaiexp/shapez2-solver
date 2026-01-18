// Imports
import { createShapeCanvas, createShapeElement, colorValues } from './shapeRendering.js';
import { Shape, _extractLayers, _filterStartingShapes } from './shapeOperations.js';
import { cyInstance, copyGraphToClipboard, applyGraphLayout, renderGraph, renderSpaceGraph, reRenderGraph } from './operationGraph.js';
import { showValidationErrors } from './shapeValidation.js';
import { SHAPE_TYPES, COLOR_TYPES, buildShapeCode, parseShapeCode, getShapeInfo, getColorInfo, createDefaultParts } from './shapeColorData.js';

// Utility Helpers
const $ = (sel) => document.querySelector(sel);
const $all = (sel) => Array.from(document.querySelectorAll(sel));
const byId = (id) => document.getElementById(id);

export function getCurrentColorMode() {
    return byId('color-mode-select')?.value || 'rgb';
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
});

// Remove Shape Button
byId('starting-shapes').addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-shape')) {
        e.target.parentElement.remove();
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
    });
});

// Operation Toggle
$all('.operation-item').forEach((item) => {
    item.addEventListener('click', () => item.classList.toggle('enabled'));
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
                const t = ((performance.now() - startTime) / 1000).toFixed(2);
                status.textContent = `Solved in ${t}s at Depth ${result.depth} → ${result.statesExplored} States`;
            } else {
                status.textContent = 'No solution found.';
            }

            btn.textContent = 'Solve';
            solverWorker.terminate();
            solverWorker = null;
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
        if (method === 'A*') {
            heuristicGroup.style.display = 'block';
            maxStatesGroup.style.display = 'none';
        } else {
            heuristicGroup.style.display = 'none';
            maxStatesGroup.style.display = 'block';
        }
    });

    // Initial toggle
    byId('search-method-select').dispatchEvent(new Event('change'));
});

// Graph Controls
byId('snapshot-btn').addEventListener('click', copyGraphToClipboard);
byId('direction-select').addEventListener('change', (e) => {
    applyGraphLayout(e.target.value);
});
byId('edge-style-select').addEventListener('change', () => {
    reRenderGraph();
});

// ============================================
// Shape Builder Implementation
// ============================================

let targetShapeBuilderState = {
    numParts: 4,
    numLayers: 1,
    currentLayer: 0, // Index of currently edited layer
    layers: [createDefaultParts(4)] // Array of layers, each layer is an array of parts
};

let newShapeBuilderState = {
    numParts: 4,
    numLayers: 1,
    currentLayer: 0,
    layers: [createDefaultParts(4)]
};

let activeBuilder = null; // 'target' or 'new'

function renderShapePreview(containerId, state) {
    const container = byId(containerId);
    if (!container) return;
    
    const shapeCode = buildShapeCode(state.layers);
    container.innerHTML = '';
    container.appendChild(createShapeCanvas(shapeCode, 100));
}

function renderPartsEditor(containerId, state, builderType) {
    const container = byId(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    // Get parts for the currently selected layer
    const currentParts = state.layers[state.currentLayer];
    
    for (let i = 0; i < state.numParts; i++) {
        const part = currentParts[i];
        const shapeInfo = getShapeInfo(part.shape);
        const isPaintable = shapeInfo.paintable;
        
        const partEditor = document.createElement('div');
        partEditor.className = 'part-editor';
        partEditor.innerHTML = `
            <div class="part-position">Position ${i + 1}</div>
            <div class="part-selectors">
                ${createShapeDropdown(`${builderType}-part-shape-${i}`, part.shape)}
                ${createColorDropdown(`${builderType}-part-color-${i}`, part.color, isPaintable)}
            </div>
        `;
        container.appendChild(partEditor);
    }
}

function createShapeDropdown(id, selectedShape) {
    const shapes = SHAPE_TYPES.map(s => `
        <div class="shape-option ${s.char === selectedShape ? 'selected' : ''}"
             data-shape="${s.char}">
            <span class="shape-emoji">${s.emoji}</span>
            <span class="shape-name">${s.name}</span>
        </div>
    `).join('');
    
    const selected = getShapeInfo(selectedShape);
    return `
        <div class="shape-selector">
            <button class="shape-selector-btn" id="${id}-btn">
                <span class="selected-shape-emoji">${selected.emoji}</span>
                <span class="selected-shape-name">${selected.name}</span>
                <span class="dropdown-arrow">▼</span>
            </button>
            <div class="shape-dropdown" id="${id}-dropdown">
                <div class="dropdown-search">
                    <input type="text" placeholder="Search shapes..." class="shape-search">
                </div>
                <div class="shape-options">
                    ${shapes}
                </div>
            </div>
        </div>
    `;
}

function createColorDropdown(id, selectedColor, isPaintable = true) {
    const colors = COLOR_TYPES.map(c => `
        <div class="color-option ${c.char === selectedColor ? 'selected' : ''}"
             data-color="${c.char}">
            <span class="color-emoji">${c.emoji}</span>
            <span class="color-name">${c.name}</span>
        </div>
    `).join('');
    
    const selected = getColorInfo(selectedColor);
    const disabledClass = isPaintable ? '' : 'disabled';
    const disabledAttr = isPaintable ? '' : 'disabled';
    const title = isPaintable ? '' : 'title="Colors cannot be applied to this shape type"';
    
    return `
        <div class="color-selector ${disabledClass}">
            <button class="color-selector-btn" id="${id}-btn" ${disabledAttr} ${title}>
                <span class="selected-color-emoji">${selected.emoji}</span>
                <span class="selected-color-name">${selected.name}</span>
                <span class="dropdown-arrow">▼</span>
            </button>
            <div class="color-dropdown" id="${id}-dropdown">
                ${colors}
            </div>
        </div>
    `;
}

function updateShapeBuilder(builderType) {
    const state = builderType === 'target' ? targetShapeBuilderState : newShapeBuilderState;
    renderShapePreview(`${builderType}-shape-preview`, state);
    renderPartsEditor(`${builderType}-parts-editor`, state, builderType);
    
    // Update layer count display
    const layerCountEl = byId(`${builderType}-layer-count`);
    if (layerCountEl) {
        layerCountEl.textContent = `${state.numLayers} Layer${state.numLayers > 1 ? 's' : ''}`;
    }
    
    // Update layer selector visibility and active state
    updateLayerSelector(builderType);
    
    // Auto-sync to text field
    syncBuilderToInput(builderType);
}

function updateLayerSelector(builderType) {
    const state = builderType === 'target' ? targetShapeBuilderState : newShapeBuilderState;
    const selectorContainer = byId(`${builderType}-layer-selector`);
    if (!selectorContainer) return;
    
    // Show/hide selector based on number of layers
    selectorContainer.style.display = state.numLayers > 1 ? 'flex' : 'none';
    
    // Update active layer button
    selectorContainer.querySelectorAll('.layer-tab').forEach((tab, index) => {
        tab.classList.toggle('active', index === state.currentLayer);
    });
}

function syncBuilderToInput(builderType) {
    const state = builderType === 'target' ? targetShapeBuilderState : newShapeBuilderState;
    const shapeCode = buildShapeCode(state.layers);
    
    if (builderType === 'target') {
        byId('target-shape').value = shapeCode;
    } else {
        byId('new-shape-input').value = shapeCode;
    }
}

function initializeShapeBuilder(builderType) {
    const state = builderType === 'target' ? targetShapeBuilderState : newShapeBuilderState;
    state.numParts = 4;
    state.numLayers = 1;
    state.currentLayer = 0;
    state.layers = [createDefaultParts(4)];
    updateShapeBuilder(builderType);
}

// Target Shape Builder Toggle
byId('target-shape-builder-btn').addEventListener('click', () => {
    const builder = byId('target-shape-builder');
    const input = byId('target-shape');
    
    if (builder.style.display === 'none') {
        // Parse existing input if valid
        const existingCode = input.value.trim();
        if (existingCode && validateShapeCodeForBuilder(existingCode)) {
            parseShapeToBuilder(existingCode, targetShapeBuilderState);
        } else {
            initializeShapeBuilder('target');
        }
        builder.style.display = 'block';
        activeBuilder = 'target';
        updateShapeBuilder('target');
    } else {
        builder.style.display = 'none';
        activeBuilder = null;
    }
});

// New Shape Builder Toggle
byId('new-shape-builder-btn').addEventListener('click', () => {
    const builder = byId('target-shape-builder'); // Reuse the same builder panel
    const input = byId('new-shape-input');
    
    // Update builder header for new shape
    const header = builder.querySelector('.builder-header h3');
    header.textContent = 'Build Starting Shape';
    
    if (builder.style.display === 'none') {
        // Parse existing input if valid
        const existingCode = input.value.trim();
        if (existingCode && validateShapeCodeForBuilder(existingCode)) {
            parseShapeToBuilder(existingCode, newShapeBuilderState);
        } else {
            initializeShapeBuilder('new');
        }
        builder.style.display = 'block';
        activeBuilder = 'new';
        updateShapeBuilder('new');
    } else {
        builder.style.display = 'none';
        activeBuilder = null;
        // Reset header
        header.textContent = 'Build Target Shape';
    }
});

function validateShapeCodeForBuilder(shapeCode) {
    try {
        const layers = shapeCode.split(':');
        if (layers.length === 0) return false;
        const numParts = layers[0].length / 2;
        if (!Number.isInteger(numParts) || numParts < 1) return false;
        return layers.every(layer => layer.length === numParts * 2);
    } catch {
        return false;
    }
}

function parseShapeToBuilder(shapeCode, state) {
    try {
        const parsedLayers = parseShapeCode(shapeCode);
        state.numLayers = parsedLayers.length;
        state.numParts = parsedLayers[0].length;
        state.currentLayer = 0;
        // Convert parsed layers to our format: array of arrays of {shape, color}
        state.layers = parsedLayers.map(layer =>
            layer.map(p => ({ shape: p.shape, color: p.color }))
        );
    } catch {
        initializeShapeBuilder(state === targetShapeBuilderState ? 'target' : 'new');
    }
}

// Layer controls for target builder
byId('target-add-layer-btn').addEventListener('click', () => {
    if (targetShapeBuilderState.numLayers < 5) {
        targetShapeBuilderState.numLayers++;
        // Add a new layer with default parts
        targetShapeBuilderState.layers.push(createDefaultParts(targetShapeBuilderState.numParts));
        // Switch to the new layer
        targetShapeBuilderState.currentLayer = targetShapeBuilderState.numLayers - 1;
        console.log('[DEBUG] Layer added:', {
            numLayers: targetShapeBuilderState.numLayers,
            currentLayer: targetShapeBuilderState.currentLayer,
            layersCount: targetShapeBuilderState.layers.length
        });
        updateShapeBuilder('target');
    }
});

byId('target-remove-layer-btn').addEventListener('click', () => {
    if (targetShapeBuilderState.numLayers > 1) {
        targetShapeBuilderState.numLayers--;
        // Remove the last layer
        targetShapeBuilderState.layers.pop();
        // Adjust current layer if needed
        if (targetShapeBuilderState.currentLayer >= targetShapeBuilderState.numLayers) {
            targetShapeBuilderState.currentLayer = targetShapeBuilderState.numLayers - 1;
        }
        console.log('[DEBUG] Layer removed:', {
            numLayers: targetShapeBuilderState.numLayers,
            currentLayer: targetShapeBuilderState.currentLayer,
            layersCount: targetShapeBuilderState.layers.length
        });
        updateShapeBuilder('target');
    }
});

// Layer tab click handler
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('layer-tab')) {
        const tab = e.target;
        const builderType = tab.dataset.builder;
        const layerIndex = parseInt(tab.dataset.layer);
        const state = builderType === 'target' ? targetShapeBuilderState : newShapeBuilderState;
        
        state.currentLayer = layerIndex;
        console.log('[DEBUG] Layer switched:', {
            builderType,
            layerIndex,
            numLayers: state.numLayers
        });
        updateShapeBuilder(builderType);
    }
});

// Apply/Cancel buttons for target builder
byId('target-apply-shape-btn').addEventListener('click', () => {
    byId('target-shape-builder').style.display = 'none';
    activeBuilder = null;
});

byId('target-cancel-shape-btn').addEventListener('click', () => {
    byId('target-shape-builder').style.display = 'none';
    activeBuilder = null;
});

// Dropdown toggle and selection handling
document.addEventListener('click', (e) => {
    // Toggle shape dropdowns
    if (e.target.closest('.shape-selector-btn')) {
        const btn = e.target.closest('.shape-selector-btn');
        const dropdown = btn.nextElementSibling;
        document.querySelectorAll('.shape-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.remove('active');
        });
        dropdown.classList.toggle('active');
        
        // Focus search input if present
        const searchInput = dropdown.querySelector('.shape-search');
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 100);
        }
    }
    
    // Toggle color dropdowns
    if (e.target.closest('.color-selector-btn')) {
        const btn = e.target.closest('.color-selector-btn');
        const dropdown = btn.nextElementSibling;
        document.querySelectorAll('.color-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.remove('active');
        });
        dropdown.classList.toggle('active');
    }
    
    // Handle shape option selection
    if (e.target.closest('.shape-option')) {
        const option = e.target.closest('.shape-option');
        const shape = option.dataset.shape;
        const dropdown = option.closest('.shape-dropdown');
        const btn = dropdown.previousElementSibling;
        
        // Extract builder type and position from button ID
        const btnId = btn?.id;
        const match = btnId?.match(/^(target|new)-part-shape-(\d+)-btn$/);
        
        if (match) {
            const builderType = match[1];
            const position = parseInt(match[2]);
            const state = builderType === 'target' ? targetShapeBuilderState : newShapeBuilderState;
            const currentParts = state.layers[state.currentLayer];
            
            console.log('[DEBUG] Shape selection:', {
                builderType,
                position,
                currentLayer: state.currentLayer,
                numLayers: state.numLayers,
                previousShape: currentParts[position]?.shape,
                newShape: shape
            });
            
            currentParts[position].shape = shape;
            updateShapeBuilder(builderType);
            syncBuilderToInput(builderType);
        }
        
        dropdown.classList.remove('active');
    }
    
    // Handle color option selection
    if (e.target.closest('.color-option')) {
        const option = e.target.closest('.color-option');
        const color = option.dataset.color;
        const dropdown = option.closest('.color-dropdown');
        const btn = dropdown.previousElementSibling;
        
        // Extract builder type and position from button ID
        const btnId = btn.id;
        const match = btnId.match(/^(target|new)-part-color-(\d+)-btn$/);
        if (match) {
            const builderType = match[1];
            const position = parseInt(match[2]);
            const state = builderType === 'target' ? targetShapeBuilderState : newShapeBuilderState;
            const currentParts = state.layers[state.currentLayer];
            
            // Check if shape is paintable before allowing color change
            const currentShapeChar = currentParts[position].shape;
            const shapeInfo = getShapeInfo(currentShapeChar);
            
            if (!shapeInfo.paintable) {
                console.log(`Cannot change color for non-paintable shape: ${shapeInfo.name} (${currentShapeChar})`);
                dropdown.classList.remove('active');
                return;
            }
            
            currentParts[position].color = color;
            updateShapeBuilder(builderType);
            syncBuilderToInput(builderType);
        }
        
        dropdown.classList.remove('active');
    }
    
    // Close dropdowns when clicking outside
    if (!e.target.closest('.shape-selector') && !e.target.closest('.color-selector')) {
        document.querySelectorAll('.shape-dropdown, .color-dropdown').forEach(d => {
            d.classList.remove('active');
        });
    }
});

// Shape search filtering
document.addEventListener('input', (e) => {
    if (e.target.classList.contains('shape-search')) {
        const search = e.target.value.toLowerCase();
        const dropdown = e.target.closest('.shape-dropdown');
        const options = dropdown.querySelectorAll('.shape-option');
        
        options.forEach(option => {
            const name = option.querySelector('.shape-name').textContent.toLowerCase();
            option.style.display = name.includes(search) ? 'flex' : 'none';
        });
    }
});

// Close builder on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const targetBuilder = byId('target-shape-builder');
        if (targetBuilder.style.display !== 'none') {
            targetBuilder.style.display = 'none';
            activeBuilder = null;
            
            // Reset header if it was for new shape
            const header = targetBuilder.querySelector('.builder-header h3');
            header.textContent = 'Build Target Shape';
        }
    }
});
