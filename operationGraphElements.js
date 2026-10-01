import { colorValues } from './shapeRenderingColors.js';
import { operations } from './shapeSolverOperations.js';

// Background of an op node whose color is missing or outside the palette.
export const UNTINTED_OP = '#000';

// The palette tint for a color op's `color` in `colorMode`, or null when the
// palette has no such color (the node then stays untinted).
export function opTint(color, colorMode) {
    return (color && colorValues[colorMode]?.[color]) || null;
}

// Cytoscape element definitions for one solution path — the whole structure of
// the flowchart, kept free of DOM/canvas access so it runs (and is tested) in
// plain node. `shapeImage(code)` supplies a shape node's thumbnail URL and
// `colorMode` picks the palette for colored-op nodes; renderGraph passes the
// live canvas renderer and the color-mode <select> value. Shape nodes carry
// their raw `shapeCode` and color ops their raw `color` so later passes
// (recoloring, click-to-copy) read data instead of parsing display labels.
export function buildGraphElements(solutionPath, { shapeImage, colorMode }) {
    if (!solutionPath || solutionPath.length === 0) return [];

    const elements = [];
    const nodeIds = new Set();

    // One node per shape id, not per code: two copies of the same shape are two
    // items on two belts and must stay two nodes.
    function addShapeNode({ id, shape }) {
        const nodeId = `shape-${id}`;
        if (nodeIds.has(nodeId)) return;
        nodeIds.add(nodeId);
        elements.push({
            data: { id: nodeId, label: shape, shapeCode: shape, shapeCanvas: shapeImage(shape) },
            classes: 'shape'
        });
    }

    solutionPath.forEach((step, stepIndex) => {
        const { operation, inputs, outputs, params } = step;

        for (const input of inputs) addShapeNode(input);
        for (const output of outputs) addShapeNode(output);

        // Belt Split is an edge-only pass: shape→shape branch edges, no op node.
        if (operation === 'Belt Split') {
            for (const input of inputs) {
                for (const output of outputs) {
                    elements.push({
                        data: { source: `shape-${input.id}`, target: `shape-${output.id}` },
                        classes: 'branch'
                    });
                }
            }
            return;
        }

        const opId = `op-${stepIndex}`;
        let opLabel = operation;
        let nodeClasses = 'op';
        let backgroundColor = UNTINTED_OP;
        const colorData = {};

        if (operations[operation]?.needsColor) {
            const color = params?.color;
            opLabel += ` (${color})`;
            colorData.color = color;
            const tint = opTint(color, colorMode);
            if (tint) {
                backgroundColor = tint;
                nodeClasses += ' colored-op';
            }
        }

        const imageName = operation.toLowerCase().replace(/\s+/g, '-');
        elements.push({
            data: {
                id: opId,
                label: opLabel,
                image: `images/operations/${imageName}.png`,
                backgroundColor,
                ...colorData
            },
            classes: nodeClasses
        });

        for (const input of inputs) {
            elements.push({ data: { source: `shape-${input.id}`, target: opId } });
        }
        for (const output of outputs) {
            elements.push({ data: { source: opId, target: `shape-${output.id}` } });
        }
    });

    return elements;
}
