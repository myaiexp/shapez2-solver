// Space-graph data transform — run with: node tests/shared/operationGraphSpace.test.js
//
// buildSpaceGraphData is the 3D graph's whole structure (shape/op nodes and
// links) and runs without THREE or a DOM. Every link must name a node that
// was actually built: skipping Belt Split as an op node used to leave its
// edges pointing at the missing id, which d3-force rejects.
import { buildSpaceGraphData } from '../../operationGraphSpace.js';

let passed = 0, total = 0, failed = false;
function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? `\n    ${detail}` : ''}`); failed = true; }
}

const image = (code) => `img:${code}`;
const ids = (data) => new Set(data.nodes.map((n) => n.id));
const linked = (data) => data.links.every((l) => ids(data).has(l.source) && ids(data).has(l.target));

// --- a plain op ---------------------------------------------------------------
{
    const data = buildSpaceGraphData({
        shapes: [{ id: 'shape-0', code: 'CuCuCuCu' }, { id: 'shape-1', code: 'CuCu----' }],
        ops: [{ id: 'op-0', type: 'Cutter', params: {} }],
        edges: [
            { source: 'shape-0', target: 'op-0' },
            { source: 'op-0', target: 'shape-1' },
        ],
    }, image);
    check('cutter: shape thumbnails come from shapeImage', data.nodes.filter((n) => n.kind === 'shape').every((n) => n.image === `img:${n.label}`));
    check('cutter: op node keeps the operation image path', data.nodes.find((n) => n.id === 'op-0')?.image === 'images/operations/cutter.png');
    check('cutter: link kinds follow the edge direction',
        data.links.map((l) => l.kind).join(',') === 'to-op,from-op');
    check('cutter: every link endpoint is a node', linked(data));
}

// --- Belt Split must not dangle ----------------------------------------------
{
    const data = buildSpaceGraphData({
        shapes: [{ id: 'shape-0', code: 'CuCuCuCu' }, { id: 'shape-1', code: 'CuCuCuCu' }],
        ops: [
            { id: 'op-0', type: 'Belt Split', params: {} },
            { id: 'op-1', type: 'Rotator CW', params: {} },
        ],
        edges: [
            { source: 'shape-0', target: 'op-0' },
            { source: 'op-0', target: 'shape-1' },
            { source: 'shape-0', target: 'op-1' },
            { source: 'op-1', target: 'shape-1' },
        ],
    }, image);
    check('belt split: op node is omitted', !ids(data).has('op-0'));
    check('belt split: a real op beside it is kept', ids(data).has('op-1'));
    check('belt split: shape nodes stay', ids(data).has('shape-0') && ids(data).has('shape-1'));
    check('belt split: rotator edges stay', data.links.some((l) => l.source === 'shape-0' && l.target === 'op-1')
        && data.links.some((l) => l.source === 'op-1' && l.target === 'shape-1'));
    check('belt split: every link endpoint is a node', linked(data));
}

check('null graph is empty', buildSpaceGraphData(null, image).nodes.length === 0
    && buildSpaceGraphData(null, image).links.length === 0);

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
