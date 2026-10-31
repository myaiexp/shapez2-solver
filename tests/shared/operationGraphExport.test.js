// Graph image copy, through the operationGraph.js facade main.js uses — run with:
//   node tests/shared/operationGraphExport.test.js
//
// copyGraphToClipboard picks the live view: Cytoscape, else the 3D graph, else a
// failure on #status. The 3D branch must draw a frame before toBlob, because the
// WebGL buffer is cleared after each composite and the capture would come back blank.
import { copyGraphToClipboard, cyInstance, graph3dInstance } from '../../operationGraph.js';
import { destroy2DGraph, destroySpaceGraph, setCyInstance, setGraph3dInstance } from '../../operationGraphInstances.js';

let passed = 0, total = 0, failed = false;
function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

const status = { textContent: 'Solved' };
globalThis.document = { getElementById: (id) => (id === 'status' ? status : null) };
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};

const written = [];
Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { write: async (items) => { written.push(...items); } } },
    configurable: true,
});
globalThis.ClipboardItem = class { constructor(parts) { this.blob = parts['image/png']; } };

// --- no graph ----------------------------------------------------------------
check('the facade starts with no live graph', cyInstance === null && graph3dInstance === null);
check('no graph reports false', (await copyGraphToClipboard()) === false);
check('no graph names the reason on #status',
    status.textContent === "Couldn't copy graph image: there is no graph yet.", status.textContent);
check('no graph writes nothing to the clipboard', written.length === 0);

// --- 2D wins over 3D ---------------------------------------------------------
{
    const pngOptions = [];
    let drew3d = false;
    setCyInstance({
        png: (options) => { pngOptions.push(options); return 'cy-blob'; },
        destroy() {},
    });
    setGraph3dInstance({ renderer: () => { drew3d = true; }, _destructor() {} });

    check('the Cytoscape copy reports true', (await copyGraphToClipboard()) === true);
    check('the facade exposes the live 2D instance', cyInstance !== null);
    check('asks Cytoscape for the whole graph as a blob',
        pngOptions.length === 1 && pngOptions[0].output === 'blob' && pngOptions[0].full === true);
    check('writes the Cytoscape blob', written[0]?.blob === 'cy-blob');
    check('a live 2D graph leaves the 3D one alone', drew3d === false);
    check('reports success on #status', status.textContent === 'Copied graph image to clipboard.', status.textContent);
    destroy2DGraph();
    destroySpaceGraph();
    written.length = 0;
}

// --- 3D ----------------------------------------------------------------------
{
    const order = [];
    const scene = {}, camera = {};
    let drawnWith = null;
    setGraph3dInstance({
        renderer: () => ({
            render: (s, c) => { order.push('render'); drawnWith = [s, c]; },
            domElement: {
                toBlob: (done, type) => { order.push(`toBlob:${type}`); done('webgl-blob'); },
            },
        }),
        scene: () => scene,
        camera: () => camera,
        _destructor() {},
    });

    check('the 3D copy reports true', (await copyGraphToClipboard()) === true);
    check('draws a frame in the same task as toBlob',
        order.join() === 'render,toBlob:image/png', order.join());
    check('draws the graph scene with its camera', drawnWith?.[0] === scene && drawnWith?.[1] === camera);
    check('writes the WebGL blob', written[0]?.blob === 'webgl-blob');
    destroySpaceGraph();
    written.length = 0;
}

// --- a failed 3D export ------------------------------------------------------
{
    const errors = [];
    console.error = (...args) => errors.push(args);
    setGraph3dInstance({
        renderer: () => ({
            render() {},
            domElement: { toBlob: (done) => done(null) },
        }),
        scene: () => ({}),
        camera: () => ({}),
        _destructor() {},
    });

    check('a null WebGL capture reports false', (await copyGraphToClipboard()) === false);
    check('names the empty capture on #status',
        status.textContent === "Couldn't copy graph image: the image export produced no data.", status.textContent);
    check('writes nothing for an empty capture', written.length === 0);
    check('logs the failure', errors.length === 1);
    destroySpaceGraph();
}

console.log(`\n${passed}/${total} passed`);
process.exit(failed ? 1 : 0);
