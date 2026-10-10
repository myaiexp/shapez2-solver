// Shape-part drawers for renderShape — fill/stroke thunks for one quadrant.
// Stroke is deferred so borders overlay after every part in the layer fills.
import { colorValues, baseColors } from './shapeRenderingColors.js';
import { NOTHING_CHAR, PIN_CHAR, CRYSTAL_CHAR, REFINED_X_CHAR, REFINED_Y_CHAR } from './shapeClass.js';

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

// Outline of each plain part, in quadrant units: (0,1) is the shape centre and
// (1,0) the outer diagonal corner of the quadrant.
const WINDMILL_SIDE = 1 / 3.75;
const FLOWER_RADIUS = (3 - SQRT3) / 4;
const FLOWER_SIDE = 2 * FLOWER_RADIUS;
const FLOWER_CENTER_X = (FLOWER_SIDE * (SQRT3 / 2)) / 2;
const FLOWER_CENTER_Y = 1 - FLOWER_SIDE + Math.sqrt((FLOWER_RADIUS * FLOWER_RADIUS) - (FLOWER_CENTER_X * FLOWER_CENTER_X));

const PART_PATHS = {
    C(ctx) {
        ctx.beginPath();
        ctx.moveTo(0, 1);
        ctx.arc(0, 1, 1, -Math.PI / 2, 0);
        ctx.closePath();
    },
    R(ctx) {
        ctx.beginPath();
        ctx.rect(0, 0, 1, 1);
        ctx.closePath();
    },
    S(ctx) {
        ctx.beginPath();
        ctx.moveTo(1, 0);
        ctx.lineTo(0.5, 1);
        ctx.lineTo(0, 1);
        ctx.lineTo(0, 0.5);
        ctx.closePath();
    },
    W(ctx) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(WINDMILL_SIDE, 0);
        ctx.arc(1.4, -0.4, 1.18, Math.PI * 0.89, Math.PI * 0.61, true);
        ctx.lineTo(1, 1);
        ctx.lineTo(0, 1);
        ctx.closePath();
    },
    H(ctx) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(SQRT3 / 2, 0.5);
        ctx.lineTo(0, 1);
        ctx.closePath();
    },
    F(ctx) {
        ctx.beginPath();
        ctx.moveTo(0, 1);
        ctx.lineTo(0, 1 - FLOWER_SIDE);
        ctx.arc(FLOWER_CENTER_X, FLOWER_CENTER_Y, FLOWER_RADIUS, (7 / 6) * Math.PI, (1 / 6) * Math.PI);
        ctx.closePath();
    },
    G(ctx) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(SQRT3 / 6, 0.5);
        ctx.lineTo(SQRT3 / 2, 0.5);
        ctx.lineTo(0, 1);
        ctx.closePath();
    },
    // 1.0 support: Refined/Exotic shapes X and Y (Trade Stations / Manufacture Mode).
    // Color-bearing (Xu/Xr/…) but not Painter-recolorable — the part color is
    // still drawn from the code suffix. Geometry traced from the in-game renders.
    // X: convex "home-plate" — full edges along both axes, outer corner pulled to a
    //    single point; the four quadrants together read as a 4-petal shape.
    [REFINED_X_CHAR](ctx) {
        drawPolygon(ctx, [[0, 1], [1, 1], [1.13, -0.13], [0, 0]]);
    },
    // Y: concave dart/arrowhead — a barb along each axis plus a long outer point,
    //    with a notch between; the four quadrants together form an 8-point star.
    [REFINED_Y_CHAR](ctx) {
        drawPolygon(ctx, [[0, 1], [1, 1], [0.58, 0.42], [1.08, -0.08], [0.42, 0.58], [0, 0]]);
    },
};

const PIN_CENTERS = {
    [QUAD_MODE]: [1 / 3, 2 / 3],
    [HEX_MODE]: [SQRT2 / 6, 1 - (SQRT6 / 6)],
};
const PIN_RADIUS = 1 / 6;

