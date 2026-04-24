// Shape-part drawing primitive for renderShape — draws a single shape quadrant
// with its color/border and shadow for stacked layers.
import { colorValues } from './shapeRenderingColors.js';

export const quadShapesConfig = "quad";
export const hexShapesConfig = "hex";

const shapeBorderColor = "rgb(35,25,35)";
const shadowColor = "rgba(50,50,50,0.5)";
const pinColor = "rgb(71,69,75)";

// Sizes taken from a screenshot of the ingame shape viewer (units: fraction of default image size)
const defaultImageSize = 602;
const defaultBorderSize = 15;
export const borderSize = defaultBorderSize / defaultImageSize;

const sqrt2 = Math.sqrt(2);
const sqrt3 = Math.sqrt(3);
const sqrt6 = Math.sqrt(6);

function darkenColor(color) {
    color = color.slice(4, -1);
    let [r, g, b] = color.split(",");
    r = Math.round(parseInt(r) / 2);
    g = Math.round(parseInt(g) / 2);
    b = Math.round(parseInt(b) / 2);
    return `rgb(${r},${g},${b})`;
}

function radians(angle) {
    return angle * (Math.PI / 180);
}

function drawPolygon(ctx, points) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.closePath();
}

export function renderPart(ctx, partShape, partColor, layerIndex, shapesConfig, colorMode, borderScale) {

    const drawShadow = layerIndex != 0;
    const color = colorValues[colorMode][partColor];
    const curBorderSize = borderSize / borderScale;

    function standardDraw(drawPath) {
        return [
            (() => {
                drawPath();
                ctx.fillStyle = color;
                ctx.fill();
            }),
            (() => {
                drawPath();
                ctx.strokeStyle = shapeBorderColor;
                ctx.lineWidth = curBorderSize;
                ctx.lineJoin = "round";
                ctx.stroke();
            })
        ];
    }

    if (partShape == "-") {
        return [(() => { }), (() => { })]
    }

    if (partShape == "C") {
        function drawPath() {
            ctx.beginPath();
            ctx.moveTo(0, 1);
            ctx.arc(0, 1, 1, -Math.PI / 2, 0);
            ctx.closePath();
        }
        return standardDraw(drawPath);
    }

    if (partShape == "R") {
        function drawPath() {
            ctx.beginPath();
            ctx.rect(0, 0, 1, 1);
            ctx.closePath();
        }
        return standardDraw(drawPath);
    }

    if (partShape == "S") {
        function drawPath() {
            ctx.beginPath();
            ctx.moveTo(1, 0);
            ctx.lineTo(0.5, 1);
            ctx.lineTo(0, 1);
            ctx.lineTo(0, 0.5);
            ctx.closePath();
        }
        return standardDraw(drawPath);
    }

    if (partShape == "W") {
        const sideLength = 1 / 3.75;
        function drawPath() {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(sideLength, 0);
            ctx.arc(1.4, -0.4, 1.18, Math.PI * 0.89, Math.PI * 0.61, true);
            ctx.lineTo(1, 1);
            ctx.lineTo(0, 1);
            ctx.closePath();
        }
        return standardDraw(drawPath);
    }

    if (partShape == "H") {
        function drawPath() {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(sqrt3 / 2, 0.5);
            ctx.lineTo(0, 1);
            ctx.closePath();
        }
        return standardDraw(drawPath);
    }

    if (partShape == "F") {
        const semicircleRadius = (3 - sqrt3) / 4;
        const triangleSideLength = 2 * semicircleRadius;
        const semicircleCenterX = (triangleSideLength * (sqrt3 / 2)) / 2;
        const semicircleCenterY = (
            1
            - triangleSideLength
            + Math.sqrt((semicircleRadius * semicircleRadius) - (semicircleCenterX * semicircleCenterX))
        );
        const semicircleStartAngle = (7 / 6) * Math.PI;
        const semicircleStopAngle = (1 / 6) * Math.PI;
        function drawPath() {
            ctx.beginPath();
            ctx.moveTo(0, 1);
            ctx.lineTo(0, 1 - triangleSideLength);
            ctx.arc(semicircleCenterX, semicircleCenterY, semicircleRadius, semicircleStartAngle, semicircleStopAngle);
            ctx.closePath();
        }
        return standardDraw(drawPath);
    }

    if (partShape == "G") {
        function drawPath() {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(sqrt3 / 6, 0.5);
            ctx.lineTo(sqrt3 / 2, 0.5);
            ctx.lineTo(0, 1);
            ctx.closePath();
        }
        return standardDraw(drawPath);
    }

    if (partShape == "P") {
        let pinCenterX;
        let pinCenterY;
        if (shapesConfig == quadShapesConfig) {
            pinCenterX = 1 / 3;
            pinCenterY = 2 / 3;
        } else if (shapesConfig == hexShapesConfig) {
            pinCenterX = sqrt2 / 6;
            pinCenterY = 1 - (sqrt6 / 6);
        }
        const pinRadius = 1 / 6;
        return [
            (() => {
                if (drawShadow) {
                    ctx.beginPath();
                    ctx.arc(pinCenterX, pinCenterY, pinRadius + (curBorderSize / 2), 0, 2 * Math.PI);
                    ctx.closePath();
                    ctx.fillStyle = shadowColor;
                    ctx.fill();
                }
                ctx.beginPath();
                ctx.arc(pinCenterX, pinCenterY, pinRadius, 0, 2 * Math.PI);
                ctx.closePath();
                ctx.fillStyle = pinColor;
                ctx.fill();
            }),
            (() => { })
        ];
    }

    if (partShape == "c") {
        const darkenedColor = darkenColor(color);
        if (shapesConfig == quadShapesConfig) {
            const darkenedAreasOffset = layerIndex % 2 == 0 ? 0 : 22.5;
            const startAngle1 = radians(360 - (67.5 - darkenedAreasOffset));
            const stopAngle1 = radians(360 - (90 - darkenedAreasOffset));
            const startAngle2 = radians(360 - (22.5 - darkenedAreasOffset));
            const stopAngle2 = radians(360 - (45 - darkenedAreasOffset));
            return [
                (() => {
                    if (drawShadow) {
                        ctx.beginPath();
                        ctx.moveTo(0, 1);
                        ctx.arc(0, 1, 1 + (curBorderSize / 2), -Math.PI / 2, 0);
                        ctx.closePath();
                        ctx.fillStyle = shadowColor;
                        ctx.fill();
                    }
                    ctx.beginPath();
                    ctx.moveTo(0, 1);
                    ctx.arc(0, 1, 1, -Math.PI / 2, 0);
                    ctx.closePath();
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.beginPath();
                    ctx.moveTo(0, 1);
                    ctx.arc(0, 1, 1, startAngle1, stopAngle1, true);
                    ctx.lineTo(0, 1);
                    ctx.arc(0, 1, 1, startAngle2, stopAngle2, true);
                    ctx.lineTo(0, 1);
                    ctx.closePath();
                    ctx.fillStyle = darkenedColor;
                    ctx.fill();
                }),
                (() => { })
            ];
        } else if (shapesConfig == hexShapesConfig) {
            const points = [
                [0, 0],
                [sqrt3 / 2, 0.5],
                [0, 1]
            ];
            const shadowPoints = [
                [points[0][0], points[0][1] - (curBorderSize / 2)],
                [points[1][0] + ((sqrt3 / 2) * (curBorderSize / 2)), points[1][1] - (curBorderSize / 4)],
                [points[2][0], points[2][1]]
            ];
            const sideMiddlePoint = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
            let darkenedArea;
            if (layerIndex % 2 == 0) {
                darkenedArea = [points[0], sideMiddlePoint, points[2]];
            } else {
                darkenedArea = [sideMiddlePoint, points[1], points[2]];
            }
            return [
                (() => {
                    if (drawShadow) {
                        drawPolygon(ctx, shadowPoints);
                        ctx.fillStyle = shadowColor;
                        ctx.fill();
                    }
                    drawPolygon(ctx, points);
                    ctx.fillStyle = color;
                    ctx.fill();
                    drawPolygon(ctx, darkenedArea);
                    ctx.fillStyle = darkenedColor;
                    ctx.fill();
                }),
                (() => { })
            ];
        }
    }

    throw new Error("Invalid shape");
}
