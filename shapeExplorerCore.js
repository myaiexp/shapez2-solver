import { ShapeOperationConfig } from './shapeClass.js';
import { operations } from './shapeSolverOperations.js';
import {
    shapeCache,
    operationResultCache,
    getCachedShape,
} from './shapeSolverCache.js';
import { getCrystalColors } from './shapeColorAnalysis.js';
import { expandUnaryOp, expandBinaryOp } from './shapeSolverExpansion.js';

// How often the BFS pauses to post progress and let queued messages (the
// worker's cancel) run. Checked every PULSE_EVERY expansions so the clock read
// stays off the hot path.
const PULSE_MS = 100;
const PULSE_EVERY = 256;

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
//
// `maxNodes` caps the graph (shape nodes + op nodes), mirroring the solver's
// maxStates: once the next op would push the graph past it, expansion stops and
// the partial graph comes back with `aborted: 'maxNodes'`. Starting shapes are
// always kept, even past the cap. Returns null only when cancelled.
export async function shapeExplorer(
    startingShapeCodes,
    enabledOperations,
    depthLimit,
    maxLayers,
    shouldCancel = () => false,
    onProgress = () => {},
    targetShapeCode = null,
    maxNodes = Infinity,
) {
    // NaN / 0 would cap before the first op and read as a legitimate abort.
    if (!(maxNodes >= 1)) {
        throw new RangeError(`shapeExplorer: maxNodes must be >= 1 (got ${maxNodes})`);
    }

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

    let depth = 0;
    let hitNodeCap = false;
    let ticks = 0;
    let lastPulse = Date.now();

    const stopped = () => hitNodeCap || shouldCancel();
    const counts = () => `Shapes: ${shapesList.length}, Ops: ${opsList.length}`;

    // Post progress and yield to the event loop at most every PULSE_MS. Without
    // the yield a worker cannot process 'cancel' until the whole BFS ends.
    async function pulse() {
        if (Date.now() - lastPulse < PULSE_MS) return;
        lastPulse = Date.now();
        onProgress(`Exploring depth ${depth}/${depthLimit}... ${counts()}`);
        await new Promise(r => setTimeout(r, 0));
    }

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

    // Checked before an op is recorded (never after) so the graph stays within
    // maxNodes and every edge points at a node that is in the graph.
    function fitsUnderCap(outputCodes) {
        let added = 1; // the op node itself
        for (const oc of new Set(outputCodes)) {
            if (!shapeCodeToId.has(oc)) added++;
        }
        if (shapesList.length + opsList.length + added <= maxNodes) return true;
        hitNodeCap = true;
        return false;
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
    // exploration paths. A no-op once the node cap is hit.
    function recordOperation(opName, params, inputIds, outputCodes, newlyDiscovered) {
        if (!fitsUnderCap(outputCodes)) return;
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

    async function exploreUnaryOp(op, opName, frontierIds, newlyDiscovered) {
        for (const id of frontierIds) {
            if (stopped()) return;
            if (++ticks % PULSE_EVERY === 0) await pulse();

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
                if (hitNodeCap) return;
            }
        }
    }

    // Binary BFS pairing: full inventory × previous-depth frontier (not start×start).
    async function exploreBinaryOp(op, opName, allShapeIds, frontierIds, newlyDiscovered) {
        const isStacker = opName === 'Stacker';

        for (const id1 of allShapeIds) {
            if (stopped()) return;

            const inputCode1 = shapesList[id1].code;
            const shape1 = getShapeById(id1);

            for (const id2 of frontierIds) {
                if (stopped()) return;
                if (++ticks % PULSE_EVERY === 0) await pulse();

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

    for (let level = 1; level <= depthLimit; level++) {
        if (stopped()) break;

        const newlyDiscovered = new Set();
        const allShapeIds = Array.from(discoveredIds);
        const frontierIds = Array.from(frontier);

        if (frontierIds.length === 0) break;
        depth = level;
        onProgress(`Exploring depth ${depth}/${depthLimit}... ${counts()}`);

        for (const opName of enabledOperations) {
            if (stopped()) break;

            const op = operations[opName];
            if (!op) continue;

            if (op.inputCount === 1) {
                await exploreUnaryOp(op, opName, frontierIds, newlyDiscovered);
            } else if (op.inputCount === 2) {
                await exploreBinaryOp(op, opName, allShapeIds, frontierIds, newlyDiscovered);
            }
        }
        frontier = newlyDiscovered;
    }

    if (shouldCancel()) return null;

    onProgress(hitNodeCap
        ? `Exploration stopped at the ${maxNodes}-node cap in depth ${depth}/${depthLimit}. ${counts()}`
        : `Exploration complete. ${counts()}`);
    return {
        shapes: shapesList.map(s => ({ id: `shape-${s.id}`, code: s.code })),
        ops: opsList,
        edges,
        // Deepest level expanded; with aborted: 'maxNodes' that level is partial.
        depth,
        maxNodes,
        aborted: hitNodeCap ? 'maxNodes' : null,
    };
}
