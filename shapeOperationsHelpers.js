import {
    Shape,
    ShapePart,
    ShapeOperationConfig,
    InvalidOperationInputs,
    NOTHING_CHAR,
    PIN_CHAR,
    CRYSTAL_CHAR
} from './shapeClass.js';

function cellKey(layer, part) {
    return `${layer},${part}`;
}

// Shape Logic & Utility Functions
export function gravityConnected(part1, part2) {
    if ([NOTHING_CHAR, PIN_CHAR].includes(part1.shape) || [NOTHING_CHAR, PIN_CHAR].includes(part2.shape)) {
        return false;
    }
    return true;
}

export function crystalsFused(part1, part2) {
    return part1.shape === CRYSTAL_CHAR && part2.shape === CRYSTAL_CHAR;
}

function getCorrectedIndex(list, index) {
    if (index > list.length - 1) {
        return index - list.length;
    }
    if (index < 0) {
        return list.length + index;
    }
    return index;
}

export function getConnectedSingleLayer(layer, index, connectedFunc) {
    if (layer[index].shape === NOTHING_CHAR) {
        return [];
    }

    const connected = [index];
    let previousIndex = index;

    for (let i = index + 1; i < layer.length + index; i++) {
        const curIndex = getCorrectedIndex(layer, i);
        if (!connectedFunc(layer[previousIndex], layer[curIndex])) {
            break;
        }
        connected.push(curIndex);
        previousIndex = curIndex;
    }

    previousIndex = index;
    for (let i = index - 1; i > -layer.length + index; i--) {
        const curIndex = getCorrectedIndex(layer, i);
        if (connected.includes(curIndex)) {
            break;
        }
        if (!connectedFunc(layer[previousIndex], layer[curIndex])) {
            break;
        }
        connected.push(curIndex);
        previousIndex = curIndex;
    }

    return connected;
}

export function getConnectedMultiLayer(layers, layerIndex, partIndex, connectedFunc) {
    if (layers[layerIndex][partIndex].shape === NOTHING_CHAR) {
        return [];
    }

    const connected = [[layerIndex, partIndex]];
    const seen = new Set([cellKey(layerIndex, partIndex)]);

    for (const [curLayer, curPart] of connected) {
        for (const partIdx of getConnectedSingleLayer(layers[curLayer], curPart, connectedFunc)) {
            const key = cellKey(curLayer, partIdx);
            if (!seen.has(key)) {
                seen.add(key);
                connected.push([curLayer, partIdx]);
            }
        }

        const toCheckLayer = curLayer - 1;
        const toCheckPart = curPart;
        if (curLayer > 0) {
            const key = cellKey(toCheckLayer, toCheckPart);
            if (!seen.has(key) && connectedFunc(layers[curLayer][curPart], layers[toCheckLayer][toCheckPart])) {
                seen.add(key);
                connected.push([toCheckLayer, toCheckPart]);
            }
        }

        const toCheckLayerAbove = curLayer + 1;
        const toCheckPartAbove = curPart;
        if (curLayer < layers.length - 1) {
            const key = cellKey(toCheckLayerAbove, toCheckPartAbove);
            if (!seen.has(key) && connectedFunc(layers[curLayer][curPart], layers[toCheckLayerAbove][toCheckPartAbove])) {
                seen.add(key);
                connected.push([toCheckLayerAbove, toCheckPartAbove]);
            }
        }
    }

    return connected;
}

export function breakCrystals(layers, layerIndex, partIndex) {
    for (const [curLayer, curPart] of getConnectedMultiLayer(layers, layerIndex, partIndex, crystalsFused)) {
        layers[curLayer][curPart] = new ShapePart(NOTHING_CHAR, NOTHING_CHAR);
    }
}

