import { cyInstance, graph3dInstance } from './operationGraphInstances.js';
import { copyImage, reportCopyFailure } from './clipboardFeedback.js';

export function copyGraphToClipboard() {
    // --- 2D GRAPH (Cytoscape) ---
    if (cyInstance) {
        const cy = cyInstance;
        return copyImage(() => cy.png({ output: 'blob', scale: 1, full: true }), 'graph image');
    }

    // --- 3D GRAPH (ForceGraph3D) ---
    if (graph3dInstance) {
        const g3d = graph3dInstance;
        return copyImage(() => {
            const renderer = g3d.renderer();
            // The WebGL buffer is cleared after each composite, so draw a frame in
            // the same task as toBlob or the capture comes back blank.
            renderer.render(g3d.scene(), g3d.camera());
            return new Promise((resolve) => renderer.domElement.toBlob(resolve, 'image/png'));
        }, 'graph image');
    }

    reportCopyFailure('graph image', 'there is no graph yet');
    return Promise.resolve(false);
}
