// Worker job lifecycle tests — run with: node tests/shared/solverJob.test.js
//
// Solve and Explore share one worker slot. Drives solverJob.js against a fake
// Worker and #status element to pin ownership (which button is "Cancel"), the
// generation guard against late messages from a replaced worker, and that every
// terminal outcome — result, error, crash, unreadable message, cancel — releases
// the button and terminates the worker.
import { runSolverJob, cancelActiveJob, isJobRunning } from '../../solverJob.js';

let passed = 0, total = 0, failed = false;
function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? `\n    ${detail}` : ''}`); failed = true; }
}

const status = { textContent: '' };
globalThis.document = { getElementById: (id) => (id === 'status' ? status : null) };
const errors = [];
console.error = (...args) => errors.push(args);

const workers = [];
globalThis.Worker = class {
    constructor(url, opts) {
        this.url = String(url);
        this.opts = opts;
        this.posted = [];
        this.terminated = false;
        workers.push(this);
    }
    postMessage(msg) { this.posted.push(msg); }
    terminate() { this.terminated = true; }
};

const solveBtn = { textContent: 'Solve' };
const exploreBtn = { textContent: 'Explore' };

function start(btn, idleLabel, extra = {}) {
    const calls = { result: [], resultError: 0, complete: 0 };
    runSolverJob({
        btn, idleLabel, action: idleLabel.toLowerCase(), data: { n: 1 },
        onResult: (r) => calls.result.push(r),
        onResultError: () => { calls.resultError++; },
        onComplete: () => { calls.complete++; },
        ...extra,
    });
    return { worker: workers.at(-1), calls };
}

// --- start ------------------------------------------------------------------
{
    const { worker } = start(solveBtn, 'Solve', { startStatus: 'Exploring...' });
    check('spawns the module worker', worker.url.endsWith('/shapeSolver.js') && worker.opts.type === 'module');
    check('posts the action and data', worker.posted[0]?.action === 'solve' && worker.posted[0].data.n === 1);
    check('owning button reads Cancel', solveBtn.textContent === 'Cancel' && isJobRunning(solveBtn));
    check('other button does not own the worker', !isJobRunning(exploreBtn));
    check('startStatus is shown', status.textContent === 'Exploring...');
    worker.onmessage({ data: { type: 'status', message: 'Depth 2' } });
    check('status messages update #status', status.textContent === 'Depth 2' && isJobRunning(solveBtn));
    cancelActiveJob();
}

// --- result -----------------------------------------------------------------
{
    const { worker, calls } = start(solveBtn, 'Solve');
    const onmessage = worker.onmessage;
    onmessage({ data: { type: 'result', result: { depth: 1 } } });
    check('result reaches onResult', calls.result.length === 1 && calls.result[0].depth === 1);
    check('result releases the button and worker',
        solveBtn.textContent === 'Solve' && !isJobRunning(solveBtn) && worker.terminated && worker.onmessage === null);
    check('onComplete runs once after a result', calls.complete === 1 && calls.resultError === 0);
    onmessage({ data: { type: 'result', result: { depth: 2 } } });
    check('a second message from the finished job is ignored', calls.result.length === 1 && calls.complete === 1);
}

// --- onResult throws --------------------------------------------------------
{
    const { worker, calls } = start(solveBtn, 'Solve', { onResult: () => { throw new Error('render broke'); } });
    worker.onmessage({ data: { type: 'result', result: {} } });
    check('a throwing onResult reports the error', status.textContent === 'Error: render broke' && errors.length === 1);
    check('a throwing onResult resets the views, then completes', calls.resultError === 1 && calls.complete === 1);
    check('a throwing onResult still releases the button', solveBtn.textContent === 'Solve' && worker.terminated);
}

// --- worker error / crash / unreadable message --------------------------------
for (const [name, fire, expected] of [
    ['error message', (w) => w.onmessage({ data: { type: 'error', message: 'Invalid target' } }), 'Invalid target'],
    ['onerror', (w) => w.onerror({ message: 'boom' }), 'Error: boom'],
    ['onerror without a message', (w) => w.onerror({}), 'Error: worker crashed'],
    ['onmessageerror', (w) => w.onmessageerror(), 'Error: worker sent an unreadable message.'],
]) {
    const { worker, calls } = start(exploreBtn, 'Explore');
    fire(worker);
    check(`${name}: status explains`, status.textContent === expected, status.textContent);
    check(`${name}: button and worker released`, exploreBtn.textContent === 'Explore' && !isJobRunning(exploreBtn) && worker.terminated);
    check(`${name}: no result callbacks`, calls.result.length === 0 && calls.complete === 0);
}

// --- cancel -----------------------------------------------------------------
{
    const { worker, calls } = start(solveBtn, 'Solve');
    const onmessage = worker.onmessage;
    cancelActiveJob();
    check('cancel tells the worker, then terminates it',
        worker.posted.at(-1)?.action === 'cancel' && worker.terminated);
    check('cancel releases the button and says so', solveBtn.textContent === 'Solve' && status.textContent === 'Cancelled.');
    onmessage({ data: { type: 'result', result: {} } });
    check('a result queued before cancel is dropped', calls.result.length === 0 && status.textContent === 'Cancelled.');
    cancelActiveJob();
    check('cancel with nothing running is harmless', status.textContent === 'Cancelled.');
}

// --- a new job replaces the other action's job ---------------------------------
{
    const solve = start(solveBtn, 'Solve');
    const stale = solve.worker.onmessage;
    const explore = start(exploreBtn, 'Explore');
    check('starting Explore mid-Solve resets the Solve button', solveBtn.textContent === 'Solve' && !isJobRunning(solveBtn));
    check('the replaced worker is terminated', solve.worker.terminated && !explore.worker.terminated);
    check('Explore now owns the worker', isJobRunning(exploreBtn) && exploreBtn.textContent === 'Cancel');
    stale({ data: { type: 'status', message: 'stale progress' } });
    stale({ data: { type: 'result', result: {} } });
    check('late messages from the replaced worker are ignored',
        status.textContent !== 'stale progress' && solve.calls.result.length === 0 && isJobRunning(exploreBtn));
    cancelActiveJob();
}

delete globalThis.document;
console.log(`\n${passed}/${total} checks passed`);
if (failed) process.exit(1);
