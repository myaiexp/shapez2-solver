const MACHINE_COLORS = {
    "Rotator CW":        "#4a90d9",
    "Rotator CCW":       "#4a90d9",
    "Rotator 180":       "#4a90d9",
    "Half Destroyer":    "#d94a4a",
    "Cutter":            "#d9a04a",
    "Swapper":           "#8b4ad9",
    "Stacker":           "#4ad98b",
    "Painter":           "#d94a8b",
    "Pin Pusher":        "#4ad9d9",
    "Crystal Generator": "#d9d94a",
    "Trash":             "#666666",
};

/**
 * Return the machine fill colour, falling back to a neutral grey.
 * @param {string} operation
 * @returns {string}
 */
export function machineColor(operation) {
    return MACHINE_COLORS[operation] ?? "#555555";
}

/**
 * Slightly darken a hex colour for the machine border.
 * @param {string} hex
 * @returns {string}
 */
export function darken(hex, amount = 0.3) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, ((n >> 16) & 0xff) * (1 - amount)) | 0;
    const g = Math.max(0, ((n >> 8)  & 0xff) * (1 - amount)) | 0;
    const b = Math.max(0, ( n        & 0xff) * (1 - amount)) | 0;
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
}
