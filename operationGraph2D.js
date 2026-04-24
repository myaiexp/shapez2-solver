import { colorValues, createShapeCanvas } from './shapeRendering.js';
import { getCurrentColorMode } from './main.js';
import { destroySpaceGraph } from './operationGraphSpace.js';

export let cyInstance = null;
let lastSolutionPath = null;

export function destroy2DGraph() {
    if (cyInstance) {
        cyInstance.destroy();
        cyInstance = null;
    }
}

export function getCyInstance() {
    return cyInstance;
}

export function renderGraph(solutionPath) {
    const container = document.getElementById('graph-container');
    container.replaceChildren();

    destroy2DGraph();
    destroySpaceGraph();

    if (!solutionPath || solutionPath.length === 0) return;

    lastSolutionPath = solutionPath;

    const elements = [];
    const nodeMap = {};

    solutionPath.forEach((step, stepIndex) => {
        const { operation, inputs, outputs, params } = step;
        const opId = `op-${stepIndex}`;

        // Operation node
        let opLabel = operation;
        let nodeClasses = 'op';
        let backgroundColor = '#000';

        if (operation === 'Painter' || operation === 'Crystal Generator') {
            const color = params.color;
            opLabel += ` (${color})`;
            const colorMode = getCurrentColorMode();
            if (colorValues[colorMode][color]) {
                backgroundColor = colorValues[colorMode][color];
                nodeClasses += ' colored-op';
            }
        }

        let imageName = operation.toLowerCase().replace(/\s+/g, '-');

        if (operation !== 'Belt Split') {
            elements.push({
                data: {
                    id: opId,
                    label: opLabel,
                    image: `images/operations/${imageName}.png`,
                    backgroundColor: backgroundColor
                },
                classes: nodeClasses
            });
        }

        // Input shapes
        inputs.forEach(input => {
            const nodeId = `shape-${input.id}`;
            if (!nodeMap[nodeId]) {
                const shapeCanvas = createShapeCanvas(input.shape, 120);
                elements.push({
                    data: {
                        id: nodeId,
                        label: input.shape,
                        shapeCanvas: shapeCanvas.toDataURL()
                    },
                    classes: 'shape'
                });
                nodeMap[nodeId] = true;
            }
            if (operation !== 'Belt Split') {
                elements.push({ data: { source: nodeId, target: opId } });
            }
        });

        // Output shapes
        outputs.forEach(output => {
            const nodeId = `shape-${output.id}`;
            if (!nodeMap[nodeId]) {
                const shapeCanvas = createShapeCanvas((output.shape), 120);
                elements.push({
                    data: {
                        id: nodeId,
                        label: output.shape,
                        shapeCanvas: shapeCanvas.toDataURL()
                    },
                    classes: 'shape'
                });
                nodeMap[nodeId] = true;
            }
            if (operation !== 'Belt Split') {
                elements.push({ data: { source: opId, target: nodeId } });
            }
        });

        if (operation === 'Belt Split') {
            inputs.forEach(input => {
                outputs.forEach(output => {
                    elements.push({ data: { source: `shape-${input.id}`, target: `shape-${output.id}` }, classes: 'branch' });
                });
            });
        }
    });

    const directionSelect = document.getElementById('direction-select');
    const selectedDirection = directionSelect ? directionSelect.value : 'LR';

    const edgeStyleSelect = document.getElementById('edge-style-select');
    const selectedEdgeStyle = edgeStyleSelect ? edgeStyleSelect.value : 'curved';

    let edgeStyle = {
        'width': 2,
        'line-color': '#aaa',
        'target-arrow-color': '#aaa',
        'target-arrow-shape': 'triangle'
    };

    switch(selectedEdgeStyle) {
        case 'curved':
            edgeStyle['curve-style'] = 'unbundled-bezier';
            edgeStyle['control-point-weights'] = 0.5;
            break;
        case 'straight':
            edgeStyle['curve-style'] = 'straight';
            break;
        case 'orthogonal':
            edgeStyle['curve-style'] = 'taxi';
            edgeStyle['taxi-direction'] = 'auto';
            edgeStyle['taxi-turn'] = 40;
            edgeStyle['taxi-turn-min-distance'] = 20;
            break;
        case 'stepped':
            edgeStyle['curve-style'] = 'segments';
            edgeStyle['control-point-distances'] = [50, 50, 50];
            edgeStyle['control-point-weights'] = [0.33, 0.66, 1];
            break;
    }

    let branchStyle = {
        'curve-style': selectedEdgeStyle === 'orthogonal' ? 'taxi' : (selectedEdgeStyle === 'curved' ? 'unbundled-bezier' : (edgeStyle['curve-style'] || 'bezier')),
        'control-point-weights': selectedEdgeStyle === 'curved' ? 0.5 : undefined
    };
    if (selectedEdgeStyle === 'orthogonal') {
        branchStyle['taxi-direction'] = 'auto';
        branchStyle['taxi-turn'] = 40;
        branchStyle['taxi-turn-min-distance'] = 20;
    }

    cyInstance = cytoscape({
        container,
        elements,
        style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(label)',
                    'color': '#fff',
                    'text-valign': 'bottom',
                    'text-halign': 'center',
                    'text-outline-width': 1,
                    'text-outline-color': '#333',
                    'width': '80px',
                    'height': '80px',
                    'font-size': '10px'
                }
            },
            {
                selector: '.shape',
                style: {
                    'background-image': 'data(shapeCanvas)',
                    'background-fit': 'contain',
                    'background-opacity': 0.1,
                    'font-family': 'monospace'
                }
            },
            {
                selector: '.op',
                style: {
                    'background-image': 'data(image)',
                    'background-fit': 'cover',
                    'background-opacity': 0,
                    'shape': 'rectangle',
                    'background-color': 'transparent',
                    'border-width': 0,
                    'width': '60px',
                    'height': '60px'
                }
            },
            {
                selector: '.colored-op',
                style: {
                    'shape': 'ellipse',
                    'background-color': 'data(backgroundColor)',
                    'background-opacity': 0.5
                }
            },
            {
                selector: 'edge',
                style: edgeStyle
            },
            {
                selector: 'edge.branch',
                style: branchStyle
            },

            ...(selectedEdgeStyle === 'curved' ? [{
                selector: 'edge',
                style: {
                    'control-point-distances': function(ele) {
                        const cy = ele.cy();
                        const source = ele.source().position();
                        const target = ele.target().position();
                        const edgeMidY = (source.y + target.y) / 2;

                        const bb = cy.elements().boundingBox();
                        const graphMidY = bb.y1 + bb.h / 2;

                        const delta = edgeMidY - graphMidY;

                        const baseMagnitude = 40;
                        const extraFactor = 0.15;
                        const magnitude = baseMagnitude + Math.abs(delta) * extraFactor;

                        return delta > 0 ? magnitude : -magnitude;
                    }
                }
            }] : [])
        ],
        layout: {
            name: 'dagre',
            rankDir: selectedDirection,
            nodeSep: 50,
            edgeSep: 10,
            rankSep: 100
        },
        userZoomingEnabled: true,
        userPanningEnabled: true,
        boxSelectionEnabled: true,
        autoungrabify: false,
        wheelSensitivity: 0.1
    });

    cyInstance.on('tap', 'node.shape', async (evt) => {
        const code = evt.target.data('label');
        try {
            await navigator.clipboard.writeText(code);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    });
}

export function reRenderGraph() {
    if (lastSolutionPath) {
        renderGraph(lastSolutionPath);
    }
}

export function applyGraphLayout(direction) {
    if (!cyInstance) return;

    const layout = cyInstance.layout({
        name: 'dagre',
        rankDir: direction,
        nodeSep: 50,
        edgeSep: 10,
        rankSep: 100,
        animate: true,
        animationDuration: 500
    });

    layout.run();
}
