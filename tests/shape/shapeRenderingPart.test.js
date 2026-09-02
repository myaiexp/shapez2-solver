// Contract tests for buildPartDrawers vs validateShapeCode — run with:
//   node tests/shape/shapeRenderingPart.test.js
//
// The validator and the renderer were tested in isolation, so a code that
// validateShapeCode accepts could still throw (crystal + no color) or paint
// leftover fill (C-/R-/… with colorValues[mode]['-'] undefined). This file
// iterates VALID_SHAPES × VALID_COLORS × color modes from the validator so a
// new char that validates but cannot be drawn fails here instead of in the UI.
import { buildPartDrawers, QUAD_MODE, HEX_MODE } from '../../shapeRenderingPart.js';
import { VALID_SHAPES, VALID_COLORS } from '../../shapeValidation.js';
import { NOTHING_CHAR } from '../../shapeClass.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond, detail) {
    total++;
    if (cond) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name}${detail ? `\n    ${detail}` : ''}`);
        failed = true;
    }
}

// Recording canvas stub — no DOM. fill() snapshots the current fillStyle so
// we can assert every paint used a defined css color string.
function makeCtx() {
    const fills = [];
    const ctx = {
        beginPath() {},
        moveTo() {},
        lineTo() {},
        arc() {},
        rect() {},
        closePath() {},
        fill() { fills.push(ctx.fillStyle); },
        stroke() {},
        fillStyle: undefined,
        strokeStyle: undefined,
        lineWidth: 0,
        lineJoin: '',
    };
    return { ctx, fills };
}

function exercise(partShape, partColor, geometryMode, colorMode, layerIndex = 0) {
    const { ctx, fills } = makeCtx();
    const drawers = buildPartDrawers(ctx, partShape, partColor, layerIndex, geometryMode, colorMode, 1);
    drawers.fill();
    drawers.stroke();
    return fills;
}

const COLOR_MODES = ['rgb', 'ryb', 'cmyk'];
const GEOMETRIES = [QUAD_MODE, HEX_MODE];

function isCssColor(value) {
    return typeof value === 'string' && /^rgba?\(/.test(value);
}

// --- Focused cases that previously crashed or painted leftover fill ----------
{
    let threw = null;
    try {
        exercise('c', '-', QUAD_MODE, 'rgb');
    } catch (err) {
        threw = err;
    }
    check(
        'crystal with no color (c-) does not throw',
        threw === null,
        threw ? `threw ${threw}` : ''
    );
}

{
    const fills = exercise('C', '-', QUAD_MODE, 'rgb');
    const bad = fills.filter(c => !isCssColor(c));
    check(
        'circle with no color (C-) paints a defined fill, not leftover undefined',
        fills.length > 0 && bad.length === 0,
        `fills=${JSON.stringify(fills)}`
    );
}

{
    const fills = exercise('C', 'u', QUAD_MODE, 'rgb');
    check(
        'circle uncolored (Cu) paints a defined fill',
        fills.length > 0 && fills.every(isCssColor),
        `fills=${JSON.stringify(fills)}`
    );
}

// Pin / Nothing don't take a part color; they must still not throw.
{
    let threw = null;
    try {
        exercise(NOTHING_CHAR, NOTHING_CHAR, QUAD_MODE, 'rgb');
        exercise('P', NOTHING_CHAR, QUAD_MODE, 'rgb');
        exercise('P', NOTHING_CHAR, HEX_MODE, 'rgb', 1);
    } catch (err) {
        threw = err;
    }
    check('Nothing and Pin drawers do not throw', threw === null, threw ? `threw ${threw}` : '');
}

// --- Drift guard: every validator-accepted char pair draws in every mode -----
let comboThrows = 0;
let comboBadFills = 0;
let comboCount = 0;
const firstFailures = [];

for (const shape of VALID_SHAPES) {
    for (const color of VALID_COLORS) {
        for (const colorMode of COLOR_MODES) {
            for (const geometryMode of GEOMETRIES) {
                comboCount++;
                let fills;
                try {
                    fills = exercise(shape, color, geometryMode, colorMode);
                } catch (err) {
                    comboThrows++;
                    if (firstFailures.length < 5) {
                        firstFailures.push(`${shape}${color} ${colorMode}/${geometryMode} threw ${err}`);
                    }
                    continue;
                }
                // Nothing is a no-op drawer (no fill). Every other shape must
                // actually paint, and every paint must be a defined css color.
                if (shape === NOTHING_CHAR) continue;
                const bad = fills.filter(c => !isCssColor(c));
                if (fills.length === 0 || bad.length) {
                    comboBadFills++;
                    if (firstFailures.length < 5) {
                        firstFailures.push(`${shape}${color} ${colorMode}/${geometryMode} fills=${JSON.stringify(fills)}`);
                    }
                }
            }
        }
    }
}

check(
    `cross product: ${comboCount} VALID_SHAPES×VALID_COLORS×modes×geometries do not throw`,
    comboThrows === 0,
    firstFailures.join('\n    ')
);
check(
    'cross product: every non-Nothing drawer paints a defined css color',
    comboBadFills === 0,
    firstFailures.join('\n    ')
);

// Layer 1 exercises the crystal/pin shadow paths (drawShadow = layerIndex != 0).
{
    let threw = null;
    let fills;
    try {
        fills = exercise('c', 'r', QUAD_MODE, 'rgb', 1);
    } catch (err) {
        threw = err;
    }
    check(
        'crystal on layer 1 (shadow path) paints defined fills',
        threw === null && fills.length > 0 && fills.every(isCssColor),
        threw ? `threw ${threw}` : `fills=${JSON.stringify(fills)}`
    );
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
