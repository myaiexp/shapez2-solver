import { ShapeOperationConfig } from './shapeOperations.js';
import { operations } from './shapeSolverOperations.js';
import {
    shapeCache,
    operationResultCache,
    getCachedShape,
} from './shapeSolverCache.js';
import { getCrystalColors } from './shapeAnalysis.js';
import { expandUnaryOp, expandBinaryOp } from './shapeSolverExpansion.js';

// Breadth-first space explorer for the visualization: starting from the given
// shapes, repeatedly applies every enabled operation up to `depthLimit`, building
// a graph of shape nodes / operation nodes / edges. Shares operation expansion
// semantics with the solver via shapeSolverExpansion.js.
export async function shapeExplorer(
    startingShapeCodes,
    enabledOperations,
    depthLimit,
    maxLayers,
    shouldCancel = () => false,
    onProgress = () => {},
    targetShapeCode = null,
) {
    shapeCache.clear();
    operationResultCache.clear();

    const config = new ShapeOperationConfig(maxLayers);
    const target = targetShapeCode ? getCachedShape(targetShapeCode) : null;
    const targetCrystalColors = target ? getCrystalColors(target) : null;

    let nextShapeId = 0;
    let nextOpId = 0;
    const shapeCodeToId = new Map();
    const shapesList = [];
    const opsList = [];
    const edges = [];

    function addShapeIfNew(code) {
        if (!shapeCodeToId.has(code)) {
            const id = nextShapeId++;
            shapeCodeToId.set(code, id);
            shapesList.push({ id, code });
            return { id, added: true };
        }
        return { id: shapeCodeToId.get(code), added: false };
    }

    function getShapeById(id) {
        return getCachedShape(shapesList[id].code);
    }

    function referenceCodes() {
        return shapesList.map(s => s.code);
    }

    const colorContext = {
        target,
        targetCrystalColors,
        referenceCodes,
        getShape: getCachedShape,
    };

    const expansionPruning = {
        monolayerPainting: false,
        availableIdsSize: Infinity,
    };

    function recordDescriptor(desc, newlyDiscovered) {
        const params = desc.color ? { color: desc.color } : {};
        recordOperation(desc.type, params, desc.inputIds, desc.outputCodes, newlyDiscovered);
    }

    // Record one operation node and its edges: the op node, an edge from each input
    // shape, and an edge to each output shape (registering newly-discovered outputs
    // into availableIds and the per-depth frontier). Shared by the unary and binary
    // exploration paths, which previously each carried a verbatim copy of this tail.
    function recordOperation(opName, params, inputIds, outputCodes, newlyDiscovered) {
        const opId = `op-${nextOpId++}`;
        opsList.push({ id: opId, type: opName, params });
        for (const inId of inputIds) {
            edges.push({ source: `shape-${inId}`, target: opId });
        }
        for (const oc of outputCodes) {
            const { id: outId, added } = addShapeIfNew(oc);
            if (added) {
                availableIds.add(outId);
                newlyDiscovered.add(outId);
            }
            edges.push({ source: opId, target: `shape-${outId}` });
        }
    }

    function exploreUnaryOp(op, opName, primaryIds, newlyDiscovered) {
        for (const id of primaryIds) {
            if (shouldCancel()) return;

            const inputCode = shapesList[id].code;
            const inputShape = getShapeById(id);

            if (opName === 'Trash') {
                if (!inputShape.isEmpty()) {
                    recordOperation(opName, {}, [id], [], newlyDiscovered);
                }
                continue;
            }

            for (const desc of expandUnaryOp(opName, op, id, inputCode, inputShape, config, {
                needsColor: op.needsColor,
                pruning: expansionPruning,
                colorContext,
                useCache: true,
            })) {
                recordDescriptor(desc, newlyDiscovered);
            }
        }
    }

    function exploreBinaryOp(op, opName, startIds, primaryIds, newlyDiscovered) {
        const isStacker = opName === 'Stacker';

        for (const id1 of startIds) {
            if (shouldCancel()) return;

            const inputCode1 = shapesList[id1].code;
            const shape1 = getShapeById(id1);

            for (const id2 of primaryIds) {
                if (shouldCancel()) return;

                if (id1 === id2 && !isStacker) continue;
                if (id1 > id2 && !isStacker) continue;

                const inputCode2 = shapesList[id2].code;
                const shape2 = getShapeById(id2);

                if (isStacker && id1 !== id2) {
                    const descA = expandBinaryOp(
                        opName, op, id1, id2,
                        inputCode1, inputCode2, shape1, shape2, config, { useCache: true }
                    );
                    const descB = expandBinaryOp(
                        opName, op, id2, id1,
                        inputCode2, inputCode1, shape2, shape1, config, { useCache: true }
                    );
                    const same = descA && descB
                        && JSON.stringify(descA.outputCodes) === JSON.stringify(descB.outputCodes);
                    if (same && id1 > id2) continue;
                }

                const desc = expandBinaryOp(
                    opName, op, id1, id2,
                    inputCode1, inputCode2, shape1, shape2, config, { useCache: true }
                );
                if (desc) recordDescriptor(desc, newlyDiscovered);
            }
        }
    }

    const availableIds = new Set();
    for (const code of startingShapeCodes) {
        const { id } = addShapeIfNew(code);
        availableIds.add(id);
    }

    let frontier = new Set(availableIds);

    for (let depth = 1; depth <= depthLimit; depth++) {
        if (shouldCancel()) {
            return null;
        }

        const newlyDiscovered = new Set();
        const startIds = Array.from(availableIds);
        const primaryIds = Array.from(frontier);

        if (primaryIds.length === 0) break;

        for (const opName of enabledOperations) {
            if (shouldCancel()) {
                return null;
            }

            const op = operations[opName];
            if (!op) continue;

            if (op.inputCount === 1) {
                exploreUnaryOp(op, opName, primaryIds, newlyDiscovered);
            } else if (op.inputCount === 2) {
                exploreBinaryOp(op, opName, startIds, primaryIds, newlyDiscovered);
            }
        }
        frontier = newlyDiscovered;
    }

    if (!shouldCancel()) {
        const shapesNodes = shapesList.map(s => ({ id: `shape-${s.id}`, code: s.code }));
        onProgress(`Exploration complete. Shapes: ${shapesNodes.length}, Ops: ${opsList.length}`);
        return { shapes: shapesNodes, ops: opsList, edges };
    }

    return null;
}