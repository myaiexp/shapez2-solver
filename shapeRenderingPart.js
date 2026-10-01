// Shape-part drawers for renderShape — fill/stroke thunks for one quadrant.
// Stroke is deferred so borders overlay after every part in the layer fills.
import { colorValues, baseColors } from './shapeRenderingColors.js';

export const QUAD_MODE = "quad";
export const HEX_MODE = "hex";

const SHAPE_BORDER_COLOR = "rgb(35,25,35)";
const SHADOW_COLOR = "rgba(50,50,50,0.5)";
const PIN_COLOR = "rgb(71,69,75)";

// Sizes taken from a screenshot of the ingame shape viewer (units: fraction of default image size)
export const DEFAULT_IMAGE_SIZE = 602;
const DEFAULT_BORDER_SIZE = 15;
const BORDER_SIZE = DEFAULT_BORDER_SIZE / DEFAULT_IMAGE_SIZE;

const SQRT2 = Math.sqrt(2);
const SQRT3 = Math.sqrt(3);
const SQRT6 = Math.sqrt(6);

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

export function buildPartDrawers(ctx, partShape, partColor, layerIndex, geometryMode, colorMode, borderScale) {

    const hasShadow = layerIndex != 0;
    // Uncolored fallback: colorValues has no '-' (Nothing/Pin are no-paint /
    // PIN_COLOR), so a colorless structural/crystal used to set fillStyle to
    // undefined (leftover paint) or throw in darkenColor (crystal).
    const color = colorValues[colorMode]?.[partColor] ?? baseColors.u;
    const curBorderSize = BORDER_SIZE / borderScale;

    function standardDraw(drawPath) {
        return {
            fill() {
                drawPath();
                ctx.fillStyle = color;
                ctx.fill();
            },
            stroke() {
                drawPath();
                ctx.strokeStyle = SHAPE_BORDER_COLOR;
                ctx.lineWidth = curBorderSize;
                ctx.lineJoin = "round";
                ctx.stroke();
            }
        };
    }

    if (partShape == "-") {
        return { fill() {}, stroke() {} };
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
            ctx.lineTo(SQRT3 / 2, 0.5);
            ctx.lineTo(0, 1);
            ctx.closePath();
        }
        return standardDraw(drawPath);
    }

    if (partShape == "F") {
        const semicircleRadius = (3 - SQRT3) / 4;
        const triangleSideLength = 2 * semicircleRadius;
        const semicircleCenterX = (triangleSideLength * (SQRT3 / 2)) / 2;
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
            ctx.lineTo(SQRT3 / 6, 0.5);
            ctx.lineTo(SQRT3 / 2, 0.5);
            ctx.lineTo(0, 1);
            ctx.closePath();
        }
        return standardDraw(drawPath);
    }

    if (partShape == "P") {
        let pinCenterX;
        let pinCenterY;
        if (geometryMode == QUAD_MODE) {
            pinCenterX = 1 / 3;
            pinCenterY = 2 / 3;
        } else if (geometryMode == HEX_MODE) {
            pinCenterX = SQRT2 / 6;
            pinCenterY = 1 - (SQRT6 / 6);
        }
        const pinRadius = 1 / 6;
        return {
            fill() {
                if (hasShadow) {
                    ctx.beginPath();
                    ctx.arc(pinCenterX, pinCenterY, pinRadius + (curBorderSize / 2), 0, 2 * Math.PI);
                    ctx.closePath();
                    ctx.fillStyle = SHADOW_COLOR;
                    ctx.fill();
                }
                ctx.beginPath();
                ctx.arc(pinCenterX, pinCenterY, pinRadius, 0, 2 * Math.PI);
                ctx.closePath();
                ctx.fillStyle = PIN_COLOR;
                ctx.fill();
            },
            stroke() {}
        };
    }

    if (partShape == "c") {
        const darkenedColor = darkenColor(color);
        if (geometryMode == QUAD_MODE) {
            const darkenedAreasOffset = layerIndex % 2 == 0 ? 0 : 22.5;
            const startAngle1 = radians(360 - (67.5 - darkenedAreasOffset));
            const stopAngle1 = radians(360 - (90 - darkenedAreasOffset));
            const startAngle2 = radians(360 - (22.5 - darkenedAreasOffset));
            const stopAngle2 = radians(360 - (45 - darkenedAreasOffset));
            return {
                fill() {
                    if (hasShadow) {
                        ctx.beginPath();
                        ctx.moveTo(0, 1);
                        ctx.arc(0, 1, 1 + (curBorderSize / 2), -Math.PI / 2, 0);
                        ctx.closePath();
                        ctx.fillStyle = SHADOW_COLOR;
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
                },
                stroke() {}
            };
        } else if (geometryMode == HEX_MODE) {
            const points = [
                [0, 0],
                [SQRT3 / 2, 0.5],
                [0, 1]
            ];
            const shadowPoints = [
                [points[0][0], points[0][1] - (curBorderSize / 2)],
                [points[1][0] + ((SQRT3 / 2) * (curBorderSize / 2)), points[1][1] - (curBorderSize / 4)],
                [points[2][0], points[2][1]]
            ];
            const sideMiddlePoint = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
            let darkenedArea;
            if (layerIndex % 2 == 0) {
                darkenedArea = [points[0], sideMiddlePoint, points[2]];
            } else {
                darkenedArea = [sideMiddlePoint, points[1], points[2]];
            }
            return {
                fill() {
                    if (hasShadow) {
                        drawPolygon(ctx, shadowPoints);
                        ctx.fillStyle = SHADOW_COLOR;
                        ctx.fill();
                    }
                    drawPolygon(ctx, points);
                    ctx.fillStyle = color;
                    ctx.fill();
                    drawPolygon(ctx, darkenedArea);
                    ctx.fillStyle = darkenedColor;
                    ctx.fill();
                },
                stroke() {}
            };
        }
    }

    // 1.0 support: Refined/Exotic shapes X and Y (Trade Stations / Manufacture Mode).
    // Color-bearing (Xu/Xr/…) but not Painter-recolorable — the part color is
    // still drawn from the code suffix. Geometry traced from the in-game renders:
    // (0,1) is the shape centre, (1,0) the outer diagonal corner of the quadrant.
    // X: convex "home-plate" — full edges along both axes, outer corner pulled to a
    //    single point; the four quadrants together read as a 4-petal shape.
    if (partShape == "X") {
        function drawPath() {
            drawPolygon(ctx, [[0, 1], [1, 1], [1.13, -0.13], [0, 0]]);
        }
        return standardDraw(drawPath);
    }

    // Y: concave dart/arrowhead — a barb along each axis plus a long outer point,
    //    with a notch between; the four quadrants together form an 8-point star.
    if (partShape == "Y") {
        function drawPath() {
            drawPolygon(ctx, [[0, 1], [1, 1], [0.58, 0.42], [1.08, -0.08], [0.42, 0.58], [0, 0]]);
        }
        return standardDraw(drawPath);
    }

    throw new Error("Invalid shape");
}
