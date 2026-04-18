/**
 * Blueprint Canvas Renderer
 *
 * Renders a BlueprintLayout (machine placements + belt routing) onto an
 * HTML5 Canvas with pan, zoom, and hover-tooltip interactivity.
 *
 * @module blueprintRenderer
 */

import { drawScene, TILE_SIZE, BG_COLOR } from './blueprintDrawing.js';

const TOOLTIP_BG         = "rgba(30, 30, 30, 0.95)";
const TOOLTIP_BORDER     = "#555";
const TOOLTIP_TEXT_COLOR  = "#e0e0e0";
const TOOLTIP_FONT       = "13px 'Barlow', sans-serif";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5.0;

export class BlueprintRenderer {
    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas) {
        /** @type {HTMLCanvasElement} */
        this._canvas = canvas;
        /** @type {CanvasRenderingContext2D} */
        this._ctx = canvas.getContext("2d");

        // Layout data (set via setLayout)
        /** @type {import('./blueprintLayout.js').BlueprintLayout|null} */
        this._layout = null;

        // View state
        /** @readonly */
        this.currentFloor = 0;
        this._zoom = 1.0;
        this._panX = 0;
        this._panY = 0;

        // Drag state
        this._dragging = false;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._panStartX = 0;
        this._panStartY = 0;

        // Tooltip element (created lazily)
        /** @type {HTMLDivElement|null} */
        this._tooltip = null;

        // Filtered data for current floor (cached on setFloor / setLayout)
        /** @type {PlacedMachine[]} */
        this._visibleMachines = [];
        /** @type {PlacedBelt[]} */
        this._visibleBelts = [];

        // Shape icon cache (cleared on setLayout)
        this._shapeIconCache = new Map();

        // Bind handlers so we can remove them later
        this._onWheel      = this._handleWheel.bind(this);
        this._onMouseDown   = this._handleMouseDown.bind(this);
        this._onMouseMove   = this._handleMouseMove.bind(this);
        this._onMouseUp     = this._handleMouseUp.bind(this);
        this._onMouseLeave  = this._handleMouseLeave.bind(this);

        // Attach events
        this._canvas.addEventListener("wheel", this._onWheel, { passive: false });
        this._canvas.addEventListener("mousedown", this._onMouseDown);
        this._canvas.addEventListener("mousemove", this._onMouseMove);
        this._canvas.addEventListener("mouseup", this._onMouseUp);
        this._canvas.addEventListener("mouseleave", this._onMouseLeave);

        // Resize handling via ResizeObserver on the canvas parent
        this._resizeObserver = new ResizeObserver(() => this._handleResize());
        const parent = this._canvas.parentElement;
        if (parent) {
            this._resizeObserver.observe(parent);
        }

        // Initial sizing and cursor
        this._canvas.style.cursor = "grab";
        this._handleResize();
        this._render();
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /**
     * Supply a new layout to render.
     * @param {BlueprintLayout} layout
     */
    setLayout(layout) {
        this._layout = layout;
        this.currentFloor = 0;
        this._shapeIconCache = new Map();
        this._filterFloor();
        this._centerView();
        this._render();
    }

    /**
     * Switch to a different floor.  No-op if out of range.
     * @param {number} floorIndex
     */
    setFloor(floorIndex) {
        if (!this._layout) return;
        if (floorIndex < 0 || floorIndex >= this._layout.floorCount) return;
        this.currentFloor = floorIndex;
        this._filterFloor();
        this._render();
    }

    /**
     * Export the full layout (all visible-floor tiles, not just the viewport)
     * as a PNG Blob at 1:1 scale (TILE_SIZE px per tile).
     * @returns {Promise<Blob>}
     */
    exportPng() {
        return new Promise((resolve, reject) => {
            if (!this._layout) {
                reject(new Error("No layout to export"));
                return;
            }

            const w = this._layout.gridWidth  * TILE_SIZE;
            const h = this._layout.gridHeight * TILE_SIZE;

            const offscreen = document.createElement("canvas");
            offscreen.width  = w;
            offscreen.height = h;
            const ctx = offscreen.getContext("2d");

            // Fill background, then draw at 1:1 with no pan/zoom
            ctx.fillStyle = BG_COLOR;
            ctx.fillRect(0, 0, w, h);
            drawScene(ctx, this._layout, this._visibleMachines, this._visibleBelts, this._shapeIconCache, 0, 0, 1);

            offscreen.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error("toBlob returned null"));
            }, "image/png");
        });
    }

    /**
     * Tear down: remove listeners, tooltip, null references.
     */
    destroy() {
        this._canvas.removeEventListener("wheel", this._onWheel);
        this._canvas.removeEventListener("mousedown", this._onMouseDown);
        this._canvas.removeEventListener("mousemove", this._onMouseMove);
        this._canvas.removeEventListener("mouseup", this._onMouseUp);
        this._canvas.removeEventListener("mouseleave", this._onMouseLeave);

        this._resizeObserver.disconnect();

        if (this._tooltip && this._tooltip.parentElement) {
            this._tooltip.parentElement.removeChild(this._tooltip);
        }

        this._tooltip = null;
        this._layout = null;
        this._ctx = null;
        this._canvas = null;
    }

    // ------------------------------------------------------------------
    // Resize
    // ------------------------------------------------------------------

    _handleResize() {
        if (!this._canvas) return;
        const parent = this._canvas.parentElement;
        if (!parent) return;

        const rect = parent.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // CSS size fills parent
        this._canvas.style.width  = rect.width  + "px";
        this._canvas.style.height = rect.height + "px";

        // Backing store at device resolution
        this._canvas.width  = Math.round(rect.width  * dpr);
        this._canvas.height = Math.round(rect.height * dpr);

        this._render();
    }

    // ------------------------------------------------------------------
    // Floor filtering
    // ------------------------------------------------------------------

    _filterFloor() {
        if (!this._layout) {
            this._visibleMachines = [];
            this._visibleBelts = [];
            return;
        }
        this._visibleMachines = this._layout.machines.filter(
            (m) => m.floor === this.currentFloor
        );
        this._visibleBelts = this._layout.belts.filter(
            (b) => b.floor === this.currentFloor
        );
    }

    // ------------------------------------------------------------------
    // View helpers
    // ------------------------------------------------------------------

    /** Center the view on the grid content. */
    _centerView() {
        if (!this._layout || !this._canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const cw = this._canvas.width  / dpr;
        const ch = this._canvas.height / dpr;
        const gw = this._layout.gridWidth  * TILE_SIZE;
        const gh = this._layout.gridHeight * TILE_SIZE;

        // Fit the grid on screen with a small margin
        const scaleX = (cw * 0.9) / gw;
        const scaleY = (ch * 0.9) / gh;
        this._zoom = Math.min(scaleX, scaleY, MAX_ZOOM);
        this._zoom = Math.max(this._zoom, MIN_ZOOM);

        this._panX = (cw - gw * this._zoom) / 2;
        this._panY = (ch - gh * this._zoom) / 2;
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    _render() {
        if (!this._ctx || !this._canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const cw = this._canvas.width  / dpr;
        const ch = this._canvas.height / dpr;

        const ctx = this._ctx;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // reset to DPR-scaled identity

        // Clear
        ctx.fillStyle = BG_COLOR;
        ctx.fillRect(0, 0, cw, ch);

        // Apply pan + zoom and draw the scene
        drawScene(ctx, this._layout, this._visibleMachines, this._visibleBelts, this._shapeIconCache, this._panX, this._panY, this._zoom);

        ctx.restore();
    }

    // ------------------------------------------------------------------
    // Interaction – Zoom
    // ------------------------------------------------------------------

    _handleWheel(e) {
        e.preventDefault();
        if (!this._canvas) return;

        const rect = this._canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const oldZoom = this._zoom;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this._zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this._zoom * factor));

        // Adjust pan so the point under the cursor stays fixed
        const zoomRatio = this._zoom / oldZoom;
        this._panX = mouseX - (mouseX - this._panX) * zoomRatio;
        this._panY = mouseY - (mouseY - this._panY) * zoomRatio;

        this._render();
    }

    // ------------------------------------------------------------------
    // Interaction – Pan (drag)
    // ------------------------------------------------------------------

    _handleMouseDown(e) {
        if (e.button !== 0) return; // left button only
        this._dragging = true;
        this._dragStartX = e.clientX;
        this._dragStartY = e.clientY;
        this._panStartX = this._panX;
        this._panStartY = this._panY;
        this._canvas.style.cursor = "grabbing";
    }

    _handleMouseUp(_e) {
        this._dragging = false;
        if (this._canvas) this._canvas.style.cursor = "grab";
    }

    _handleMouseLeave(_e) {
        this._dragging = false;
        if (this._canvas) this._canvas.style.cursor = "grab";
        this._hideTooltip();
    }

    _handleMouseMove(e) {
        if (this._dragging) {
            this._panX = this._panStartX + (e.clientX - this._dragStartX);
            this._panY = this._panStartY + (e.clientY - this._dragStartY);
            this._render();
            this._hideTooltip();
            return;
        }

        // Hover detection
        this._updateTooltip(e);
    }

    // ------------------------------------------------------------------
    // Tooltip
    // ------------------------------------------------------------------

    _ensureTooltip() {
        if (this._tooltip) return;
        this._tooltip = document.createElement("div");
        Object.assign(this._tooltip.style, {
            position:        "absolute",
            pointerEvents:   "none",
            background:      TOOLTIP_BG,
            color:           TOOLTIP_TEXT_COLOR,
            font:            TOOLTIP_FONT,
            padding:         "8px 12px",
            borderRadius:    "6px",
            border:          `1px solid ${TOOLTIP_BORDER}`,
            zIndex:          "100",
            maxWidth:        "320px",
            whiteSpace:      "pre-wrap",
            display:         "none",
            lineHeight:      "1.5",
            boxShadow:       "0 4px 12px rgba(0,0,0,0.5)",
        });
        // Append to blueprint-view so positioning stays within that container
        const parent = this._canvas?.parentElement;
        if (parent) {
            parent.appendChild(this._tooltip);
        } else {
            document.body.appendChild(this._tooltip);
        }
    }

    _hideTooltip() {
        if (this._tooltip) this._tooltip.style.display = "none";
    }

    /**
     * Convert client-space mouse position to grid coordinates, check for a
     * machine hit, and show / hide the tooltip accordingly.
     */
    _updateTooltip(e) {
        if (!this._canvas || !this._layout) {
            this._hideTooltip();
            return;
        }

        const rect = this._canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Convert to world (grid) space
        const worldX = (mouseX - this._panX) / this._zoom;
        const worldY = (mouseY - this._panY) / this._zoom;

        const gridCol = Math.floor(worldX / TILE_SIZE);
        const gridRow = Math.floor(worldY / TILE_SIZE);

        // Find a machine whose bounding box covers this tile
        const hit = this._visibleMachines.find((m) => {
            const mw = m.def?.width ?? 1;
            const md = m.def?.depth ?? 1;
            return (
                gridCol >= m.x && gridCol < m.x + mw &&
                gridRow >= m.y && gridRow < m.y + md
            );
        });

        if (!hit) {
            this._hideTooltip();
            return;
        }

        this._ensureTooltip();

        // Build tooltip content
        const lines = [hit.operation];

        if (hit.inputShapes && hit.inputShapes.length > 0) {
            lines.push(`In:  ${hit.inputShapes.join(", ")}`);
        }
        if (hit.outputShapes && hit.outputShapes.length > 0) {
            lines.push(`Out: ${hit.outputShapes.join(", ")}`);
        }
        if (hit.params) {
            const entries = Object.entries(hit.params);
            if (entries.length > 0) {
                lines.push(entries.map(([k, v]) => `${k}: ${v}`).join(", "));
            }
        }

        this._tooltip.textContent = lines.join("\n");
        this._tooltip.style.display = "block";

        // Position near cursor, clamp within the parent container
        const parentRect = (this._canvas.parentElement ?? this._canvas).getBoundingClientRect();
        let tipX = e.clientX - parentRect.left + 14;
        let tipY = e.clientY - parentRect.top  + 14;

        // Clamp so tooltip doesn't overflow right / bottom
        const tipW = this._tooltip.offsetWidth;
        const tipH = this._tooltip.offsetHeight;
        if (tipX + tipW > parentRect.width - 8) {
            tipX = e.clientX - parentRect.left - tipW - 8;
        }
        if (tipY + tipH > parentRect.height - 8) {
            tipY = e.clientY - parentRect.top - tipH - 8;
        }

        this._tooltip.style.left = tipX + "px";
        this._tooltip.style.top  = tipY + "px";
    }
}
