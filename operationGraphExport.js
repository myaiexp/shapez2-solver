import { cyInstance } from './operationGraph2D.js';
import { graph3dInstance } from './operationGraphSpace.js';

export async function copyGraphToClipboard() {
    // --- 2D GRAPH (Cytoscape) ---
    if (cyInstance) {
        const graphImage = cyInstance.png({
            output: 'blob',
            scale: 1,
            full: true
        });

        try {
            const clipboardItem = new ClipboardItem({ 'image/png': graphImage });
            await navigator.clipboard.write([clipboardItem]);
            alert('Graph image copied to clipboard!');
        } catch (error) {
            console.error('Failed to copy image to clipboard:', error);
            alert('Failed to copy image to clipboard.');
        }

        return;
    }

    // --- 3D GRAPH (ForceGraph3D) ---
    if (graph3dInstance) {
        const renderer = graph3dInstance.renderer();
        const canvas = renderer.domElement;

        renderer.render(graph3dInstance.scene(), graph3dInstance.camera());

        canvas.toBlob(async blob => {
            if (!blob) {
                alert('Failed to export 3D graph.');
                return;
            }

            try {
                const item = new ClipboardItem({ 'image/png': blob });
                await navigator.clipboard.write([item]);
                alert('Graph image copied to clipboard!');
            } catch (err) {
                console.error('Failed to copy 3D image:', err);
                alert('Failed to copy image to clipboard.');
            }
        }, 'image/png');

        return;
    }

    alert('No graph to copy.');
}
