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

export function destroySpaceGraph() {
    if (graph3dInstance) {
        graph3dInstance._destructor();
        graph3dInstance = null;
    }
}