const NO_DRAW = { fill() {}, stroke() {} };

export function buildPartDrawers(ctx, partShape, partColor, layerIndex, geometryMode, colorMode, borderScale) {
    if (geometryMode !== QUAD_MODE && geometryMode !== HEX_MODE) {
        throw new Error(`Unknown geometry mode: ${geometryMode}`);
    }
    if (partShape === NOTHING_CHAR) return NO_DRAW;

    // Uncolored fallback: colorValues has no '-' (Nothing/Pin are no-paint /
    // PIN_COLOR), so a colorless structural/crystal used to set fillStyle to
    // undefined (leftover paint) or throw in darkenColor (crystal).
    const color = colorValues[colorMode]?.[partColor] ?? baseColors.u;
    const part = { ctx, color, hasShadow: layerIndex !== 0, layerIndex, borderSize: BORDER_SIZE / borderScale };

    if (partShape === PIN_CHAR) return pinDrawers(part, PIN_CENTERS[geometryMode]);
    if (partShape === CRYSTAL_CHAR) {
        return geometryMode === QUAD_MODE ? quadCrystalDrawers(part) : hexCrystalDrawers(part);
    }

    const drawPath = PART_PATHS[partShape];
    if (!drawPath) throw new Error(`Invalid shape part: ${partShape}`);
    return {
        fill() {
            drawPath(ctx);
            ctx.fillStyle = color;
            ctx.fill();
        },
        stroke() {
            drawPath(ctx);
            ctx.strokeStyle = SHAPE_BORDER_COLOR;
            ctx.lineWidth = part.borderSize;
            ctx.lineJoin = "round";
            ctx.stroke();
        }
    };
}

function pinDrawers({ ctx, hasShadow, borderSize }, [centerX, centerY]) {
    return {
        fill() {
            if (hasShadow) {
                ctx.beginPath();
                ctx.arc(centerX, centerY, PIN_RADIUS + (borderSize / 2), 0, 2 * Math.PI);
                ctx.closePath();
                ctx.fillStyle = SHADOW_COLOR;
                ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(centerX, centerY, PIN_RADIUS, 0, 2 * Math.PI);
            ctx.closePath();
            ctx.fillStyle = PIN_COLOR;
            ctx.fill();
        },
        stroke() {}
    };
}

function quadCrystalDrawers({ ctx, color, hasShadow, layerIndex, borderSize }) {
    const darkenedColor = darkenColor(color);
    const darkenedAreasOffset = layerIndex % 2 === 0 ? 0 : 22.5;
    const startAngle1 = radians(360 - (67.5 - darkenedAreasOffset));
    const stopAngle1 = radians(360 - (90 - darkenedAreasOffset));
    const startAngle2 = radians(360 - (22.5 - darkenedAreasOffset));
    const stopAngle2 = radians(360 - (45 - darkenedAreasOffset));
    return {
        fill() {
            if (hasShadow) {
                ctx.beginPath();
                ctx.moveTo(0, 1);
                ctx.arc(0, 1, 1 + (borderSize / 2), -Math.PI / 2, 0);
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
}

function hexCrystalDrawers({ ctx, color, hasShadow, layerIndex, borderSize }) {
    const darkenedColor = darkenColor(color);
    const points = [
        [0, 0],
        [SQRT3 / 2, 0.5],
        [0, 1]
    ];
    const shadowPoints = [
        [points[0][0], points[0][1] - (borderSize / 2)],
        [points[1][0] + ((SQRT3 / 2) * (borderSize / 2)), points[1][1] - (borderSize / 4)],
        [points[2][0], points[2][1]]
    ];
    const sideMiddlePoint = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
    const darkenedArea = layerIndex % 2 === 0
        ? [points[0], sideMiddlePoint, points[2]]
        : [sideMiddlePoint, points[1], points[2]];
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
