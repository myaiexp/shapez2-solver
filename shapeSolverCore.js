import { ShapeOperationConfig } from './shapeClass.js';
import { getCrystalColors } from './shapeColorAnalysis.js';
import { PriorityQueue } from './shapeSolverPriorityQueue.js';
import {
    shapeCache,
    operationResultCache,
    getCachedShape,
} from './shapeSolverCache.js';
import { buildBackwardReachability } from './shapeSolverBackward.js';
import { operations } from './shapeSolverOperations.js';
import { expandUnaryOp, expandBinaryOp, expandBeltSplit } from './shapeSolverExpansion.js';
import { acceptableCodes, rebindChainInputs } from './pathInventory.js';
import { createCoverageHeuristic } from './shapeSolverHeuristic.js';
import { createPulse } from './shapeSolverProgress.js';

// Backward BFS depth for Bidirectional search: how many reverse operations to
// precompute outward from the target before the forward A* runs. 4 trades map
// coverage against build cost (the reverse frontier branches fast); it is fixed
// rather than user-tunable and intentionally independent of maxLayers.
const BIDIRECTIONAL_BACKWARD_DEPTH = 4;

// IDA*'s weighted threshold returns a first goal far longer than needed (68 ops
// for a 1-op Swapper target), so the pass keeps searching for a shorter one.
// Cancel discards the path and the browser's maxStates ceiling sits far past
// where this search stops improving, so it ends on its own: it stops once the
// distinct-state count passes
// IDA_STALL_FACTOR × the count at the last improvement (at least
// IDA_STALL_FLOOR). Measured improvement gaps were under 3× bar one 3.15× on
// CuRuSuWu; the floor covers small searches, where Cu------ goes from 19 ops at
// 67 states to 18 at 704. A budget tied to the first goal's cost instead cut the
// two-start CuRuCuRu search off at 41 ops; it exhausts by itself at 8.
const IDA_STALL_FACTOR = 3;
const IDA_STALL_FLOOR = 5000;

// ---------------------------------------------------------------------------
// Main solver
// ---------------------------------------------------------------------------

