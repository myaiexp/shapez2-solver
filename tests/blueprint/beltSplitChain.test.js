// Chained Belt Splits and row spacing — run with:
// node tests/blueprint/beltSplitChain.test.js
//
// Each Belt Split in a chain moves its outputs one tile south, so a long chain
// used to run past the next row: the consumer's belt then turned north into the
// machine through its output side. The row pitch now grows with the longest
// chain. routeBelt throws on a reversed route, so these layouts would fail loudly
// if the spacing came up short.
import { buildLayout } from '../../blueprintLayout.js';
import { ROW_PITCH } from '../../blueprintRowPitch.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

const C = 'CuCuCuCu';

// Split `length` times, each split taking the previous split's first output.
// Returns the steps plus the ids of the last split's two outputs.
function splitChain(startId, length, shape = C, firstNewId = 100) {
    const steps = [];
    let input = startId;
    let next = firstNewId;
    for (let i = 0; i < length; i++) {
        const [a, b] = [next++, next++];
        steps.push({
            operation: 'Belt Split',
            inputs: [{ id: input, shape }],
            outputs: [{ id: a, shape }, { id: b, shape }],
            params: {},
        });
        input = a;
    }
    const last = steps.at(-1).outputs;
    return { steps, ids: last.map(o => o.id) };
}

const stacker = (bottomId, topId, shape, outId) => ({
    operation: 'Stacker',
    inputs: [{ id: bottomId, shape }, { id: topId, shape }],
    outputs: [{ id: outId, shape: `${shape}:${shape}` }],
    params: {},
});

// Every chain length from a source, into the first row (a Stacker's second input
// lifts to floor 1, which needs one tile more than a same-floor input).
for (let length = 1; length <= 7; length++) {
    const { steps, ids } = splitChain(0, length);
    const layout = buildLayout([...steps, stacker(ids[0], ids[1], C, 900)]);
    check(`source chain of ${length}: no north belt`,
        layout.belts.every(b => b.direction !== 'N'));
    check(`source chain of ${length}: belts stop north of the machine's back face`,
        layout.belts.every(b => b.kind === 'split' || b.y <= layout.machines[0].y));
}

// A chain hanging off a machine's output, into the next row.
for (let length = 1; length <= 7; length++) {
    const first = stacker(0, 1, C, 2);
    const stacked = first.outputs[0].shape;
    const { steps, ids } = splitChain(2, length, stacked);
    const layout = buildLayout([first, ...steps, stacker(ids[0], ids[1], stacked, 900)]);
    check(`machine chain of ${length}: no north belt`,
        layout.belts.every(b => b.direction !== 'N'));
    const [upper, lower] = layout.machines;
    check(`machine chain of ${length}: consumer sits in a later row`, lower.y > upper.y);
}

// Short chains keep the regular grid.
{
    const { steps, ids } = splitChain(0, 2);
    const layout = buildLayout([...steps, stacker(ids[0], ids[1], C, 900)]);
    check('short chain: first row stays at ROW_PITCH', layout.machines[0].y === ROW_PITCH);
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
