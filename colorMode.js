// Current color mode (RGB/RYB/CMYK) accessor. The mode is not cached in JS
// state — it lives live in the DOM <select id="color-mode-select">, so this
// reads it on every call (falling back to 'rgb' before the selector exists).
// Lives in its own module so the rendering layer (shapeRendering.js,
// operationGraph2D.js) can read the mode without importing main.js — main.js is
// the DOM entry point and wires document event handlers at evaluation time,
// which would otherwise pull document access into any module that imports it.
export function getCurrentColorMode() {
    return document.getElementById('color-mode-select')?.value || 'rgb';
}
