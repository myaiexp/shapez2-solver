import { ShapeOperationConfig } from './shapeClass.js';
import { operations } from './shapeSolverOperations.js';
import {
    shapeCache,
    operationResultCache,
    getCachedShape,
} from './shapeSolverCache.js';
import { getCrystalColors } from './shapeColorAnalysis.js';
import { expandUnaryOp, expandBinaryOp } from './shapeSolverExpansion.js';

// Short-array equality for Stacker outputCodes (typically length 1).
function sameCodes(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

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

    // Getter (not a method): enumerateUnaryColors for-of expects an array of
    // codes. A live getter keeps the full inventory as shapes are discovered,
    // matching the solver's per-expansion materialization of referenceCodes.
    const colorContext = {
        target,
        targetCrystalColors,
        get referenceCodes() {
            return shapesList.map(s => s.code);
        },
        getShape: getCachedShape,
    };

    const expansionPruning = {
        monolayerPainting: false,
    };

    function recordDescriptor(desc, newlyDiscovered) {
        const params = desc.color ? { color: desc.color } : {};
        recordOperation(desc.type, params, desc.inputIds, desc.outputCodes, newlyDiscovered);
    }

    // Record one operation node and its edges: the op node, an edge from each input
    // shape, and an edge to each output shape (registering newly-discovered outputs
    // into discoveredIds and the per-depth frontier). Shared by the unary and binary
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
                discoveredIds.add(outId);
                newlyDiscovered.add(outId);
            }
            edges.push({ source: opId, target: `shape-${outId}` });
        }
    }

    function exploreUnaryOp(op, opName, frontierIds, newlyDiscovered) {
        for (const id of frontierIds) {
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

    // Binary BFS pairing: full inventory × previous-depth frontier (not start×start).
    function exploreBinaryOp(op, opName, allShapeIds, frontierIds, newlyDiscovered) {
        const isStacker = opName === 'Stacker';

        for (const id1 of allShapeIds) {
            if (shouldCancel()) return;

            const inputCode1 = shapesList[id1].code;
            const shape1 = getShapeById(id1);

            for (const id2 of frontierIds) {
                if (shouldCancel()) return;

                if (id1 === id2 && !isStacker) continue;
                if (id1 > id2 && !isStacker) continue;

                const inputCode2 = shapesList[id2].code;
                const shape2 = getShapeById(id2);

                const desc = expandBinaryOp(
                    opName, op, id1, id2,
                    inputCode1, inputCode2, shape1, shape2, config, { useCache: true }
                );
                if (!desc) continue;

                // Stacker(A,B) and Stacker(B,A) can yield the same product
                // (complementary halves). Record only the lower-id order then;
                // keep both when they differ. Reverse-expand only for the
                // higher-id order, which is the one we might skip.
                if (isStacker && id1 > id2) {
                    const descRev = expandBinaryOp(
                        opName, op, id2, id1,
                        inputCode2, inputCode1, shape2, shape1, config, { useCache: true }
                    );
                    if (descRev && sameCodes(desc.outputCodes, descRev.outputCodes)) continue;
                }

                recordDescriptor(desc, newlyDiscovered);
            }
        }
    }

    const discoveredIds = new Set();
    for (const code of startingShapeCodes) {
        const { id } = addShapeIfNew(code);
        discoveredIds.add(id);
    }

    let frontier = new Set(discoveredIds);

    for (let depth = 1; depth <= depthLimit; depth++) {
        if (shouldCancel()) {
            return null;
        }

        const newlyDiscovered = new Set();
        const allShapeIds = Array.from(discoveredIds);
        const frontierIds = Array.from(frontier);

        if (frontierIds.length === 0) break;

        for (const opName of enabledOperations) {
            if (shouldCancel()) {
                return null;
            }

            const op = operations[opName];
            if (!op) continue;

            if (op.inputCount === 1) {
                exploreUnaryOp(op, opName, frontierIds, newlyDiscovered);
            } else if (op.inputCount === 2) {
                exploreBinaryOp(op, opName, allShapeIds, frontierIds, newlyDiscovered);
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