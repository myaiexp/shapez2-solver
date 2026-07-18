import { shapeSolver } from './shapeSolverCore.js';
import { shapeExplorer } from './shapeExplorerCore.js';
import { solveConstructive } from './shapeSolverConstructive.js';

let cancelled = false;
const shouldCancel = () => cancelled;
const onProgress = (message) => self.postMessage({ type: 'status', message });

self.onmessage = async function (e) {
    const { action, data } = e.data;

    if (action === 'solve') {
        cancelled = false;
        const {
            targetShapeCode,
            startingShapeCodes,
            enabledOperations,
            maxLayers,
            maxStatesPerLevel,
            preventWaste,
            orientationSensitive,
            monolayerPainting,
            heuristicDivisor = 0.1,
            searchMethod = 'A*',
            maxStates
        } = data;
        try {
            // The Constructive planner calls core shapeSolver as a bounded subroutine,
            // so it is dispatched here (not in core) to avoid an import cycle. It reuses
            // the Max States control as its per-node search budget (fail-fast → decompose).
            const result = searchMethod === 'Constructive'
                ? await solveConstructive(
                    targetShapeCode,
                    startingShapeCodes,
                    enabledOperations,
                    {
                        maxLayers,
                        preventWaste,
                        orientationSensitive,
                        monolayerPainting,
                        heuristicDivisor,
                        shouldCancel,
                        onProgress,
                        nodeBudget: maxStatesPerLevel || 4000,
                    }
                )
                : await shapeSolver(
                    targetShapeCode,
                    startingShapeCodes,
                    enabledOperations,
                    {
                        maxLayers,
                        maxStatesPerLevel,
                        preventWaste,
                        orientationSensitive,
                        monolayerPainting,
                        heuristicDivisor,
                        searchMethod,
                        shouldCancel,
                        onProgress,
                        maxStates,
                    }
                );
            if (!cancelled) self.postMessage({ type: 'result', result });
        } catch (err) {
            self.postMessage({ type: 'error', message: `Error: ${err.message}` });
        }
    } else if (action === 'explore') {
        cancelled = false;
        const { startingShapeCodes, enabledOperations, depthLimit, maxLayers, targetShapeCode } = data;
        try {
            const graph = await shapeExplorer(
                startingShapeCodes,
                enabledOperations,
                depthLimit || 999,
                maxLayers || 4,
                shouldCancel,
                onProgress,
                targetShapeCode || null
            );
            if (!cancelled) self.postMessage({ type: 'result', result: graph });
        } catch (err) {
            self.postMessage({ type: 'error', message: `Error: ${err.message}` });
        }
    } else if (action === 'cancel') {
        cancelled = true;
        self.postMessage({ type: 'status', message: 'Cancelled.' });
    }
};
