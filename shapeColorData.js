// Shape and Color definitions with emoji mappings for manual selector

export const SHAPE_TYPES = [
    { char: 'C', name: 'Circle', emoji: '⭕', paintable: true },
    { char: 'R', name: 'Rectangle', emoji: '🟦', paintable: true },
    { char: 'S', name: 'Star', emoji: '⭐', paintable: true },
    { char: 'W', name: 'Diamond', emoji: '💎', paintable: true },
    { char: 'H', name: 'Hexagon', emoji: '⬡', paintable: true },
    { char: 'F', name: 'Flower', emoji: '🌸', paintable: true },
    { char: 'G', name: 'Gear', emoji: '⚙️', paintable: true },
    { char: 'X', name: 'Refined X', emoji: '✴️', paintable: false },   // 1.0 refined/exotic — does not recolor via Painter
    { char: 'Y', name: 'Refined Y', emoji: '🔷', paintable: false },   // 1.0 refined/exotic — does not recolor via Painter
    { char: 'P', name: 'Pin', emoji: '📍', paintable: false },
    { char: 'c', name: 'Crystal', emoji: '💠', paintable: true },
    { char: '-', name: 'Nothing', emoji: '⬜', paintable: false }
];

export const COLOR_TYPES = [
    { char: 'u', name: 'Uncolored', emoji: '⬜', cssColor: 'rgb(164,158,165)' },
    { char: 'r', name: 'Red', emoji: '🔴', cssColor: 'rgb(255,0,0)' },
    { char: 'g', name: 'Green', emoji: '🟢', cssColor: 'rgb(0,255,0)' },
    { char: 'b', name: 'Blue', emoji: '🔵', cssColor: 'rgb(67,110,223)' },
    { char: 'c', name: 'Cyan', emoji: '🩵', cssColor: 'rgb(0,255,255)' },
    { char: 'm', name: 'Magenta', emoji: '🩷', cssColor: 'rgb(255,0,255)' },
    { char: 'y', name: 'Yellow', emoji: '🟡', cssColor: 'rgb(255,255,0)' },
    { char: 'w', name: 'White', emoji: '⚪', cssColor: 'rgb(255,255,255)' },
    { char: 'k', name: 'Black', emoji: '⚫', cssColor: 'rgb(38,34,35)' }   // 1.0 color: made by white + white
];

export function getShapeInfo(char) {
    return SHAPE_TYPES.find(s => s.char === char) || SHAPE_TYPES[0];
}

export function getColorInfo(char) {
    return COLOR_TYPES.find(c => c.char === char) || COLOR_TYPES[0];
}