export function makeLayersFall(layers) {
    function sepInGroups(layer) {
        const handledIndexes = new Set();
        const groups = [];
        for (let partIndex = 0; partIndex < layer.length; partIndex++) {
            if (handledIndexes.has(partIndex)) continue;
            const group = getConnectedSingleLayer(layer, partIndex, gravityConnected);
            if (group.length > 0) {
                groups.push(group);
                for (const idx of group) handledIndexes.add(idx);
            }
        }
        return groups;
    }

    // A part is supported iff it can reach a floor anchor (a non-empty part on
    // layer 0) through the support relations. Computing that as a monotone
    // fixpoint — seed the floor, then propagate support outward along the
    // reversed relations until nothing new turns on — is order-independent.
    // The earlier path-blocked DFS memoized a context-dependent result globally,
    // so a genuinely-supported fused crystal could be cached as unsupported
    // depending on traversal order and then wrongly shatter (#1630).
    function computeSupportedStates(layers) {
        const supported = layers.map(layer => layer.map(() => false));
        if (layers.length === 0) return supported;
        const queue = [];

        const mark = (li, pi) => {
            if (li < 0 || li >= layers.length) return;
            if (supported[li][pi] || layers[li][pi].shape === NOTHING_CHAR) return;
            supported[li][pi] = true;
            queue.push([li, pi]);
        };

        // Floor anchors: every non-empty part resting on layer 0 is supported.
        for (let partIndex = 0; partIndex < layers[0].length; partIndex++) {
            mark(0, partIndex);
        }

        while (queue.length > 0) {
            const [li, pi] = queue.pop();
            const part = layers[li][pi];
            const layer = layers[li];

            // The part directly above rests on this one (column support).
            mark(li + 1, pi);

            // Same-layer gravity-connected neighbours hold each other up.
            const nextPi = getCorrectedIndex(layer, pi + 1);
            if (gravityConnected(part, layer[nextPi])) mark(li, nextPi);
            const prevPi = getCorrectedIndex(layer, pi - 1);
            if (gravityConnected(part, layer[prevPi])) mark(li, prevPi);

            // A fused crystal directly below hangs from this one.
            if (li - 1 >= 0 && crystalsFused(part, layers[li - 1][pi])) mark(li - 1, pi);
        }

        return supported;
    }

    // First pass of calculating supported parts
    let supportedPartStates = computeSupportedStates(layers);

    // If a crystal is marked as unsupported it will fall and thus break
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        for (let partIndex = 0; partIndex < layers[layerIndex].length; partIndex++) {
            const part = layers[layerIndex][partIndex];
            if (part.shape === CRYSTAL_CHAR && !supportedPartStates[layerIndex][partIndex]) {
                layers[layerIndex][partIndex] = new ShapePart(NOTHING_CHAR, NOTHING_CHAR);
            }
        }
    }

    // Second pass of calculating supported parts
    supportedPartStates = computeSupportedStates(layers);

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        const layer = layers[layerIndex];
        if (layerIndex === 0) continue;

        for (const group of sepInGroups(layer)) {
            if (group.some(p => supportedPartStates[layerIndex][p])) continue;

            let fallToLayerIndex;
            for (fallToLayerIndex = layerIndex; fallToLayerIndex >= 0; fallToLayerIndex--) {
                if (fallToLayerIndex === 0) break;
                let fall = true;
                for (const partIndex of group) {
                    if (layers[fallToLayerIndex - 1][partIndex].shape !== NOTHING_CHAR) {
                        fall = false;
                        break;
                    }
                }
                if (!fall) break;
            }

            for (const partIndex of group) {
                layers[fallToLayerIndex][partIndex] = layers[layerIndex][partIndex];
                layers[layerIndex][partIndex] = new ShapePart(NOTHING_CHAR, NOTHING_CHAR);
            }
        }
    }

    return layers;
}

export function cleanUpEmptyUpperLayers(layers) {
    if (layers.length === 0) {
        return [];
    }

    for (let i = layers.length - 1; i >= 0; i--) {
        if (layers[i].some(p => p.shape !== NOTHING_CHAR)) {
            return layers.slice(0, i + 1);
        }
    }

    return [layers[0]];
}

export function differentNumPartsUnsupported(func) {
    return function(...args) {
        let config = new ShapeOperationConfig();
        let shapes = [];

        // Extract shapes and config from arguments
        for (let i = 0; i < args.length; i++) {
            if (args[i] instanceof Shape) {
                shapes.push(args[i]);
            } else if (args[i] instanceof ShapeOperationConfig) {
                config = args[i];
            }
        }

        if (shapes.length > 0) {
            const expected = shapes[0].numParts;
            for (const shape of shapes.slice(1)) {
                if (shape.numParts !== expected) {
                    throw new InvalidOperationInputs(
                        `Shapes with differing number of parts per layer are not supported for operation '${func.name}'`
                    );
                }
            }
        }
        return func(...args, config);
    };
}