// Shape-code (de)serializer for the manual selector: parts <-> Shapez 2 code

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

export function createDefaultParts(numParts = 4) {
    return Array.from({ length: numParts }, () => ({ shape: 'C', color: 'u' }));
}
