// Constants
export const NOTHING_CHAR = "-";
export const SHAPE_LAYER_SEPARATOR = ":";
export const PIN_CHAR = "P";
export const CRYSTAL_CHAR = "c";
export const REFINED_X_CHAR = "X";
export const REFINED_Y_CHAR = "Y";

// Refined (X/Y) shapes from 1.0 do not recolor via the Painter operation
// (their colors come from Trade Stations). Treat them as unpaintable for recoloring logic.
export const UNPAINTABLE_SHAPES = [
    CRYSTAL_CHAR,
    PIN_CHAR,
    NOTHING_CHAR,
    REFINED_X_CHAR,
    REFINED_Y_CHAR
];
export const REPLACED_BY_CRYSTAL = [PIN_CHAR, NOTHING_CHAR];

// Shape Classes
export class ShapePart {
    constructor(shape, color) {
        this.shape = shape;
        this.color = color;
    }
}

export class Shape {
    constructor(layers) {
        this.layers = layers;
        this.numLayers = layers.length;
        this.numParts = layers[0].length;
    }

    static fromListOfLayers(layers) {
        const newLayers = [];
        const numParts = layers[0].length / 2;
        for (const layer of layers) {
            const newLayer = [];
            for (let partIndex = 0; partIndex < numParts; partIndex++) {
                newLayer.push(new ShapePart(
                    layer[partIndex * 2],
                    layer[partIndex * 2 + 1]
                ));
            }
            newLayers.push(newLayer);
        }
        return new Shape(newLayers);
    }

    static fromShapeCode(shapeCode) {
        return this.fromListOfLayers(shapeCode.split(SHAPE_LAYER_SEPARATOR));
    }

    toListOfLayers() {
        return this.layers.map(layer =>
            layer.map(part => part.shape + part.color).join('')
        );
    }

    toShapeCode() {
        return this.toListOfLayers().join(SHAPE_LAYER_SEPARATOR);
    }

    isEmpty() {
        for (const layer of this.layers) {
            for (const part of layer) {
                if (part.shape !== NOTHING_CHAR || part.color !== NOTHING_CHAR) {
                    return false;
                }
            }
        }
        return true;
    }
}

export class InvalidOperationInputs extends Error {}

export class ShapeOperationConfig {
    constructor(maxShapeLayers = 4) {
        this.maxShapeLayers = maxShapeLayers;
    }
}
