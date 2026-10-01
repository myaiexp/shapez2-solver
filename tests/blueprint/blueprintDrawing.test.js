// Unit tests for drawScene's belt styling and machine port placement — run with:
//   node tests/blueprint/blueprintDrawing.test.js
// A recording 2D context logs each fillRect/fillText with the fillStyle in
// effect, so belt-kind colors, badges and port positions are asserted directly.

import { drawScene, TILE_SIZE } from '../../blueprintDrawing.js';

let passed = 0, total = 0, failed = false;
function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? `\n    ${detail}` : ''}`); failed = true; }
}

function makeRecordingCtx() {
    const calls = [];
    const state = {};
    const ctx = new Proxy({}, {
        get(_t, prop) {
            if (prop === 'calls') return calls;
            if (prop === 'fillRect') return (x, y, w, h) => calls.push({ op: 'fillRect', x, y, w, h, fill: state.fillStyle });
            if (prop === 'fillText') return (text, x, y) => calls.push({ op: 'fillText', text, x, y, fill: state.fillStyle });
            return prop in state ? state[prop] : (() => {});
        },
        set(_t, prop, value) { state[prop] = value; return true; },
    });
    return ctx;
}

function drawBelt(kind) {
    const ctx = makeRecordingCtx();
    const belt = { x: 1, y: 2, floor: 0, direction: 'S', kind };
    drawScene(ctx, { gridWidth: 4, gridHeight: 4 }, [], [belt], new Map(), 0, 0, 1);
    return ctx.calls;
}

const cx = 1 * TILE_SIZE + TILE_SIZE / 2;
const cy = 2 * TILE_SIZE + TILE_SIZE / 2;

const KINDS = {
    normal: { color: '#666666', badge: null },
    split:  { color: '#8888cc', badge: 'SPL' },
    merge:  { color: '#cc8844', badge: 'MRG' },
    lift:   { color: '#44aacc', badge: '⇅' },
};

for (const [kind, { color, badge }] of Object.entries(KINDS)) {
    const calls = drawBelt(kind);
    const tile = calls.find(c => c.op === 'fillRect');
    check(`${kind} belt: tile filled with ${color}`, tile?.fill === color, JSON.stringify(tile));
    const arrow = calls.find(c => c.op === 'fillText' && c.text === '▼');
    check(`${kind} belt: arrow drawn in ${color}`, arrow?.fill === color && arrow.x === cx && arrow.y === cy, JSON.stringify(arrow));
    const badges = calls.filter(c => c.op === 'fillText' && c.y === cy + 14);
    if (badge) {
        check(`${kind} belt: badge ${badge} in ${color}`,
            badges.length === 1 && badges[0].text === badge && badges[0].fill === color, JSON.stringify(badges));
    } else {
        check(`${kind} belt: no badge`, badges.length === 0, JSON.stringify(badges));
    }
}

// An unknown kind draws like a plain belt
{
    const calls = drawBelt('mystery');
    check('unknown belt kind: plain color, no badge',
        calls.find(c => c.op === 'fillRect')?.fill === '#666666' &&
        !calls.some(c => c.op === 'fillText' && c.y === cy + 14));
}

// Ports: each side spaces its ports evenly along that edge of the machine
{
    const ctx = makeRecordingCtx();
    const machine = {
        operation: 'Cutter', x: 2, y: 3,
        def: {
            width: 2, depth: 1,
            inputs: [{ side: 'back' }, {}],
            outputs: [{ side: 'front' }],
            fluidInputs: [{ side: 'left' }, { side: 'right' }],
        },
    };
    drawScene(ctx, { gridWidth: 8, gridHeight: 8 }, [machine], [], new Map(), 0, 0, 1);
    const px = 2 * TILE_SIZE, py = 3 * TILE_SIZE, w = 2 * TILE_SIZE, h = TILE_SIZE;
    const centers = ctx.calls
        .filter(c => c.op === 'fillRect' && c.w === 6)
        .map(c => [c.x + 3, c.y + 3, c.fill]);
    const expected = [
        [px + w / 3, py, '#44cc44'],          // back, 1 of 2
        [px + 2 * w / 3, py, '#44cc44'],      // no side → back, 2 of 2
        [px + w / 2, py + h, '#cc4444'],      // front, 1 of 1
        [px, py + h / 3, '#4488cc'],          // left, 1 of 2
        [px + w, py + 2 * h / 3, '#4488cc'],  // right, 2 of 2
    ];
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    check('ports: positions and colors per side',
        centers.length === expected.length &&
        centers.every(([x, y, f], i) => close(x, expected[i][0]) && close(y, expected[i][1]) && f === expected[i][2]),
        `got ${JSON.stringify(centers)}`);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
