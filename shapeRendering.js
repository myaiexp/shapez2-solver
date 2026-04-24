// Special thanks to https://github.com/Loupau38/loupau38.github.io/blob/main/assets/scripts/shapeViewer.js
import { getCurrentColorMode } from './main.js';
import { renderPart, quadShapesConfig, hexShapesConfig } from './shapeRenderingPart.js';

export { baseColors, colorValues } from './shapeRenderingColors.js';

const BGCircleColor = "rgba(0,0,0,0)";

// according to 'dnSpy > ShapeMeshGenerator > GenerateShapeMesh()', this value should be 0.85
// according to ingame screenshots, it should be 0.77
// according to me, the closest to ingame is 0.8
// but, to me, the best for this context is 0.75
const layerSizeReduction = 0.75;

// sizes in pixels taken from a screenshot of the ingame shape viewer
const defaultImageSize = 602;
const defaultBGCircleDiameter = 520;
const defaultShapeDiameter = 407;

const BGCircleDiameter = defaultBGCircleDiameter / defaultImageSize;
const shapeDiameter = defaultShapeDiameter / defaultImageSize;

function scaleContext(ctx, scale) {
    const translation = (1 - scale) / 2;
    ctx.translate(translation, translation);
    ctx.scale(scale, scale);
}

function rotateContext(ctx, partIndex, numParts) {
    ctx.translate(0, 1);
    ctx.rotate(2 * Math.PI * (partIndex / numParts));
    ctx.translate(0, -1);
}

export function renderShape(context, size, shapeCode, shapesConfig, colorMode) {

    const layers = shapeCode.split(":");
    const numLayers = layers.length;
    const numParts = layers[0].length / 2;
    const shapeParts = [];
    for (let layerIndex = 0; layerIndex < numLayers; layerIndex++) {
        const layer = layers[layerIndex];
        shapeParts.push([]);
        for (let partIndex = 0; partIndex < numParts; partIndex++) {
            shapeParts.at(-1).push([layer[partIndex * 2], layer[(partIndex * 2) + 1]]);
        }
    }

    context.save();

    context.scale(size, size);

    context.clearRect(0, 0, 1, 1);

    context.beginPath();
    context.arc(0.5, 0.5, BGCircleDiameter / 2, 0, 2 * Math.PI);
    context.closePath();
    context.fillStyle = BGCircleColor;
    context.fill();

    scaleContext(context, shapeDiameter);

    for (let layerIndex = 0; layerIndex < numLayers; layerIndex++) {
        const layer = shapeParts[layerIndex];

        context.save();
        const curLayerScale = layerSizeReduction ** layerIndex;
        scaleContext(context, curLayerScale);
        context.scale(0.5, 0.5);
        context.translate(1, 0);
        const partBorders = [];

        for (let partIndex = 0; partIndex < numParts; partIndex++) {
            const [partShape, partColor] = layer[partIndex];

            context.save();
            rotateContext(context, partIndex, numParts);
            const [shapeRenderer, borderRenderer] = renderPart(
                context,
                partShape,
                partColor,
                layerIndex,
                shapesConfig,
                colorMode,
                shapeDiameter * curLayerScale * 0.5
            );
            shapeRenderer();
            partBorders.push(borderRenderer);

            context.restore();

        }

        for (let partIndex = 0; partIndex < partBorders.length; partIndex++) {
            const partBorder = partBorders[partIndex];
            context.save();
            rotateContext(context, partIndex, numParts);
            partBorder();
            context.restore();
        }

        context.restore();

    }

    context.restore();

}

export function createShapeCanvas(shapeCode, size = 100) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const colorMode = getCurrentColorMode();

    // Determine shapesConfig based on shapeCode
    const firstLayer = shapeCode.split(":")[0];
    const numParts = firstLayer.length / 2;
    const shapesConfig = numParts === 6 ? hexShapesConfig : quadShapesConfig;

    renderShape(ctx, size, shapeCode, shapesConfig, colorMode);
    return canvas;
}

export function createShapeElement(shapeCode) {
    const container = document.createElement('div');
    container.className = 'shape-display';

    const canvas = createShapeCanvas(shapeCode, 40);
    canvas.className = 'shape-canvas';

    // Store shape code as data attribute for easy refresh
    canvas.dataset.shapeCode = shapeCode;

    const label = document.createElement('span');
    label.className = 'shape-label';
    label.textContent = shapeCode;

    container.appendChild(canvas);
    container.appendChild(label);

    return container;
}
