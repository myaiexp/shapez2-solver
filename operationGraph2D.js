import { createShapeCanvas } from './shapeRendering.js';
import { getCurrentColorMode } from './colorMode.js';
import { cyInstance, setCyInstance, destroy2DGraph, destroySpaceGraph } from './operationGraphInstances.js';
import { buildGraphElements } from './operationGraphElements.js';
import { copyText } from './clipboardFeedback.js';

let lastSolutionPath = null;

// Builds the Cytoscape style array for the 2D operation graph. A factory rather
// than a constant because it closes over the per-render edge/branch styles and
// the selected edge style (which gates the curved-edge control-point rule).
function buildGraph2DStyle(edgeStyle, branchStyle, selectedEdgeStyle) {
    return [
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
    ];
}

// Builds the dagre layout config shared by the initial render and re-layouts.
// `extra` carries per-call options (e.g. animation for interactive re-layouts).
function buildGraph2DLayout(direction, extra = {}) {
    return {
        name: 'dagre',
        rankDir: direction,
        nodeSep: 50,
        edgeSep: 10,
        rankSep: 100,
        ...extra
    };
}

// Curve extras keyed by the edge-style select. Shared by `edge` and
// `edge.branch` so branch edges reuse the same values.
const EDGE_CURVE = {
    curved: {
        'curve-style': 'unbundled-bezier',
        'control-point-weights': 0.5
    },
    straight: {
        'curve-style': 'straight'
    },
    orthogonal: {
        'curve-style': 'taxi',
        'taxi-direction': 'auto',
        'taxi-turn': 40,
        'taxi-turn-min-distance': 20
    },
    stepped: {
        'curve-style': 'segments',
        'control-point-distances': [50, 50, 50],
        'control-point-weights': [0.33, 0.66, 1]
    }
};

// Drop the cached path so reRenderGraph (edge-style changes) cannot revive a
// graph the UI has already cleared — failed solves and Explore both need this.
export function clearLastSolutionPath() {
    lastSolutionPath = null;
}

export function renderGraph(solutionPath) {
    const container = document.getElementById('graph-container');
    container.replaceChildren();

    destroy2DGraph();
    destroySpaceGraph();

    // Always update the cache, including null/empty clears. The early return
    // used to leave lastSolutionPath pointing at the prior success, so status
    // could say "no solution" while edge-style re-renders drew the old chain.
    if (!solutionPath || solutionPath.length === 0) {
        lastSolutionPath = null;
        return;
    }

    lastSolutionPath = solutionPath;

    const elements = buildGraphElements(solutionPath, {
        shapeImage: (code) => createShapeCanvas(code, 120).toDataURL(),
        colorMode: getCurrentColorMode()
    });

    const directionSelect = document.getElementById('direction-select');
    const selectedDirection = directionSelect ? directionSelect.value : 'LR';

    const edgeStyleSelect = document.getElementById('edge-style-select');
    const selectedEdgeStyle = edgeStyleSelect ? edgeStyleSelect.value : 'curved';

    const curveStyle = EDGE_CURVE[selectedEdgeStyle] || { 'curve-style': 'bezier' };
    const edgeStyle = {
        'width': 2,
        'line-color': '#aaa',
        'target-arrow-color': '#aaa',
        'target-arrow-shape': 'triangle',
        ...curveStyle
    };
    const branchStyle = { ...curveStyle };

    const cy = cytoscape({
        container,
        elements,
        style: buildGraph2DStyle(edgeStyle, branchStyle, selectedEdgeStyle),
        layout: buildGraph2DLayout(selectedDirection),
        userZoomingEnabled: true,
        userPanningEnabled: true,
        boxSelectionEnabled: true,
        autoungrabify: false,
        wheelSensitivity: 0.1
    });

    setCyInstance(cy);

    cy.on('tap', 'node.shape', (evt) => {
        const code = evt.target.data('label');
        copyText(code, code);
    });
}

export function reRenderGraph() {
    if (lastSolutionPath) {
        renderGraph(lastSolutionPath);
    }
}

export function applyGraphLayout(direction) {
    if (!cyInstance) return;

    const layout = cyInstance.layout(buildGraph2DLayout(direction, {
        animate: true,
        animationDuration: 500
    }));

    layout.run();
}
