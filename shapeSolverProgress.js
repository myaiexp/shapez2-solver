// Progress cadence for a long search. `due` says when to report; `emit` posts the
// report and yields, because a worker only reads its 'cancel' message between
// macrotasks. They are separate so a hot loop builds no message and awaits nothing
// on the iterations that don't report.
//
// due(count) is true on a multiple of everyN, or once intervalMs has passed since
// the last emit. due() with no count goes by the clock alone.
export function createPulse(onProgress, { everyN = Infinity, intervalMs = 200 } = {}) {
    let lastEmit = performance.now();
    return {
        due(count) {
            return count % everyN === 0 || performance.now() - lastEmit > intervalMs;
        },
        async emit(message) {
            onProgress(message);
            lastEmit = performance.now();
            await new Promise((resolve) => setTimeout(resolve, 0));
        },
    };
}
