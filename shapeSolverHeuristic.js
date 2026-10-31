// Clean sub-shape coverage heuristic for A*, IDA* and the BFS beam (idea #1677).
//
// Similarity-to-target was a poor guide for ASSEMBLY targets, in two ways:
//   1. A single building-block quadrant (e.g. Cu------) scored the SAME as the
//      uniform start it came from (CuCuCuCu), so cutting toward the right piece
//      showed zero progress.
//   2. Taking the max similarity over available shapes gave NO credit for holding
//      several complementary pieces at once, so assembling the 2nd/3rd/4th
//      quadrant in parallel sat on a flat plateau — across which A* degenerates to
//      brute BFS and floods the state cap before it can stack them together.
//
// Instead each target SLOT is scored independently by how close any held shape is to
// cleanly providing it, then summed — so progress on the 2nd/3rd/4th quadrant counts
// even while it is still being cut, leaving no plateau for the frontier to flood.
// Per held shape, against one target orientation, we compute:
//   • slotCost: for each target (layer,quadrant) the shape can fill with the right
//     part, the rough ops to ISOLATE that part, plus 1 when the shape must be rotated
//     first. A cut removes one whole side across every layer, so the price comes
//     from where the conflicts (filled slots that do not match the target) sit: 1
//     when they fill a cut side no matched part is on, 2 when a rotation has to line
//     that side up first, else 3.
//   • cleanSlots: target slots covered when the shape is a fully clean sub-shape
//     (no conflicts) — a piece that can be stacked straight in. [] otherwise.
// Colour is ignored: a wrong colour is one cheap Painter op, whereas STRUCTURE is
// what the search cannot assemble.
//
// Four choices that look loosenable but are not (ideas #6540, #6549):
//   • An orientation-insensitive goal is scored against each rotation of the target
//     separately and the cheapest taken. Letting every held shape pick its own best
//     rotation called Cu------ + Ru------ "all parts present" for CuRuCuRu whatever
//     their relative rotation, which no stack can assemble.
//   • A rotated piece costs 1 more rather than nothing: a Rotator step is a real op
//     the search must spend, and the state key keeps rotations distinct.
//   • A shape is matched at every layer OFFSET it fits under the target's height: a
//     Stacker puts it there, and that stack is counted by the merge term. Matching
//     layer 0 only gave a ground-level RuRu---- no credit for layer 1 of
//     CuCu----:RuRu----, so pushing a pin under it looked like progress and Pin
//     Pusher flooded the frontier. For the same reason the missing-layer term counts
//     only shapes that supply some target part.
//   • Isolation is summed per target slot, even though one cut can serve several.
//     Charging each shape once flattened h on multi-layer targets: CuRuCuRu:RuCuRuCu
//     went from 7 ops in 299 states to no result in 60 s.
import { NOTHING_CHAR } from './shapeClass.js';
import { getAllRotations } from './shapeRotation.js';
import { getCachedShape } from './shapeSolverCache.js';
import { rightHalfSize } from './shapeHalfGeometry.js';

const CUT_COST = 1;
const ROTATE_AND_CUT_COST = 2;
const MAX_ISOLATE_COST = 3;
const ROTATE_COST = 1;
const FABRICATE_COST = 4;  // no held shape has this part at all

function targetSlotKeys(target) {
    const keys = [];
    for (let l = 0; l < target.numLayers; l++) {
        for (let q = 0; q < target.layers[l].length; q++) {
            if (target.layers[l][q].shape !== NOTHING_CHAR) keys.push(l + ':' + q);
        }
    }
    return keys;
}

// True when one side of the cut (turned `turn` parts from the Cutter's axis) holds
// every conflict and no matched part, so that cut leaves the matched parts clean.
function cutSeparates(conflictQuads, matchedQuads, numParts, turn) {
    const onRight = (q) => (q + turn) % numParts < rightHalfSize(numParts);
    for (const conflictsOnRight of [true, false]) {
        const onConflictSide = (q) => onRight(q) === conflictsOnRight;
        if ([...conflictQuads].every(onConflictSide) && ![...matchedQuads].some(onConflictSide)) return true;
    }
    return false;
}

function isolateCost(conflictQuads, matchedQuads, numParts) {
    if (conflictQuads.size === 0) return 0;
    if (cutSeparates(conflictQuads, matchedQuads, numParts, 0)) return CUT_COST;
    if (cutSeparates(conflictQuads, matchedQuads, numParts, 1)) return ROTATE_AND_CUT_COST;
    return MAX_ISOLATE_COST;
}

