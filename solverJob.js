import { byId } from './domUtils.js';

let solverWorker = null;
// The single button that currently owns the shared worker ({ btn, idleLabel }),
// or null when idle. Solve and Explore share one worker, so this — not the
// per-call `btn` closure, and never the button's label text — is the source of
// truth for which action is running. Label text is presentation only: routing a
// click off it would couple control flow to display copy (a label tweak or i18n
// would silently mis-route clicks). Tracking ownership here also lets a new job
// reset the OTHER action's button.
let activeJob = null;
// Monotonic generation for the shared worker slot. finishJob() bumps it so any
// already-queued main-thread message from a terminated worker is ignored even
// if its handler still runs after cancel/replace (classic multi-job race).
let jobGeneration = 0;

// True while `btn` owns the worker, i.e. a click on it means "cancel", not "start".
export const isJobRunning = (btn) => activeJob?.btn === btn;

// Reset whichever button owns the worker back to its idle label and tear the
// worker down. Called on every terminal outcome (cancel, result, error, crash)
// AND before starting a new job — so starting Explore mid-Solve (or vice versa)
// can never leave the other button stuck on 'Cancel'.
function finishJob() {
    // Invalidate first so a message already scheduled for this turn cannot land
    // after teardown and clobber status / graph / persisted solution.
    jobGeneration += 1;
    if (activeJob) {
        activeJob.btn.textContent = activeJob.idleLabel;
        activeJob = null;
    }
    if (solverWorker) {
        // Drop handlers before terminate so a late event has no listener to run
        // (generation still guards the case where a callback was already queued).
        solverWorker.onmessage = null;
        solverWorker.onerror = null;
        solverWorker.onmessageerror = null;
        solverWorker.terminate();
        solverWorker = null;
    }
}

// Stop the in-flight job and release the UI. The single cancel path: both click
// handlers route here when their button owns the worker.
export function cancelActiveJob() {
    if (solverWorker) solverWorker.postMessage({ action: 'cancel' });
    finishJob();
    byId('status').textContent = 'Cancelled.';
}

// Starts a job — never cancels one. Callers guard with isJobRunning() and route
// cancel clicks to cancelActiveJob() before gathering any inputs.
// `onResultError` resets whatever a throwing `onResult` half-drew; `onComplete`
// runs after any result (presented or failed) of a job that is still current.
export function runSolverJob({ btn, idleLabel, action, data, onResult, onResultError, onComplete, startStatus }) {
    const status = byId('status');

    // finishJob() resets any in-flight job's button (which must be the OTHER
    // action, since a click on this btn while it owns the worker was routed to
    // cancelActiveJob) and kills its worker before we spin up a fresh one.
    finishJob();
    // Capture after finishJob so this job owns the post-teardown generation.
    const jobId = jobGeneration;
    const isCurrent = () => jobId === jobGeneration;

    solverWorker = new Worker(new URL('./shapeSolver.js', import.meta.url), { type: 'module' });
    activeJob = { btn, idleLabel };

    solverWorker.onmessage = ({ data: msg }) => {
        if (!isCurrent()) return;
        const { type, message, result } = msg;

        if (type === 'status') {
            status.textContent = message;
            return;
        }

        if (type === 'error') {
            status.textContent = message;
            finishJob();
            return;
        }

        if (type === 'result') {
            try {
                onResult(result);
            } catch (err) {
                console.error('Failed to present the worker result:', err);
                if (isCurrent()) {
                    status.textContent = `Error: ${err.message}`;
                    // onResult may have drawn part of the new result before
                    // throwing (e.g. the flowchart but not the blueprint); the
                    // action resets what it owns so every view and the persisted
                    // solution agree again.
                    onResultError?.();
                }
            } finally {
                // Re-check after onResult: a nested cancel during the callback
                // (unlikely but cheap) must not persist a superseded solution.
                // The error path completes too, so a reload shows the cleared
                // state rather than resurrecting the solve it replaced.
                if (isCurrent()) {
                    finishJob();
                    onComplete?.();
                }
            }
        }
    };

    // A worker that throws before posting a terminal message (onerror) or sends
    // an undeserializable one (onmessageerror) still has to release the UI.
    solverWorker.onerror = (e) => {
        if (!isCurrent()) return;
        status.textContent = `Error: ${e.message || 'worker crashed'}`;
        finishJob();
    };
    solverWorker.onmessageerror = () => {
        if (!isCurrent()) return;
        status.textContent = 'Error: worker sent an unreadable message.';
        finishJob();
    };

    btn.textContent = 'Cancel';
    if (startStatus) status.textContent = startStatus;
    solverWorker.postMessage({ action, data });
}
