import {
    Shape,
    ShapePart,
    ShapeOperationConfig,
    InvalidOperationInputs,
    NOTHING_CHAR,
    PIN_CHAR,
    CRYSTAL_CHAR
} from './shapeClass.js';

// Shape Logic & Utility Functions
export function _gravityConnected(part1, part2) {
    if ([NOTHING_CHAR, PIN_CHAR].includes(part1.shape) || [NOTHING_CHAR, PIN_CHAR].includes(part2.shape)) {
        return false;
    }
    return true;
}

export function _crystalsFused(part1, part2) {
    return part1.shape === CRYSTAL_CHAR && part2.shape === CRYSTAL_CHAR;
}

export function _getCorrectedIndex(list, index) {
    if (index > list.length - 1) {
        return index - list.length;
    }
    if (index < 0) {
        return list.length + index;
    }
    return index;
}

export function _getConnectedSingleLayer(layer, index, connectedFunc) {
    if (layer[index].shape === NOTHING_CHAR) {
        return [];
    }

    const connected = [index];
    let previousIndex = index;

    for (let i = index + 1; i < layer.length + index; i++) {
        const curIndex = _getCorrectedIndex(layer, i);
        if (!connectedFunc(layer[previousIndex], layer[curIndex])) {
            break;
        }
        connected.push(curIndex);
        previousIndex = curIndex;
    }

    previousIndex = index;
    for (let i = index - 1; i > -layer.length + index; i--) {
        const curIndex = _getCorrectedIndex(layer, i);
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

export function _getConnectedMultiLayer(layers, layerIndex, partIndex, connectedFunc) {
    if (layers[layerIndex][partIndex].shape === NOTHING_CHAR) {
        return [];
    }

    const connected = [[layerIndex, partIndex]];
    for (const [curLayer, curPart] of connected) {
        // same layer
        for (const partIdx of _getConnectedSingleLayer(layers[curLayer], curPart, connectedFunc)) {
            if (!connected.some(([l, p]) => l === curLayer && p === partIdx)) {
                connected.push([curLayer, partIdx]);
            }
        }

        // layer below
        const toCheckLayer = curLayer - 1;
        const toCheckPart = curPart;
        if (curLayer > 0 && !connected.some(([l, p]) => l === toCheckLayer && p === toCheckPart)) {
            if (connectedFunc(layers[curLayer][curPart], layers[toCheckLayer][toCheckPart])) {
                connected.push([toCheckLayer, toCheckPart]);
            }
        }

        // layer above
        const toCheckLayerAbove = curLayer + 1;
        const toCheckPartAbove = curPart;
        if (curLayer < layers.length - 1 && !connected.some(([l, p]) => l === toCheckLayerAbove && p === toCheckPartAbove)) {
            if (connectedFunc(layers[curLayer][curPart], layers[toCheckLayerAbove][toCheckPartAbove])) {
                connected.push([toCheckLayerAbove, toCheckPartAbove]);
            }
        }
    }

    return connected;
}

export function _breakCrystals(layers, layerIndex, partIndex) {
    for (const [curLayer, curPart] of _getConnectedMultiLayer(layers, layerIndex, partIndex, _crystalsFused)) {
        layers[curLayer][curPart] = new ShapePart(NOTHING_CHAR, NOTHING_CHAR);
    }
}

export function _makeLayersFall(layers) {
    function sepInGroups(layer) {
        const handledIndexes = [];
        const groups = [];
        for (let partIndex = 0; partIndex < layer.length; partIndex++) {
            if (handledIndexes.includes(partIndex)) continue;
            const group = _getConnectedSingleLayer(layer, partIndex, _gravityConnected);
            if (group.length > 0) {
                groups.push(group);
                handledIndexes.push(...group);
            }
        }
        return groups;
    }

    function isPartSupported(layerIndex, partIndex, visitedParts, supportedPartStates) {
        if (supportedPartStates[layerIndex][partIndex] !== null) {
            return supportedPartStates[layerIndex][partIndex];
        }

        const curPart = layers[layerIndex][partIndex];

        function inner() {
            if (layers[layerIndex][partIndex].shape === NOTHING_CHAR) {
                return false;
            }

            if (layerIndex === 0) {
                return true;
            }

            const toGiveVisitedParts = [...visitedParts, [layerIndex, partIndex]];

            const partUnderneath = [layerIndex - 1, partIndex];
            if (
                !visitedParts.some(([l, p]) => l === partUnderneath[0] && p === partUnderneath[1]) &&
                isPartSupported(partUnderneath[0], partUnderneath[1], toGiveVisitedParts, supportedPartStates)
            ) {
                return true;
            }

            const nextPartPos = [layerIndex, _getCorrectedIndex(layers[layerIndex], partIndex + 1)];
            if (
                !visitedParts.some(([l, p]) => l === nextPartPos[0] && p === nextPartPos[1]) &&
                _gravityConnected(curPart, layers[nextPartPos[0]][nextPartPos[1]]) &&
                isPartSupported(nextPartPos[0], nextPartPos[1], toGiveVisitedParts, supportedPartStates)
            ) {
                return true;
            }

            const prevPartPos = [layerIndex, _getCorrectedIndex(layers[layerIndex], partIndex - 1)];
            if (
                !visitedParts.some(([l, p]) => l === prevPartPos[0] && p === prevPartPos[1]) &&
                _gravityConnected(curPart, layers[prevPartPos[0]][prevPartPos[1]]) &&
                isPartSupported(prevPartPos[0], prevPartPos[1], toGiveVisitedParts, supportedPartStates)
            ) {
                return true;
            }

            const partAbove = [layerIndex + 1, partIndex];
            if (
                partAbove[0] < layers.length &&
                !visitedParts.some(([l, p]) => l === partAbove[0] && p === partAbove[1]) &&
                _crystalsFused(curPart, layers[partAbove[0]][partAbove[1]]) &&
                isPartSupported(partAbove[0], partAbove[1], toGiveVisitedParts, supportedPartStates)
            ) {
                return true;
            }

            return false;
        }

        const result = inner();
        supportedPartStates[layerIndex][partIndex] = result;
        return result;
    }

    // First pass of calculating supported parts
    let supportedPartStates = layers.map(layer => layer.map(() => null));
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        for (let partIndex = 0; partIndex < layers[layerIndex].length; partIndex++) {
            isPartSupported(layerIndex, partIndex, [], supportedPartStates);
        }
    }

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
    supportedPartStates = layers.map(layer => layer.map(() => null));
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        for (let partIndex = 0; partIndex < layers[layerIndex].length; partIndex++) {
            isPartSupported(layerIndex, partIndex, [], supportedPartStates);
        }
    }

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

export function _cleanUpEmptyUpperLayers(layers) {
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

export function _differentNumPartsUnsupported(func) {
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