// All tuning knobs are a single named options object (the last three positional
// args are the genuinely-positional "what to solve"). This keeps call sites from
// re-spelling a long boolean/numeric sequence by hand — in particular it makes the
// two caps (maxStatesPerLevel = BFS beam width, maxStates = global state ceiling)
// impossible to swap silently. A third budget — Constructive's per-node A*
// nodeBudget — lives only on solveConstructive and must never be aliased to
// either of these. Every knob has a default here so callers pass only what
// differs from the app's typical non-orientation-sensitive, no-prevent-waste
// A* solve.
export async function shapeSolver(
    targetShapeCode,
    startingShapeCodes,
    enabledOperations,
    {
        maxLayers = 4,
        maxStatesPerLevel = Infinity,
        preventWaste = false,
        orientationSensitive = false,
        monolayerPainting = false,
        heuristicDivisor = 0.1,
        searchMethod = 'A*',
        shouldCancel = () => false,
        onProgress = () => {},
        // Ceiling on distinct states discovered. Default Infinity (uncapped), so every
        // host picks its own: the browser sends DEFAULT_SOLVE_MAX_STATES and the node
        // harness defaults to 100k. On the cap the search aborts gracefully and returns
        // { ..., aborted: 'maxStates' } instead of running the process out of memory.
        maxStates = Infinity,
    } = {}
) {
    // Clear caches between solves to prevent unbounded memory growth
    shapeCache.clear();
    operationResultCache.clear();

    const target = getCachedShape(targetShapeCode);
    const targetCrystalColors = getCrystalColors(target);
    const config = new ShapeOperationConfig(maxLayers);

    // Precompute acceptable shape codes (exact match vs every rotation).
    // Pass the cached target so we don't re-parse; isGoal is a thin has/every
    // over this set (same predicates as pathReachesTarget / pathInventoryAcceptable).
    const acceptable = acceptableCodes(targetShapeCode, { orientationSensitive, config, shape: target });

    // Initialize shapes with unique IDs. This maps id -> shape CODE (a string);
    // getCachedShape is the only path from a code to a Shape instance, so the
    // registry itself never holds parsed objects.
    let nextId = 0;
    const shapeCodesById = new Map();
    const initialAvailableIds = new Set();
    for (const code of startingShapeCodes) {
        shapeCodesById.set(nextId, code);
        initialAvailableIds.add(nextId);
        nextId++;
    }

    const coverageHeuristic = createCoverageHeuristic({
        target, config, orientationSensitive, preventWaste, heuristicDivisor,
    });
    function heldCodes(availableIds) {
        const codes = [];
        for (const id of availableIds) codes.push(shapeCodesById.get(id));
        return codes;
    }
    function getHeuristic(availableIds) {
        return coverageHeuristic(heldCodes(availableIds));
    }

    // State score for BFS beam pruning: higher is kept. Uses the same coverage signal
    // as the A* heuristic (negated), so both methods favour states that hold clean
    // partial sub-shapes of the target over superficially-similar dead ends.
    function calculateStateScore(availableIds) {
        return -getHeuristic(availableIds);
    }

    // Build a state key (multiset of exact codes) from raw codes — the visited
    // check is order-independent, so two states with the same shapes match.
    // Codes are NOT folded to a canonical rotation, even when orientation-
    // insensitive: Cutter, Half Destroyer and Swapper act on a fixed axis and
    // Stacker on the inputs' relative rotation, so a rotated shape can build
    // different things. Folding rotations made every Rotator step a revisit of
    // its parent state, which left Cu------ unreachable from CuCuCuCu (idea
    // #6540). Orientation-insensitivity belongs to the goal check (`acceptable`).
    function stateKeyFromCodes(codes) {
        const countMap = {};
        for (const code of codes) {
            countMap[code] = (countMap[code] || 0) + 1;
        }
        // Sorted "code:count" multiset, joined with '|'. Shape codes contain no
        // digits, so the trailing :<count> is always unambiguous, and '|' never
        // appears in a code — so this is an injective key, without JSON overhead.
        return Object.entries(countMap)
            .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([code, count]) => code + ':' + count)
            .join('|');
    }

    function getStateKey(availableIds) {
        const codes = [];
        for (const id of availableIds) codes.push(shapeCodesById.get(id));
        return stateKeyFromCodes(codes);
    }

    // Resulting state key for a successor descriptor, computed from codes alone —
    // no shape ids minted, so successors the search rejects stay cheap (this is
    // what keeps shapeCodesById from growing with every edge ever generated).
    function successorStateKey(parentAvailableIds, desc) {
        const codes = [];
        for (const id of parentAvailableIds) {
            if (desc.inputIds.includes(id)) continue;
            codes.push(shapeCodesById.get(id));
        }
        for (const code of desc.outputCodes) codes.push(code);
        return stateKeyFromCodes(codes);
    }

    // Materialize an accepted successor: mint ids for its outputs and build the
    // real available-set + step (with concrete input/output ids the graph needs).
    function applySuccessor(parentAvailableIds, desc) {
        const newAvailableIds = new Set(parentAvailableIds);
        for (const id of desc.inputIds) newAvailableIds.delete(id);
        const outputIds = [];
        for (const code of desc.outputCodes) {
            const newId = nextId++;
            shapeCodesById.set(newId, code);
            outputIds.push(newId);
            newAvailableIds.add(newId);
        }
        return {
            availableIds: newAvailableIds,
            step: { type: desc.type, inputIds: desc.inputIds, outputIds, color: desc.color }
        };
    }

    function isGoal(availableIds) {
        const shapeCodes = Array.from(availableIds).map(id => shapeCodesById.get(id));
        const hasTarget = shapeCodes.some(code => acceptable.has(code));
        const allTarget = preventWaste ? shapeCodes.every(code => acceptable.has(code)) : true;
        return hasTarget && allTarget;
    }

    // Generate all successor descriptors from a given state.
    // A descriptor is lightweight — { type, inputIds, outputCodes, color } — and
    // deliberately does NOT mint shape ids or build the new available-set. That is
    // deferred to applySuccessor() and only done for successors the caller actually
    // accepts, so rejected successors never grow shapeCodesById (the old
    // unbounded-growth bug minted ids for every edge, kept or not).
    // Includes operation pruning and the operation-result cache.
    const expansionColorContext = {
        target,
        targetCrystalColors,
        getShape: getCachedShape,
    };
    const expansionPruning = {
        monolayerPainting,
    };

    function* generateSuccessors(availableIds) {
        const referenceCodes = Array.from(availableIds).map(id => shapeCodesById.get(id));
        const heldCounts = new Map();
        for (const code of referenceCodes) heldCounts.set(code, (heldCounts.get(code) || 0) + 1);
        // Two ids holding one code split into the same successor state.
        const splitCodes = new Set();

        for (const opName of enabledOperations) {
            if (shouldCancel()) return;
            const op = operations[opName];
            if (!op) continue;
            const { inputCount, needsColor } = op;

            if (inputCount === 1) {
                for (const id of availableIds) {
                    if (shouldCancel()) return;
                    const inputCode = shapeCodesById.get(id);

                    if (opName === 'Trash') {
                        if (preventWaste && !acceptable.has(inputCode)) {
                            yield { type: opName, inputIds: [id], outputCodes: [], color: null };
                        }
                        continue;
                    }

                    if (opName === 'Belt Split') {
                        if (splitCodes.has(inputCode)) continue;
                        splitCodes.add(inputCode);
                        const desc = expandBeltSplit(id, inputCode, heldCounts.get(inputCode), maxLayers);
                        if (desc) yield desc;
                        continue;
                    }

                    const inputShape = getCachedShape(inputCode);
                    for (const desc of expandUnaryOp(opName, op, id, inputCode, inputShape, config, {
                        needsColor,
                        pruning: expansionPruning,
                        colorContext: { ...expansionColorContext, referenceCodes },
                        useCache: true,
                    })) {
                        yield desc;
                    }
                }
            } else if (inputCount === 2) {
                const ids = Array.from(availableIds);
                for (let i = 0; i < ids.length && !shouldCancel(); i++) {
                    for (let j = 0; j < ids.length && !shouldCancel(); j++) {
                        if (i === j) continue;
                        const id1 = ids[i];
                        const id2 = ids[j];
                        const inputCode1 = shapeCodesById.get(id1);
                        const inputCode2 = shapeCodesById.get(id2);
                        const desc = expandBinaryOp(
                            opName, op, id1, id2,
                            inputCode1, inputCode2,
                            getCachedShape(inputCode1), getCachedShape(inputCode2),
                            config, { useCache: true }
                        );
                        if (desc) yield desc;
                    }
                }
            }
        }
    }

    // Map an internal step record to a public solution-path entry. Shared by
    // reconstructPath (A*/Bidirectional/BFS, which walk a cameFrom chain) and the
    // IDA* goal case (which materializes pathStack at the goal).
    function formatStep(step) {
        return {
            operation: step.type,
            inputs: step.inputIds.map(id => ({id, shape: shapeCodesById.get(id)})),
            outputs: step.outputIds.map(id => ({id, shape: shapeCodesById.get(id)})),
            params: step.color ? {color: step.color} : {}
        };
    }

    function reconstructPath(cameFrom, goalKey, initialKey) {
        const steps = [];
        for (let key = goalKey; key !== initialKey; key = cameFrom.get(key).parentKey) {
            steps.push(cameFrom.get(key).step);
        }
        steps.reverse();
        return rebindChainInputs(steps, initialAvailableIds, id => shapeCodesById.get(id)).map(formatStep);
    }

    // The two result shapes every search returns. depth is the path's length, and
    // cancel wins over any no-path outcome, including a cap abort: a cancelled
    // search resolves to null.
    function solved(solutionPath, statesExplored) {
        return { solutionPath, depth: solutionPath.length, statesExplored };
    }
    function noSolution(statesExplored, aborted = null) {
        return shouldCancel() ? null : { solutionPath: null, depth: null, statesExplored, aborted };
    }

    // Shared best-first (A*/Bidirectional) search loop. A* and Bidirectional were
    // line-for-line identical apart from the heuristic function and the progress
    // label/suffix, so both call this with their own heuristicFn. `progressSuffix`
    // is appended to the per-iteration status line; `abortHint` to the cap message.
    async function runBestFirst(heuristicFn, label, progressSuffix, abortHint) {
        const open = new PriorityQueue();
        const costSoFar = new Map();
        const cameFrom = new Map();

        const initialKey = getStateKey(initialAvailableIds);
        costSoFar.set(initialKey, 0);
        open.enqueue({availableIds: new Set(initialAvailableIds), stateKey: initialKey}, 0 + heuristicFn(initialAvailableIds));

        // nodesExpanded is work done (dequeues); statesExplored is the public
        // result field and matches BFS/IDA*/maxStates: distinct state keys in
        // costSoFar (not expansions — one state can be re-opened cheaper).
        let nodesExpanded = 0;
        let aborted = null;  // 'maxStates' once the cap is hit
        const pulse = createPulse(onProgress, { everyN: 500 });

        while (open.size() > 0 && !shouldCancel()) {
            if (costSoFar.size > maxStates) { aborted = 'maxStates'; break; }
            const currentItem = open.dequeue();
            if (!currentItem) break;
            nodesExpanded++;

            const {availableIds, stateKey} = currentItem.val;
            const g = costSoFar.get(stateKey);

            if (isGoal(availableIds)) {
                return solved(reconstructPath(cameFrom, stateKey, initialKey), costSoFar.size);
            }

            for (const desc of generateSuccessors(availableIds)) {
                const newKey = successorStateKey(availableIds, desc);
                const newG = g + 1;
                // A re-open mints new ids, leaving the old copy's children with
                // steps that name the old ones until this copy re-expands. The
                // lower g pops it first, and reconstructPath rebinds ids regardless.
                if (!costSoFar.has(newKey) || newG < costSoFar.get(newKey)) {
                    costSoFar.set(newKey, newG);
                    const { availableIds: succIds, step } = applySuccessor(availableIds, desc);
                    const h = heuristicFn(succIds);
                    open.enqueue({availableIds: succIds, stateKey: newKey}, newG + h);
                    cameFrom.set(newKey, { parentKey: stateKey, step });
                }
            }

            if (pulse.due(nodesExpanded)) {
                await pulse.emit(`${label} | g=${g} | Open:${open.size()} | Explored:${nodesExpanded} | Total visited:${costSoFar.size}${progressSuffix}`);
            }
        }

        if (aborted) onProgress(`${label} | Aborted: hit ${maxStates}-state cap before solving${abortHint}`);
        return noSolution(costSoFar.size, aborted);
    }

    // -----------------------------------------------------------------------
    // IDA* Search
    // -----------------------------------------------------------------------
    // maxStates is the same contract as A*/BFS/Bidirectional: a ceiling on
    // *distinct* state keys discovered (not cumulative node expansions). IDA*
    // re-visits states across threshold passes, so expansions alone are not a
    // memory bound and used to make the cap silently mean something else here.
    // distinctStates tracks unique keys for the whole run; nodesExpanded is only
    // for progress ("work done this pass / total").
    //
    // The distinct-key cap only bounds memory if work is bounded by distinct keys
    // too. Plain IDA* (on-path cycle detection only) re-expands every transposition,
    // so on a small reachable space each pass is an exponential DFS that never
    // reaches the cap. Two things keep it bounded:
    //   • bestG, a per-pass transposition table (state key -> lowest g pushed this
    //     pass): a successor reached again at g >= its best is skipped, because its
    //     subtree was already searched with at least as much threshold budget and a
    //     bound no tighter than the current one, so it holds no goal the current
    //     bound would keep.
    //   • popped frames delete their output ids from shapeCodesById, so the id
    //     registry holds only the current stack's shapes, not every push ever made.
    async function runIdaStar() {
        const run = {
            distinctStates: new Set(),
            nodesExpanded: 0,      // cumulative across threshold passes
            pulse: createPulse(onProgress, { everyN: 1000 }),
        };
        let threshold = getHeuristic(initialAvailableIds);

        for (let passCount = 1; !shouldCancel(); passCount++) {
            const { solutionPath, nextThreshold, aborted } = await runIdaPass(threshold, passCount, run);
            // Distinct keys (same unit as BFS visited.size / the maxStates cap), not
            // cumulative expansions across passes.
            const statesExplored = run.distinctStates.size;

            // Cancel wins over a found path, matching the other methods. A path
            // found before the cap is returned: hitting maxStates only ends the
            // search for a shorter one.
            if (solutionPath && !shouldCancel()) return solved(solutionPath, statesExplored);

            if (aborted) {
                onProgress(`IDA* | Aborted: hit ${maxStates}-state cap before solving`);
                return noSolution(statesExplored, 'maxStates');
            }

            if (nextThreshold === Infinity || shouldCancel()) return noSolution(statesExplored);

            onProgress(`IDA* | Increasing threshold: ${threshold} → ${nextThreshold} | Distinct:${statesExplored} | Expanded:${run.nodesExpanded}`);
            threshold = nextThreshold;
        }

        return noSolution(run.distinctStates.size);
    }

    // One threshold-bounded DFS over an explicit stack. Returns the shortest path it
    // found (or null), the lowest f it cut off (the next threshold, Infinity when
    // nothing was cut) and whether it stopped at maxStates. `run` holds what outlives
    // a pass: distinctStates, nodesExpanded and the progress pulse.
    //
    // pathStack holds the step record of every non-root frame on the stack (root →
    // top), pushed and popped with its frame; the public solution path is built from
    // it only at the goal. bestG also does the cycle detection: while a frame is on
    // the stack every new push is one of its descendants, at a strictly higher g
    // than the frame's own bestG entry, so an on-path key is never re-pushed.
    async function runIdaPass(threshold, passCount, run) {
        const { distinctStates, pulse } = run;
        const initialKey = getStateKey(initialAvailableIds);
        distinctStates.add(initialKey);
        const bestG = new Map([[initialKey, 0]]);
        const pathStack = [];
        const stack = [{
            availableIds: new Set(initialAvailableIds),
            g: 0,
            successorIterator: null
        }];
        // Pop the top frame; a non-root frame also drops its step and reclaims the
        // ids it minted (no frame still on the stack can reference them).
        const popFrame = () => {
            const popped = stack.pop();
            if (popped.g === 0) return;
            for (const id of pathStack.pop().outputIds) shapeCodesById.delete(id);
        };

        let nodesThisPass = 0;
        let nextThreshold = Infinity;
        // Shortest goal path found this pass. The weighted threshold sits far
        // above the true depth, so the first goal DFS reaches is often several
        // times too long; after one is found the pass keeps going (branch and
        // bound against its length) until it exhausts or stalls (stallLimit).
        let solutionPath = null;
        let stallLimit = Infinity;

        // A frame's first visit: its f, goal and bound checks. Attaches the frame's
        // successor iterator and returns true when it should expand, false when one
        // of those checks settles it and it should pop.
        function enterFrame(frame) {
            nodesThisPass++;
            run.nodesExpanded++;

            const f = frame.g + getHeuristic(frame.availableIds);
            if (f > threshold) {
                nextThreshold = Math.min(nextThreshold, f);
                return false;
            }

            // A frame only exists at g < the best length so far (see the
            // push bound below), so any goal here is a strict improvement.
            if (isGoal(frame.availableIds)) {
                stallLimit = IDA_STALL_FACTOR * Math.max(distinctStates.size, IDA_STALL_FLOOR);
                solutionPath = pathStack.map(formatStep);
                onProgress(`IDA* | Pass:${passCount} | Found ${solutionPath.length}-op path, searching for shorter | Distinct:${distinctStates.size}`);
                return false;
            }

            // Bound by the UNWEIGHTED estimate (anytime weighted search):
            // the weighted f orders the descent, but a frame that cannot
            // plausibly beat the best path is not worth expanding. g alone
            // tightens the bound one op per goal and runs to the state cap.
            if (solutionPath && frame.g + coverageHeuristic.unweighted(heldCodes(frame.availableIds)) >= solutionPath.length) {
                return false;
            }

            frame.successorIterator = generateSuccessors(frame.availableIds);
            return true;
        }

        while (stack.length > 0 && !shouldCancel()) {
            // Same top-of-loop check as A* (costSoFar.size) / BFS (visited.size).
            if (distinctStates.size > maxStates) return { solutionPath, nextThreshold, aborted: true };
            if (distinctStates.size > stallLimit) break;

            const frame = stack[stack.length - 1];

            // The iterator's presence is what distinguishes a frame being resumed
            // from one being visited for the first time.
            if (!frame.successorIterator && !enterFrame(frame)) {
                popFrame();
                continue;
            }

            // Branch and bound: every successor sits at g + 1, so once that
            // reaches the best goal length this frame can only lead to goals
            // at least as long — drop it without generating the rest.
            const succG = frame.g + 1;
            if (solutionPath && succG >= solutionPath.length) {
                popFrame();
                continue;
            }

            const next = frame.successorIterator.next();
            if (next.done) {
                popFrame();
                continue;
            }

            const desc = next.value;
            const succKey = successorStateKey(frame.availableIds, desc);

            // Transposition + cycle check: skip unless this pass has not yet
            // reached the key at this g or lower.
            const seenG = bestG.get(succKey);
            if (seenG !== undefined && seenG <= succG) continue;
            bestG.set(succKey, succG);

            const { availableIds: succIds, step } = applySuccessor(frame.availableIds, desc);
            pathStack.push(step);
            distinctStates.add(succKey);

            stack.push({
                availableIds: succIds,
                g: succG,
                successorIterator: null
            });

            // Status update — report distinct visited (the cap metric) alongside
            // expansion counts so progress matches A*/BFS wording.
            if (pulse.due(run.nodesExpanded)) {
                await pulse.emit(`IDA* | Pass:${passCount} | Threshold:${threshold} | Nodes:${nodesThisPass} | Stack:${stack.length} | Distinct:${distinctStates.size} | Expanded:${run.nodesExpanded}`);
            }
        }

        return { solutionPath, nextThreshold, aborted: false };
    }

    // -----------------------------------------------------------------------
    // Bidirectional Search
    // -----------------------------------------------------------------------
    async function runBidirectional() {
        // Phase 1: Build backward reachability map
        onProgress('Bidirectional | Building backward reachability map...');
        const backwardDepth = BIDIRECTIONAL_BACKWARD_DEPTH;
        const backwardMap = buildBackwardReachability(targetShapeCode, config, enabledOperations, backwardDepth, shouldCancel);
        if (shouldCancel()) return null;

        onProgress(`Bidirectional | Backward map: ${backwardMap.size} reachable shapes (depth ${backwardDepth})`);

        // Phase 2: Forward A* with enhanced heuristic
        function getHeuristicBidirectional(availableIds) {
            if (availableIds.size === 0) return Infinity;

            let bestBackwardDist = Infinity;
            for (const id of availableIds) {
                const code = shapeCodesById.get(id);
                if (backwardMap.has(code)) {
                    bestBackwardDist = Math.min(bestBackwardDist, backwardMap.get(code));
                }
            }

            if (bestBackwardDist < Infinity) {
                // Use backward distance as heuristic (exact for shapes in the map)
                let h = bestBackwardDist;
                if (preventWaste && availableIds.size > 1) {
                    h += (availableIds.size - 1);
                }
                return h;
            }

            // Fallback to standard heuristic
            return getHeuristic(availableIds);
        }

        return await runBestFirst(
            getHeuristicBidirectional,
            'Bidirectional',
            ` | Backward map:${backwardMap.size}`,
            ''
        );
    }

    // -----------------------------------------------------------------------
    // BFS (original)
    // -----------------------------------------------------------------------
    async function runBfs() {
        const initialKey = getStateKey(initialAvailableIds);
        const visited = new Set();
        visited.add(initialKey);
        // cameFrom maps each discovered state key to its parent key + the step that
        // produced it, so the solution path is reconstructed once at the goal (same
        // pattern as A*/Bidirectional) instead of copying a full path array onto every
        // accepted successor. Pruned states leave harmless unused entries — only the
        // goal's ancestor chain (all survivors) is ever walked.
        const cameFrom = new Map();
        // Beam pruning: when a depth level exceeds the cap, keep only the
        // highest-scoring states (calculateStateScore favours clean partial pieces).
        function pruneStatesAtDepth(states, beamWidth) {
            if (states.length <= beamWidth) {
                return states;
            }
            states.sort((a, b) => b.score - a.score);
            return states.slice(0, beamWidth);
        }
        // Expands every state of one depth level. Returns { result } when a state
        // is the goal, { aborted: true } when the maxStates cap is hit mid-level,
        // otherwise { nextStates } — the unpruned next level (partial on cancel;
        // the caller's loop condition then stops the search).
        function expandBfsLevel(frontier) {
            const nextStates = [];
            for (const { availableIds, stateKey: currentKey } of frontier) {
                if (shouldCancel()) break;
                if (isGoal(availableIds)) {
                    return { result: solved(reconstructPath(cameFrom, currentKey, initialKey), visited.size) };
                }
                for (const desc of generateSuccessors(availableIds)) {
                    if (shouldCancel()) break;
                    // Cap mid-level too: checking only at depth boundaries lets one
                    // frontier flood well past maxStates before aborting.
                    if (visited.size > maxStates) return { aborted: true };
                    const stateKey = successorStateKey(availableIds, desc);
                    if (!visited.has(stateKey)) {
                        visited.add(stateKey);
                        const { availableIds: succIds, step } = applySuccessor(availableIds, desc);
                        cameFrom.set(stateKey, { parentKey: currentKey, step });
                        nextStates.push({ availableIds: succIds, stateKey, score: calculateStateScore(succIds) });
                    }
                }
            }
            return { nextStates };
        }
        let frontier = [{ availableIds: initialAvailableIds, stateKey: initialKey, score: calculateStateScore(initialAvailableIds) }];
        let aborted = null;  // 'maxStates' once the cap is hit
        const pulse = createPulse(onProgress);
        for (let depth = 0; frontier.length > 0 && !shouldCancel(); depth++) {
            if (visited.size > maxStates) { aborted = 'maxStates'; break; }
            const level = expandBfsLevel(frontier);
            if (level.result) return level.result;
            if (level.aborted) { aborted = 'maxStates'; break; }
            frontier = pruneStatesAtDepth(level.nextStates, maxStatesPerLevel);
            if (pulse.due()) {
                const prunedCount = level.nextStates.length - frontier.length;
                const pruneInfo = prunedCount > 0 ? ` | Pruned ${prunedCount} States` : '';
                await pulse.emit(`BFS | Depth ${depth + 1} → ${frontier.length} States | ${visited.size} Total States${pruneInfo}`);
            }
        }
        if (aborted) onProgress(`BFS | Aborted: hit ${maxStates}-state cap before solving`);
        return noSolution(visited.size, aborted);
    }

    // -----------------------------------------------------------------------
    // Dispatch: explicit search-method -> runner map. Unknown methods throw
    // rather than silently falling through to BFS, so a bad method string
    // surfaces as an error instead of a mis-run search.
    // -----------------------------------------------------------------------
    const searchRunners = {
        'A*': () => runBestFirst(getHeuristic, 'A*', '', ' (try BFS, a larger heuristic divisor, or a simpler target)'),
        'IDA*': runIdaStar,
        'Bidirectional': runBidirectional,
        'BFS': runBfs,
    };
    const runner = searchRunners[searchMethod];
    if (!runner) {
        throw new Error(`shapeSolver: unknown searchMethod "${searchMethod}" (expected one of ${Object.keys(searchRunners).join(', ')})`);
    }
    return await runner();
}