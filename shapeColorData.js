// Shape and Color definitions with emoji mappings for manual selector

export const SHAPE_TYPES = [
    { char: 'C', name: 'Circle', emoji: '⭕', paintable: true },
    { char: 'R', name: 'Rectangle', emoji: '🟦', paintable: true },
    { char: 'S', name: 'Star', emoji: '⭐', paintable: true },
    { char: 'W', name: 'Diamond', emoji: '💎', paintable: true },
    { char: 'H', name: 'Hexagon', emoji: '⬡', paintable: true },
    { char: 'F', name: 'Flower', emoji: '🌸', paintable: true },
    { char: 'G', name: 'Gear', emoji: '⚙️', paintable: true },
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
    { char: 'w', name: 'White', emoji: '⚪', cssColor: 'rgb(255,255,255)' }
];

export function buildShapeCode(layers) {
    // layers: array of arrays, where each inner array contains {shape, color} objects
    // Returns shape code like "WuWuWuWu" or "Cu:Cu:Cu:Cu"
    if (!Array.isArray(layers) || layers.length === 0) {
        return '';
    }
    
    // Check if it's the new format (array of arrays of parts)
    if (Array.isArray(layers[0])) {
        // New format: layers is an array of arrays of {shape, color}
        return layers.map(layerParts =>
            layerParts.map(part => part.shape + part.color).join('')
        ).join(':');
    } else {
        // Old format for backward compatibility: shapeParts is a single array of parts
        return layers.map(part => part.shape + part.color).join('');
    }
}

export function parseShapeCode(shapeCode) {
    // Reverse of buildShapeCode
    const layers = shapeCode.split(':');
    return layers.map(layer => {
        const parts = [];
        for (let i = 0; i < layer.length; i += 2) {
            parts.push({
                shape: layer[i],
                color: layer[i + 1]
            });
        }
        return parts;
    });
}

export function getShapeInfo(char) {
    return SHAPE_TYPES.find(s => s.char === char) || SHAPE_TYPES[0];
}

export function getColorInfo(char) {
    return COLOR_TYPES.find(c => c.char === char) || COLOR_TYPES[0];
}

export function createDefaultParts(numParts = 4) {
    return Array.from({ length: numParts }, () => ({ shape: 'C', color: 'u' }));
}
