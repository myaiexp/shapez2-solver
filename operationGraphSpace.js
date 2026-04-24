import { createShapeCanvas } from './shapeRendering.js';
import { destroy2DGraph } from './operationGraph2D.js';

export let graph3dInstance = null;

export function destroySpaceGraph() {
    if (graph3dInstance) {
        graph3dInstance._destructor();
        graph3dInstance = null;
    }
}

export function renderSpaceGraph(graph) {
    const container = document.getElementById('graph-container');
    container.replaceChildren();
    container.style.position = 'relative';

    destroySpaceGraph();
    destroy2DGraph();

    if (!graph) return;

    const nodes = [];
    const links = [];
    const nodeMap = new Map();

    // Shape nodes
    for (const s of graph.shapes) {
        const nodeId = s.id;
        const canvas = createShapeCanvas(s.code, 120);

        const node = {
            id: nodeId,
            kind: 'shape',
            label: s.code,
            image: canvas.toDataURL()
        };
        nodeMap.set(nodeId, node);
        nodes.push(node);
    }

    // Operation nodes
    for (const op of graph.ops) {
        if (op.type === 'Belt Split') continue;

        const opId = op.id;
        const img = `images/operations/${op.type.toLowerCase().replace(/\s+/g,'-')}.png`;

        nodes.push({
            id: opId,
            kind: 'op',
            label: op.type,
            image: img
        });
    }

    // Edges
    for (const e of graph.edges) {
        links.push({
            source: e.source,
            target: e.target,
            kind:
                e.target.startsWith('op-') ? 'to-op' :
                e.source.startsWith('op-') ? 'from-op' :
                ''
        });
    }

    graph3dInstance = ForceGraph3D()(container)
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
            let sprite;

            if (node.kind === 'shape') {
                const tex = new THREE.TextureLoader().load(node.image, t => { t.colorSpace = THREE.SRGBColorSpace; t.premultiplyAlpha = false; });
                const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, premultipliedAlpha: false, depthTest: true, depthWrite: false, });
                sprite = new THREE.Sprite(mat);
                sprite.scale.set(15, 15, 1);
            } else {
                const tex = new THREE.TextureLoader().load(node.image, t => { t.colorSpace = THREE.SRGBColorSpace; t.premultiplyAlpha = false; });
                const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, premultipliedAlpha: false, depthTest: true, depthWrite: false, });
                sprite = new THREE.Sprite(mat);
                sprite.scale.set(12, 12, 1);
            }

            group.add(sprite);
            return group;
        })
        .nodeLabel(node => node.label);

    graph3dInstance.onNodeClick(node => {
        if (node.kind === 'shape') {
            navigator.clipboard.writeText(node.label).catch(() => {});
        }
    });

    return graph3dInstance;
}
