import { rotate90CW, rotate90CCW, rotate180 } from './shapeRotation.js';
import {
    halfCut, cut, swapHalves, stack,
    topPaint, pushPin, genCrystal, trash, beltSplit
} from './shapeOperations.js';

export const operations = {
    "Rotator CW": { fn: rotate90CW, inputCount: 1 },
    "Rotator CCW": { fn: rotate90CCW, inputCount: 1 },
    "Rotator 180": { fn: rotate180, inputCount: 1 },
    "Half Destroyer": { fn: halfCut, inputCount: 1 },
    "Cutter": { fn: cut, inputCount: 1 },
    "Swapper": { fn: swapHalves, inputCount: 2 },
    "Stacker": { fn: stack, inputCount: 2 },
    "Painter": { fn: topPaint, inputCount: 1, needsColor: true },
    "Pin Pusher": { fn: pushPin, inputCount: 1 },
    "Crystal Generator": { fn: genCrystal, inputCount: 1, needsColor: true },
    "Trash": { fn: trash, inputCount: 1 },
    "Belt Split": { fn: beltSplit, inputCount: 1 }
};