import { createShapeCanvas } from './shapeRendering.js';
import { setGraph3dInstance, destroy2DGraph, destroySpaceGraph } from './operationGraphInstances.js';
import { clearLastSolutionPath } from './operationGraph2D.js';
import { copyText } from './clipboardFeedback.js';

// Pure node/link data for the 3D force graph, so the transform can be tested
// without THREE or a DOM. Belt Split is not drawn as an op node (it is a belt
// tee, same as the 2D flowchart); edges that touch a skipped op are dropped,
// otherwise the link names an id the graph never built and d3-force rejects it.
export function buildSpaceGraphData(graph, shapeImage) {
    if (!graph) return { nodes: [], links: [] };

    const nodes = [];
    const skipped = new Set();
    for (const s of graph.shapes) {
        nodes.push({
            id: s.id,
            kind: 'shape',
            label: s.code,
            image: shapeImage(s.code)
        });
    }

    for (const op of graph.ops) {
        if (op.type === 'Belt Split') {
            skipped.add(op.id);
            continue;
        }

        nodes.push({
            id: op.id,
            kind: 'op',
            label: op.type,
            image: `images/operations/${op.type.toLowerCase().replace(/\s+/g,'-')}.png`
        });
    }

    const links = [];
    for (const e of graph.edges) {
        if (skipped.has(e.source) || skipped.has(e.target)) continue;
        links.push({
            source: e.source,
            target: e.target,
            kind:
                e.target.startsWith('op-') ? 'to-op' :
                e.source.startsWith('op-') ? 'from-op' :
                ''
        });
    }

    return { nodes, links };
}

function makeNodeSprite(image, scale) {
    const tex = new THREE.TextureLoader().load(image, t => { t.colorSpace = THREE.SRGBColorSpace; t.premultiplyAlpha = false; });
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, premultipliedAlpha: false, depthTest: true, depthWrite: false, });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(scale, scale, 1);
    return sprite;
}

export function renderSpaceGraph(graph) {
    const container = document.getElementById('graph-container');
    container.replaceChildren();
    container.style.position = 'relative';

    destroySpaceGraph();
    destroy2DGraph();
    // Explore replaces the flowchart view; forget the prior solve path so an
    // edge-style change cannot reRenderGraph the old 2D chain over the space graph.
    clearLastSolutionPath();

    if (!graph) return;

    const { nodes, links } = buildSpaceGraphData(graph, (code) => createShapeCanvas(code, 120).toDataURL());

    const g3d = ForceGraph3D()(container)
        .graphData({ nodes, links })
        .showNavInfo(false)
        .forceEngine('d3')
        .d3AlphaDecay(0.005)
        .d3VelocityDecay(0.1)
        .backgroundColor('rgba(0,0,0,0)')
        .nodeAutoColorBy(null)
        .nodeOpacity(0.9)
        .linkOpacity(0.4)
        .linkColor(link => link.kind === 'to-op' ? '#999' : link.kind === 'from-op' ? '#FC9A19' : '#999')
        .linkDirectionalArrowLength(4)
        .linkDirectionalArrowRelPos(1)

        .nodeThreeObject(node => {
            const group = new THREE.Group();
            group.add(makeNodeSprite(node.image, node.kind === 'shape' ? 15 : 12));
            return group;
        })
        .nodeLabel(node => node.label);

    setGraph3dInstance(g3d);

    g3d.onNodeClick(node => {
        if (node.kind === 'shape') {
            copyText(node.label, node.label);
        }
    });

    return g3d;
}
