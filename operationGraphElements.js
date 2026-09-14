import { colorValues } from './shapeRenderingColors.js';
import { operations } from './shapeSolverOperations.js';

// Cytoscape element definitions for one solution path — the whole structure of
// the flowchart, kept free of DOM/canvas access so it runs (and is tested) in
// plain node. `shapeImage(code)` supplies a shape node's thumbnail URL and
// `colorMode` picks the palette for colored-op nodes; renderGraph passes the
// live canvas renderer and the color-mode <select> value.
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
            data: { id: nodeId, label: shape, shapeCanvas: shapeImage(shape) },
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
        let backgroundColor = '#000';

        if (operations[operation]?.needsColor) {
            const color = params?.color;
            opLabel += ` (${color})`;
            if (color && colorValues[colorMode]?.[color]) {
                backgroundColor = colorValues[colorMode][color];
                nodeClasses += ' colored-op';
            }
        }

        const imageName = operation.toLowerCase().replace(/\s+/g, '-');
        elements.push({
            data: {
                id: opId,
                label: opLabel,
                image: `images/operations/${imageName}.png`,
                backgroundColor
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
