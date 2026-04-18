// Constants
export const NOTHING_CHAR = "-";
export const SHAPE_LAYER_SEPARATOR = ":";
export const PIN_CHAR = "P";
export const CRYSTAL_CHAR = "c";
export const UNPAINTABLE_SHAPES = [CRYSTAL_CHAR, PIN_CHAR, NOTHING_CHAR];
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
        return this.toListOfLayers().join('').split('').every(c => c === NOTHING_CHAR);
    }
}

export class InvalidOperationInputs extends Error {}

export class ShapeOperationConfig {
    constructor(maxShapeLayers = 4) {
        this.maxShapeLayers = maxShapeLayers;
    }
}