function matchAndCoverage(code, target, config) {
    let bestClean = [];
    const slotCost = new Map();  // "l:q" -> min supply cost this shape offers
    for (const rotCode of getAllRotations(getCachedShape(code), config)) {
        const r = getCachedShape(rotCode);
        const rotateCost = rotCode === code ? 0 : ROTATE_COST;
        const maxOffset = Math.max(0, target.numLayers - r.numLayers);
        for (let offset = 0; offset <= maxOffset; offset++) {
            let numParts = 0;
            const matched = [];
            const matchedQuads = new Set();
            const conflictQuads = new Set();
            for (let l = 0; l < r.numLayers; l++) {
                const rl = r.layers[l], tl = target.layers[l + offset];
                const len = Math.max(rl ? rl.length : 0, tl ? tl.length : 0);
                for (let q = 0; q < len; q++) {
                    numParts = Math.max(numParts, len);
                    const rp = rl && rl[q], tp = tl && tl[q];
                    if (!rp || rp.shape === NOTHING_CHAR) continue;
                    if (tp && tp.shape === rp.shape) {
                        matched.push((l + offset) + ':' + q);
                        matchedQuads.add(q);
                    } else {
                        conflictQuads.add(q);
                    }
                }
            }
            const cost = isolateCost(conflictQuads, matchedQuads, numParts) + rotateCost;
            for (const key of matched) {
                const prev = slotCost.get(key);
                if (prev === undefined || cost < prev) slotCost.set(key, cost);
            }
            if (conflictQuads.size === 0 && matched.length > bestClean.length) bestClean = matched;
        }
    }
    return { cleanSlots: bestClean, slotCost };
}

// How many of the held clean pieces an assembly needs: a greedy cover of the slots
// they cover, largest piece first. Counting every clean piece held made a spare
// copy cost a merge, so stacking two spares into a useless shape read as progress.
function neededPieces(cleanSlotSets) {
    const sorted = [...cleanSlotSets].sort((a, b) => b.length - a.length);
    const covered = new Set();
    let pieces = 0;
    for (const slots of sorted) {
        if (slots.every((key) => covered.has(key))) continue;
        for (const key of slots) covered.add(key);
        pieces++;
    }
    return pieces;
}

// Estimated ops remaining for one target orientation, in real op-units: for each
// target slot, the cheapest way any held shape can supply it; plus the stacks still
// needed — to merge each clean piece beyond the first, or to add each missing layer.
function orientationCost(codes, variant) {
    const slotMin = new Map();
    const cleanSlotSets = [];
    let maxLayerCount = 0;
    for (const code of codes) {
        const m = variant.match(code);
        if (m.slotCost.size > 0) {
            const layers = getCachedShape(code).numLayers;
            if (layers > maxLayerCount) maxLayerCount = layers;
        }
        if (m.cleanSlots.length > 0) cleanSlotSets.push(m.cleanSlots);
        for (const [key, cost] of m.slotCost) {
            const prev = slotMin.get(key);
            if (prev === undefined || cost < prev) slotMin.set(key, cost);
        }
    }
    // One Stacker both merges two pieces and adds a layer, so the larger of the two
    // counts bounds the stacks; their sum double-counted CuCu---- + RuRu---- as 2.
    let h = Math.max(neededPieces(cleanSlotSets) - 1, variant.target.numLayers - maxLayerCount, 0);
    for (const key of variant.slotKeys) {
        const c = slotMin.get(key);
        h += c === undefined ? FABRICATE_COST : c;
    }
    return h;
}

// Returns heuristic(codes) for an array of held shape codes. heuristicDivisor
// weights the estimate (weighted A*, W = 1/divisor; default 0.1 → 10×) so h
// dominates g and the search descends the gradient greedily — essential at this
// branching factor, where a near-admissible h explores far too broadly.
// heuristic.unweighted(codes) is the same estimate before weighting, for bounding
// against a found path (IDA*'s branch and bound) rather than for ordering.
export function createCoverageHeuristic({ target, config, orientationSensitive, preventWaste, heuristicDivisor }) {
    const variantCodes = orientationSensitive
        ? [target.toShapeCode()]
        : Array.from(getAllRotations(target, config));
    const variants = variantCodes.map((variantCode) => {
        const variantTarget = getCachedShape(variantCode);
        const cache = new Map();
        return {
            target: variantTarget,
            slotKeys: targetSlotKeys(variantTarget),
            match(code) {
                let m = cache.get(code);
                if (m === undefined) {
                    m = matchAndCoverage(code, variantTarget, config);
                    cache.set(code, m);
                }
                return m;
            },
        };
    });

    function unweighted(codes) {
        if (codes.length === 0) return Infinity;
        let h = Infinity;
        for (const variant of variants) h = Math.min(h, orientationCost(codes, variant));
        if (preventWaste && codes.length > 1) {
            h += codes.length - 1;  // At least 1 op per extra to incorporate/trash
        }
        return h;
    }
    const heuristic = (codes) => Math.ceil(unweighted(codes) / heuristicDivisor);
    heuristic.unweighted = unweighted;
    return heuristic;
}
