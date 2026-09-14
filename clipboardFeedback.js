import { byId } from './domUtils.js';

// How long a clipboard outcome stays on #status before the text it replaced returns.
export const FLASH_MS = 2500;

// The flash currently on #status: { message, restoreText, timer }, or null.
let flash = null;

// Show `message` on #status, then put back what it replaced (typically the
// "Solved in …" summary). Anything that writes status in the meantime (a new
// solve, a worker error) owns the line, so the restore is skipped rather than
// clobbering it.
function flashStatus(message) {
    const status = byId('status');
    if (!status) return;
    let restoreText = status.textContent;
    if (flash) {
        clearTimeout(flash.timer);
        // Back-to-back copies restore the pre-flash text, not the earlier flash.
        if (restoreText === flash.message) restoreText = flash.restoreText;
    }
    const current = { message, restoreText, timer: null };
    current.timer = setTimeout(() => {
        if (flash !== current) return;
        flash = null;
        if (status.textContent === message) status.textContent = restoreText;
    }, FLASH_MS);
    flash = current;
    status.textContent = message;
}

function describeFailure(err) {
    // Chrome and Firefox both use NotAllowedError for "denied" and "document not focused".
    if (err?.name === 'NotAllowedError') return 'clipboard permission denied or the page was not focused';
    return String(err?.message || err || 'unknown error').replace(/\.$/, '');
}

export function reportCopyFailure(what, reason) {
    flashStatus(`Couldn't copy ${what}: ${reason}.`);
}

async function copyWith(what, write) {
    try {
        await write();
    } catch (err) {
        console.error(`Failed to copy ${what} to clipboard:`, err);
        reportCopyFailure(what, describeFailure(err));
        return false;
    }
    flashStatus(`Copied ${what} to clipboard.`);
    return true;
}

// navigator.clipboard is undefined outside secure contexts (plain http); name
// that instead of surfacing "cannot read properties of undefined".
function requireClipboard() {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard) throw new Error('the clipboard is unavailable (it needs an https page)');
    return clipboard;
}

export function copyText(text, what) {
    return copyWith(what, () => requireClipboard().writeText(text));
}

// `makeImage` returns a PNG Blob or a Promise of one. It is only called once the
// browser is known to support image copies, so no export work (or orphaned
// rejected promise) happens when the copy cannot succeed anyway. A null result —
// canvas.toBlob's failure signal — is reported as a failure.
export function copyImage(makeImage, what) {
    return copyWith(what, async () => {
        const clipboard = requireClipboard();
        if (typeof ClipboardItem === 'undefined') throw new Error('this browser cannot copy images');
        const blob = await makeImage();
        if (!blob) throw new Error('the image export produced no data');
        await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    });
}
