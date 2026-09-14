// Unit tests for BlueprintRenderer (canvas pan/zoom/hover class) — run with:
//   node tests/blueprint/blueprintRenderer.test.js
// Stubs just enough of the browser surface (devicePixelRatio, ResizeObserver,
// document.createElement, a recording 2D context) to drive the renderer with
// no real DOM.

let passed = 0, total = 0, failed = false;
function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? `\n    ${detail}` : ''}`); failed = true; }
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ---- DOM stubs --------------------------------------------------------
globalThis.window = { devicePixelRatio: 2 };

class ResizeObserverStub {
    constructor(cb) { this.cb = cb; this.observed = []; this.disconnected = false; }
    observe(el) { this.observed.push(el); }
    disconnect() { this.disconnected = true; }
}
globalThis.ResizeObserver = ResizeObserverStub;

// set() stores the value; get() returns the stored value, else a no-op
// recorder — robust against drawScene's large surface of ctx calls/props.
function makeRecordingCtx() {
    const store = {};
    return new Proxy({}, {
        get(_t, prop) { return prop in store ? store[prop] : (() => {}); },
        set(_t, prop, value) { store[prop] = value; return true; },
    });
}

let mockBlobValue = { mock: 'blob' };
const createdCanvases = [];

function makeCanvasStub(rect = { left: 0, top: 0, width: 800, height: 600 }) {
    const listeners = {};
    const canvas = {
        width: 0, height: 0, style: {}, parentElement: null, _rect: rect, _listeners: listeners,
        addEventListener(name, handler, opts) { listeners[name] = { handler, opts }; },
        removeEventListener(name, handler) {
            if (listeners[name]?.handler === handler) delete listeners[name];
        },
        getContext(type) {
            if (type !== '2d') return null;
            if (!canvas._ctx) canvas._ctx = makeRecordingCtx();
            return canvas._ctx;
        },
        getBoundingClientRect() { return { ...canvas._rect }; },
        toBlob(cb, type) { canvas._toBlobType = type; cb(mockBlobValue); },
    };
    return canvas;
}

function makeParentStub(rect = { left: 0, top: 0, width: 800, height: 600 }) {
    const parent = {
        _rect: rect, _children: [],
        getBoundingClientRect() { return { ...parent._rect }; },
        appendChild(child) { parent._children.push(child); child.parentElement = parent; },
        removeChild(child) {
            const i = parent._children.indexOf(child);
            if (i >= 0) parent._children.splice(i, 1);
            child.parentElement = null;
        },
    };
    return parent;
}

globalThis.document = {
    createElement(tag) {
        if (tag === 'div') return { style: {}, textContent: '', offsetWidth: 100, offsetHeight: 40, parentElement: null };
        if (tag === 'canvas') { const el = makeCanvasStub(); createdCanvases.push(el); return el; }
        throw new Error(`unexpected createElement(${tag})`);
    },
    body: { appendChild() {} },
    getElementById() { return null; },
};

const { BlueprintRenderer } = await import('../../blueprintRenderer.js');

// ---- Test layout (2 floors, distinct machines/belts per floor) --------
function makeLayout() {
    return {
        gridWidth: 10, gridHeight: 6, floorCount: 2,
        machines: [
            { operation: 'Cutter', x: 2, y: 1, floor: 0,
              def: { width: 2, depth: 1, inputs: [{ side: 'back' }], outputs: [{ side: 'front' }, { side: 'front' }] },
              inputShapes: ['CuCuCuCu'], outputShapes: ['CuCuCuCu', 'CuCuCuCu'], params: { rotation: 90 } },
            { operation: 'Trash', x: 6, y: 3, floor: 1,
              def: { width: 1, depth: 1, inputs: [], outputs: [] }, inputShapes: [], outputShapes: [], params: {} },
        ],
        belts: [
            { x: 0, y: 0, floor: 0, direction: 'S', kind: 'normal', shapeCode: 'CuCuCuCu' },
            { x: 5, y: 5, floor: 1, direction: 'E', kind: 'split' },
        ],
    };
}

function harness() {
    const canvas = makeCanvasStub();
    const parent = makeParentStub();
    canvas.parentElement = parent;
    const renderer = new BlueprintRenderer(canvas);
    return { canvas, parent, renderer };
}

// 1. Constructor ---------------------------------------------------------
{
    let threw = null, h;
    try { h = harness(); } catch (err) { threw = err; }
    check('constructor does not throw with no layout', threw === null, threw ? String(threw) : '');

    const { canvas, parent, renderer } = h;
    const evts = ['wheel', 'mousedown', 'mousemove', 'mouseup', 'mouseleave'];
    check('constructor attaches all 5 listeners', evts.every((e) => typeof canvas._listeners[e]?.handler === 'function'));
    check('wheel listener registered with {passive:false}', canvas._listeners.wheel.opts?.passive === false);
    check('constructor observes the canvas parent', renderer._resizeObserver.observed.includes(parent));
    check('backing store sized from parent rect × dpr',
        canvas.width === 1600 && canvas.height === 1200, `width=${canvas.width} height=${canvas.height}`);
    check('CSS size set in px from parent rect', canvas.style.width === '800px' && canvas.style.height === '600px');
    check('initial cursor is grab', canvas.style.cursor === 'grab');
}

// 2. setFloor before any layout ------------------------------------------
{
    const { renderer } = harness();
    let threw = null;
    try { renderer.setFloor(1); } catch (err) { threw = err; }
    check('setFloor before setLayout does not throw', threw === null);
    check('setFloor before setLayout is a no-op (currentFloor stays 0)', renderer.currentFloor === 0);
}

// 3. setLayout: floor filtering + fit-centered view -----------------------
let sharedRenderer, sharedLayout;
{
    const { renderer } = harness();
    const layout = makeLayout();
    renderer.setLayout(layout);

    check('setLayout resets currentFloor to 0', renderer.currentFloor === 0);
    check('setLayout: visible machines are exactly floor-0 items',
        renderer._visibleMachines.length === 1 && renderer._visibleMachines[0] === layout.machines[0]);
    check('setLayout: visible belts are exactly floor-0 items',
        renderer._visibleBelts.length === 1 && renderer._visibleBelts[0] === layout.belts[0]);

    const cw = 800, ch = 600, gw = 480, gh = 288; // grid * TILE_SIZE(48)
    const expectedZoom = Math.min((cw * 0.9) / gw, (ch * 0.9) / gh, 5.0);
    const expectedPanX = (cw - gw * expectedZoom) / 2;
    const expectedPanY = (ch - gh * expectedZoom) / 2;
    check('setLayout: fit-centered zoom', close(renderer._zoom, expectedZoom), `${renderer._zoom} vs ${expectedZoom}`);
    check('setLayout: fit-centered panX', close(renderer._panX, expectedPanX), `${renderer._panX} vs ${expectedPanX}`);
    check('setLayout: fit-centered panY', close(renderer._panY, expectedPanY), `${renderer._panY} vs ${expectedPanY}`);

    sharedRenderer = renderer;
    sharedLayout = layout;
}

// 4. setFloor(1), out-of-range no-ops -------------------------------------
{
    const renderer = sharedRenderer, layout = sharedLayout;
    renderer.setFloor(1);
    check('setFloor(1): currentFloor is 1', renderer.currentFloor === 1);
    check('setFloor(1): visible machines are exactly floor-1 items',
        renderer._visibleMachines.length === 1 && renderer._visibleMachines[0] === layout.machines[1]);
    check('setFloor(1): visible belts are exactly floor-1 items',
        renderer._visibleBelts.length === 1 && renderer._visibleBelts[0] === layout.belts[1]);

    const machinesBefore = renderer._visibleMachines, beltsBefore = renderer._visibleBelts;
    renderer.setFloor(2); // == floorCount, out of range
    check('setFloor(floorCount) no-op: floor stays 1', renderer.currentFloor === 1);
    check('setFloor(floorCount) no-op: visible lists unchanged',
        renderer._visibleMachines === machinesBefore && renderer._visibleBelts === beltsBefore);

    renderer.setFloor(-1);
    check('setFloor(-1) no-op: floor stays 1', renderer.currentFloor === 1);
    check('setFloor(-1) no-op: visible lists unchanged',
        renderer._visibleMachines === machinesBefore && renderer._visibleBelts === beltsBefore);
}

// 5. setLayout again resets currentFloor to 0 -----------------------------
{
    const renderer = sharedRenderer;
    const layout2 = makeLayout();
    renderer.setLayout(layout2); // renderer was on floor 1
    check('setLayout after floor switch resets currentFloor to 0', renderer.currentFloor === 0);
    check('setLayout after floor switch: visible items are the new floor-0 items',
        renderer._visibleMachines[0] === layout2.machines[0] && renderer._visibleBelts[0] === layout2.belts[0]);
}

// 6. setLayout(null) -------------------------------------------------------
{
    const { renderer } = harness();
    renderer.setLayout(makeLayout());
    let threw = null;
    try { renderer.setLayout(null); } catch (err) { threw = err; }
    check('setLayout(null) does not throw', threw === null, threw ? String(threw) : '');
    check('setLayout(null): visible machines empty', renderer._visibleMachines.length === 0);
    check('setLayout(null): visible belts empty', renderer._visibleBelts.length === 0);

    renderer.setFloor(0);
    check('setFloor(0) after setLayout(null) is a no-op', renderer.currentFloor === 0 && renderer._visibleMachines.length === 0);
    renderer.setFloor(1);
    check('setFloor(1) after setLayout(null) is also a no-op', renderer.currentFloor === 0);

    let rejected = false;
    try { await renderer.exportPng(); } catch { rejected = true; }
    check('exportPng() rejects when layout is null', rejected);
}

// 7. Wheel zoom --------------------------------------------------------
{
    const { canvas, renderer } = harness();
    renderer.setLayout(makeLayout());

    const zoomBefore = renderer._zoom, panXBefore = renderer._panX, panYBefore = renderer._panY;
    const mouseX = 300, mouseY = 200;
    const worldXBefore = (mouseX - panXBefore) / zoomBefore;
    const worldYBefore = (mouseY - panYBefore) / zoomBefore;

    let prevented = false;
    canvas._listeners.wheel.handler({ clientX: mouseX, clientY: mouseY, deltaY: -100, preventDefault: () => { prevented = true; } });

    check('wheel deltaY<0 multiplies zoom by 1.1', close(renderer._zoom, zoomBefore * 1.1));
    check('wheel calls preventDefault', prevented);
    const worldXAfter = (mouseX - renderer._panX) / renderer._zoom;
    const worldYAfter = (mouseY - renderer._panY) / renderer._zoom;
    check('wheel keeps the world point under the cursor fixed (zoom in)',
        close(worldXAfter, worldXBefore) && close(worldYAfter, worldYBefore),
        `before=(${worldXBefore},${worldYBefore}) after=(${worldXAfter},${worldYAfter})`);

    const zoomBefore2 = renderer._zoom;
    canvas._listeners.wheel.handler({ clientX: mouseX, clientY: mouseY, deltaY: 100, preventDefault: () => {} });
    check('wheel deltaY>0 divides zoom by 1.1', close(renderer._zoom, zoomBefore2 / 1.1));

    for (let i = 0; i < 60; i++) {
        canvas._listeners.wheel.handler({ clientX: mouseX, clientY: mouseY, deltaY: -100, preventDefault: () => {} });
    }
    check('wheel zoom clamps at MAX_ZOOM (5.0)', renderer._zoom === 5.0, `${renderer._zoom}`);

    for (let i = 0; i < 200; i++) {
        canvas._listeners.wheel.handler({ clientX: mouseX, clientY: mouseY, deltaY: 100, preventDefault: () => {} });
    }
    check('wheel zoom clamps at MIN_ZOOM (0.1)', renderer._zoom === 0.1, `${renderer._zoom}`);
}

// 8. Drag pan ------------------------------------------------------------
{
    const { canvas, renderer } = harness();
    renderer.setLayout(makeLayout());

    const panXBefore = renderer._panX, panYBefore = renderer._panY;
    canvas._listeners.mousedown.handler({ button: 0, clientX: 200, clientY: 150 });
    check('mousedown starts drag: cursor becomes grabbing', canvas.style.cursor === 'grabbing');

    canvas._listeners.mousemove.handler({ clientX: 260, clientY: 170 });
    check('drag mousemove shifts panX by client delta', close(renderer._panX, panXBefore + 60));
    check('drag mousemove shifts panY by client delta', close(renderer._panY, panYBefore + 20));

    canvas._listeners.mouseup.handler({});
    check('mouseup restores grab cursor', canvas.style.cursor === 'grab');
    check('mouseup stops dragging', renderer._dragging === false);

    const panXAfterUp = renderer._panX, panYAfterUp = renderer._panY;
    canvas._listeners.mousemove.handler({ clientX: 400, clientY: 400 });
    check('mousemove after mouseup does not pan', renderer._panX === panXAfterUp && renderer._panY === panYAfterUp);

    canvas._listeners.mousedown.handler({ button: 2, clientX: 0, clientY: 0 });
    check('right-button mousedown does not start a drag', renderer._dragging === false && canvas.style.cursor === 'grab');
}

// 9. Hover tooltip ---------------------------------------------------------
{
    const { canvas, parent, renderer } = harness();
    const layout = makeLayout();
    renderer.setLayout(layout);
    const toClient = (worldX, worldY) => ({
        clientX: worldX * renderer._zoom + renderer._panX,
        clientY: worldY * renderer._zoom + renderer._panY,
    });

    // Center of the floor-0 Cutter (x:2,y:1, w:2,d:1) -> grid cell (3,1).
    const cutter = layout.machines[0];
    canvas._listeners.mousemove.handler(toClient((cutter.x + 1) * 48, (cutter.y + 0.5) * 48));
    check('hover over a floor-0 machine shows the tooltip', renderer._tooltip?.style.display === 'block');
    check('tooltip textContent lines',
        renderer._tooltip.textContent === 'Cutter\nIn:  CuCuCuCu\nOut: CuCuCuCu, CuCuCuCu\nrotation: 90',
        renderer._tooltip.textContent);
    check('tooltip is appended to the canvas parent', renderer._tooltip.parentElement === parent);

    // Empty tile: grid cell (8,4), covered by nothing.
    canvas._listeners.mousemove.handler(toClient(8 * 48 + 5, 4 * 48 + 5));
    check('hover over an empty tile hides the tooltip', renderer._tooltip.style.display === 'none');

    // Floor-1 machine (Trash at x:6,y:3) while still on floor 0.
    const trash = layout.machines[1];
    canvas._listeners.mousemove.handler(toClient((trash.x + 0.5) * 48, (trash.y + 0.5) * 48));
    check('hover over a floor-1 machine while on floor 0 hides the tooltip (floor filtering)',
        renderer._tooltip.style.display === 'none');

    canvas._listeners.mousemove.handler(toClient((cutter.x + 1) * 48, (cutter.y + 0.5) * 48));
    check('re-hover shows tooltip again', renderer._tooltip.style.display === 'block');
    canvas._listeners.mouseleave.handler({});
    check('mouseleave hides the tooltip', renderer._tooltip.style.display === 'none');
}

// 10. exportPng --------------------------------------------------------
{
    const { renderer } = harness();
    const layout = makeLayout();
    renderer.setLayout(layout);

    mockBlobValue = { id: 'the-blob' };
    const before = createdCanvases.length;
    const blob = await renderer.exportPng();
    check('exportPng resolves with the blob from toBlob', blob === mockBlobValue);
    check('exportPng created exactly one offscreen canvas', createdCanvases.length === before + 1);
    const offscreen = createdCanvases[createdCanvases.length - 1];
    check('offscreen canvas sized gridWidth*48 x gridHeight*48',
        offscreen.width === layout.gridWidth * 48 && offscreen.height === layout.gridHeight * 48,
        `${offscreen.width}x${offscreen.height}`);
    check('offscreen canvas exported as image/png', offscreen._toBlobType === 'image/png');

    mockBlobValue = null;
    let rejected = false;
    try { await renderer.exportPng(); } catch { rejected = true; }
    check('exportPng rejects when toBlob yields null', rejected);
    mockBlobValue = { mock: 'blob' };
}

// 11. destroy --------------------------------------------------------------
{
    const { canvas, parent, renderer } = harness();
    renderer.setLayout(makeLayout());

    // Trigger a hover first so the tooltip exists and is attached.
    canvas._listeners.mousemove.handler({
        clientX: (2 + 1) * 48 * renderer._zoom + renderer._panX,
        clientY: (1 + 0.5) * 48 * renderer._zoom + renderer._panY,
    });
    const tooltipRef = renderer._tooltip;
    check('setup: tooltip exists before destroy', !!tooltipRef && tooltipRef.parentElement === parent);

    const ro = renderer._resizeObserver;
    renderer.destroy();

    const evts = ['wheel', 'mousedown', 'mousemove', 'mouseup', 'mouseleave'];
    check('destroy removes all 5 listeners', evts.every((e) => canvas._listeners[e] === undefined));
    check('destroy disconnects the ResizeObserver', ro.disconnected === true);
    check('destroy removes the tooltip from its parent', tooltipRef.parentElement === null && !parent._children.includes(tooltipRef));

    let threw = null;
    try { ro.cb(); } catch (err) { threw = err; }
    check('firing the ResizeObserver callback after destroy does not throw', threw === null, threw ? String(threw) : '');
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
