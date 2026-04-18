import { shapeSolver, shapeExplorer } from './shapeSolverCore.js';

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
            searchMethod = 'A*'
        } = data;
        try {
            const result = await shapeSolver(
                targetShapeCode,
                startingShapeCodes,
                enabledOperations,
                maxLayers,
                maxStatesPerLevel,
                preventWaste,
                orientationSensitive,
                monolayerPainting,
                heuristicDivisor,
                searchMethod,
                shouldCancel,
                onProgress
            );
            if (!cancelled) self.postMessage({ type: 'result', result });
        } catch (err) {
            self.postMessage({ type: 'status', message: `Error: ${err.message}` });
        }
    } else if (action === 'explore') {
        cancelled = false;
        const { startingShapeCodes, enabledOperations, depthLimit, maxLayers } = data;
        try {
            const graph = await shapeExplorer(
                startingShapeCodes,
                enabledOperations,
                depthLimit || 999,
                maxLayers || 4,
                shouldCancel,
                onProgress
            );
            if (!cancelled) self.postMessage({ type: 'result', result: graph });
        } catch (err) {
            self.postMessage({ type: 'status', message: `Error: ${err.message}` });
        }
    } else if (action === 'cancel') {
        cancelled = true;
        self.postMessage({ type: 'status', message: 'Cancelled.' });
    }
};
