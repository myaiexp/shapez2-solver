// Unit tests for createPulse, the search progress cadence — run with:
//   node tests/solver/shapeSolverProgress.test.js
//
// Time is controlled through intervalMs rather than a fake clock: -1 is always
// elapsed and Infinity never is, so nothing here waits or depends on load.
import { createPulse } from '../../shapeSolverProgress.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

const noop = () => {};

{
    const pulse = createPulse(noop, { everyN: 500, intervalMs: Infinity });
    check('due on a multiple of everyN', pulse.due(1000));
    check('not due between multiples', !pulse.due(1001));
}

{
    const pulse = createPulse(noop, { everyN: 500, intervalMs: -1 });
    check('due off a multiple once the interval has passed', pulse.due(1001));
}

// The explorer and BFS count ticks themselves or not at all.
check('time-only: due once the interval has passed', createPulse(noop, { intervalMs: -1 }).due());
check('time-only: not due before it', !createPulse(noop, { intervalMs: Infinity }).due());

// emit restarts the clock: a 50 ms interval is due after a 60 ms wait and not
// straight after the emit that follows it.
{
    const pulse = createPulse(noop, { intervalMs: 50 });
    await new Promise((r) => setTimeout(r, 60));
    check('clock: due after the interval', pulse.due());
    await pulse.emit('tick');
    check('clock: emit restarts the interval', !pulse.due());
}

// A worker only reads its cancel message between macrotasks, so emit must not
// resolve until the event loop has turned.
{
    const seen = [];
    const pulse = createPulse((message) => seen.push(message));
    let timerRan = false;
    setTimeout(() => { timerRan = true; }, 0);
    await pulse.emit('hello');
    check('emit posts its message', seen.length === 1 && seen[0] === 'hello');
    check('emit yields to the event loop', timerRan);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
