// Color analysis for solver successor generation: which Painter colors and
// which Crystal Generator colors are worth trying from a given shape. Both
// answers are derived from the TARGET, so the search never expands a paint or
// crystallize op toward a color the target has no use for.
import { CRYSTAL_CHAR, UNPAINTABLE_SHAPES } from './shapeClass.js';

// Colors worth painting inputShape with: for every paintable part of its TOP
// layer (the only layer a Painter touches), the target's colors for that same
// part shape, minus the color the part already has.
export function getPaintColors(inputShape, targetShape) {
    const targetColorMap = new Map();
    for (const layer of targetShape.layers) {
        for (const part of layer) {
            if (!UNPAINTABLE_SHAPES.includes(part.shape) && part.color !== "u") {
                if (!targetColorMap.has(part.shape)) {
                    targetColorMap.set(part.shape, new Set());
                }
                targetColorMap.get(part.shape).add(part.color);
            }
        }
    }

    const validColors = new Set();
    const topLayer = inputShape.layers[inputShape.layers.length - 1];
    if (topLayer) {
        for (const part of topLayer) {
            if (!UNPAINTABLE_SHAPES.includes(part.shape)) {
                const targetColors = targetColorMap.get(part.shape);
                if (targetColors) {
                    targetColors.forEach(color => {
                        if (color !== part.color) {
                            validColors.add(color);
                        }
                    });
                }
            }
        }
    }

    return Array.from(validColors);
}

// Distinct crystal colors present in a shape, or ["u"] when it has none — the
// solver feeds this the target, so a crystal-free target still yields one
// (uncolored) generator color to try rather than an empty option list.
export function getCrystalColors(shape) {
    const crystalColors = new Set();
    for (const layer of shape.layers) {
        for (const part of layer) {
            if (part.shape === CRYSTAL_CHAR) crystalColors.add(part.color);
        }
    }
    return crystalColors.size > 0 ? Array.from(crystalColors) : ["u"];
}
