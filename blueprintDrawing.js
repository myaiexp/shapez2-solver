import { createShapeCanvas } from './shapeRendering.js';
import { machineColor, darken } from './blueprintColors.js';

export const TILE_SIZE = 48;

export const BG_COLOR = "#121212";

const BELT_COLOR         = "#666666";
const BELT_SPLIT_COLOR   = "#8888cc";
const BELT_MERGE_COLOR   = "#cc8844";
const BELT_LIFT_COLOR    = "#44aacc";
const GRID_LINE_COLOR    = "#1f1f1f";
const LABEL_COLOR        = "#e0e0e0";
const LABEL_FONT         = "600 11px 'Barlow', sans-serif";

/** Direction → Unicode arrow character */
const DIR_ARROW = { N: "\u25B2", S: "\u25BC", E: "\u25BA", W: "\u25C4" };

/**
 * Draw the full scene (grid + belts + machines) at the given pan/zoom.
 */
export function drawScene(ctx, layout, visibleMachines, visibleBelts, shapeIconCache, panX, panY, zoom) {
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    if (layout) {
        drawGrid(ctx, layout);
        drawBelts(ctx, visibleBelts, shapeIconCache);
        drawMachines(ctx, visibleMachines);
    }

    ctx.restore();
}

export function drawGrid(ctx, layout) {
    const gw = layout.gridWidth;
    const gh = layout.gridHeight;
    const totalW = gw * TILE_SIZE;
    const totalH = gh * TILE_SIZE;

    ctx.strokeStyle = GRID_LINE_COLOR;
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let x = 0; x <= gw; x++) {
        const px = x * TILE_SIZE;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, totalH);
    }
    for (let y = 0; y <= gh; y++) {
        const py = y * TILE_SIZE;
        ctx.moveTo(0, py);
        ctx.lineTo(totalW, py);
    }
    ctx.stroke();
}

export function drawBelts(ctx, visibleBelts, shapeIconCache) {
    for (const belt of visibleBelts) {
        const cx = belt.x * TILE_SIZE + TILE_SIZE / 2;
        const cy = belt.y * TILE_SIZE + TILE_SIZE / 2;

        // Background tile
        let bgColor;
        if (belt.kind === "split") {
            bgColor = BELT_SPLIT_COLOR;
        } else if (belt.kind === "merge") {
            bgColor = BELT_MERGE_COLOR;
        } else if (belt.kind === "lift") {
            bgColor = BELT_LIFT_COLOR;
        } else {
            bgColor = BELT_COLOR;
        }

        ctx.fillStyle = bgColor;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(belt.x * TILE_SIZE + 1, belt.y * TILE_SIZE + 1,
                     TILE_SIZE - 2, TILE_SIZE - 2);
        ctx.globalAlpha = 1.0;

        // Arrow character
        const arrow = DIR_ARROW[belt.direction] ?? "?";
        ctx.fillStyle = bgColor;
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(arrow, cx, cy);

        // Fork / join / lift icon for special belt types
        if (belt.kind === "split") {
            ctx.fillStyle = BELT_SPLIT_COLOR;
            ctx.font = "bold 10px sans-serif";
            ctx.fillText("SPL", cx, cy + 14);
        } else if (belt.kind === "merge") {
            ctx.fillStyle = BELT_MERGE_COLOR;
            ctx.font = "bold 10px sans-serif";
            ctx.fillText("MRG", cx, cy + 14);
        } else if (belt.kind === "lift") {
            ctx.fillStyle = BELT_LIFT_COLOR;
            ctx.font = "bold 10px sans-serif";
            ctx.fillText("\u21C5", cx, cy + 14); // ⇅ up-down arrow
        }

        // Shape icon on belt tile
        if (belt.shapeCode) {
            let icon = shapeIconCache.get(belt.shapeCode);
            if (!icon) {
                try {
                    icon = createShapeCanvas(belt.shapeCode, 20);
                    shapeIconCache.set(belt.shapeCode, icon);
                } catch {
                    // Skip rendering if shape code is invalid
                }
            }
            if (icon) {
                ctx.globalAlpha = 0.85;
                ctx.drawImage(icon, cx - 10, cy - 20, 20, 20);
                ctx.globalAlpha = 1.0;
            }
        }
    }
}

export function drawMachines(ctx, visibleMachines) {
    for (const machine of visibleMachines) {
        const w = (machine.def?.width  ?? 1) * TILE_SIZE;
        const h = (machine.def?.depth  ?? 1) * TILE_SIZE;
        const px = machine.x * TILE_SIZE;
        const py = machine.y * TILE_SIZE;

        const fill = machineColor(machine.operation);

        // Filled rectangle
        ctx.fillStyle = fill;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(px + 2, py + 2, w - 4, h - 4);
        ctx.globalAlpha = 1.0;

        // Border
        ctx.strokeStyle = darken(fill, 0.15);
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 2, py + 2, w - 4, h - 4);

        // Label (operation name)
        ctx.fillStyle = LABEL_COLOR;
        ctx.font = LABEL_FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.7)";
        ctx.shadowBlur = 3;
        ctx.fillText(machine.operation, px + w / 2, py + h / 2, w - 8);
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;

        // Input/output port indicators (small squares)
        drawPorts(ctx, machine, px, py, w, h);
    }
}

/**
 * Draw small port indicators on the edges of a machine rectangle.
 */
function drawPorts(ctx, machine, px, py, w, h) {
    const portSize = 6;
    const drawPort = (port, color, index, total) => {
        ctx.fillStyle = color;
        const side = port.side || 'back';
        let cx, cy;
        if (side === 'back') {
            // Top edge — inputs enter from the back
            const step = w / (total + 1);
            cx = px + step * (index + 1);
            cy = py;
        } else if (side === 'front') {
            // Bottom edge — outputs exit from the front
            const step = w / (total + 1);
            cx = px + step * (index + 1);
            cy = py + h;
        } else if (side === 'left') {
            const step = h / (total + 1);
            cx = px;
            cy = py + step * (index + 1);
        } else {
            const step = h / (total + 1);
            cx = px + w;
            cy = py + step * (index + 1);
        }
        ctx.fillRect(cx - portSize / 2, cy - portSize / 2, portSize, portSize);
    };

    const inputs = machine.def?.inputs ?? [];
    for (let i = 0; i < inputs.length; i++) {
        drawPort(inputs[i], "#44cc44", i, inputs.length);
    }
    const outputs = machine.def?.outputs ?? [];
    for (let i = 0; i < outputs.length; i++) {
        drawPort(outputs[i], "#cc4444", i, outputs.length);
    }
    // Fluid input ports (Painter paint, Crystal Generator fluid)
    const fluidInputs = machine.def?.fluidInputs ?? [];
    for (let i = 0; i < fluidInputs.length; i++) {
        drawPort(fluidInputs[i], "#4488cc", i, fluidInputs.length);
    }
}
