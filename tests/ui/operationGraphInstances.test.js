// Space-graph pause/resume around worker jobs — run with:
//   node tests/ui/operationGraphInstances.test.js
//
// The 3D graph's force layout and render loop run on the main thread, and with a
// few thousand nodes they starve it: a solve started after Explore measured 8.4s
// instead of 0.09s because worker messages queued behind frames. main.js pauses
// the graph while a job runs and resumes it when the job ends.
import { setGraph3dInstance, destroySpaceGraph, pauseSpaceGraph, resumeSpaceGraph } from '../../operationGraphInstances.js';

let passed = 0, total = 0, failed = false;
function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

function fakeGraph() {
    const g = { calls: [] };
    g.pauseAnimation = () => { g.calls.push('pause'); return g; };
    g.resumeAnimation = () => { g.calls.push('resume'); return g; };
    g._destructor = () => { g.calls.push('destroy'); };
    return g;
}

{
    pauseSpaceGraph();
    resumeSpaceGraph();
    check('pause and resume with no graph are harmless', true);
}

{
    const g = fakeGraph();
    setGraph3dInstance(g);
    pauseSpaceGraph();
    check('pause stops the live graph', g.calls.join() === 'pause');
    resumeSpaceGraph();
    check('resume restarts it', g.calls.join() === 'pause,resume');
    resumeSpaceGraph();
    check('a second resume does nothing', g.calls.join() === 'pause,resume');
    destroySpaceGraph();
}

{
    const g = fakeGraph();
    setGraph3dInstance(g);
    resumeSpaceGraph();
    check('resume without a pause leaves the graph alone', g.calls.length === 0);
    destroySpaceGraph();
}

{
    // A solved result replaces the space graph before the job's resume runs.
    const g = fakeGraph();
    setGraph3dInstance(g);
    pauseSpaceGraph();
    destroySpaceGraph();
    const next = fakeGraph();
    setGraph3dInstance(next);
    resumeSpaceGraph();
    check('resume after the paused graph was replaced touches neither graph',
        g.calls.join() === 'pause,destroy' && next.calls.length === 0, `${g.calls} / ${next.calls}`);
    destroySpaceGraph();
}

console.log(`\n${passed}/${total} checks passed`);
if (failed) process.exit(1);
