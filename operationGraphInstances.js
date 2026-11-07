export let cyInstance = null;
export let graph3dInstance = null;

export function setCyInstance(instance) {
    cyInstance = instance;
}

export function setGraph3dInstance(instance) {
    graph3dInstance = instance;
}

export function destroy2DGraph() {
    if (cyInstance) {
        cyInstance.destroy();
        cyInstance = null;
    }
}

// The instance pauseSpaceGraph stopped, so resume restarts only a graph this
// module paused, and never one that replaced it in the meantime.
let pausedGraph3d = null;

export function destroySpaceGraph() {
    if (graph3dInstance) {
        graph3dInstance._destructor();
        graph3dInstance = null;
    }
    pausedGraph3d = null;
}

// The force layout ticks inside the render loop on the main thread; with a few
// thousand nodes it delays worker messages by seconds, so a job pauses it.
export function pauseSpaceGraph() {
    if (!graph3dInstance || pausedGraph3d) return;
    graph3dInstance.pauseAnimation();
    pausedGraph3d = graph3dInstance;
}

export function resumeSpaceGraph() {
    if (!pausedGraph3d) return;
    if (pausedGraph3d === graph3dInstance) pausedGraph3d.resumeAnimation();
    pausedGraph3d = null;
}
