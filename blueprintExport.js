/**
 * Blueprint Export Module
 *
 * Converts a BlueprintLayout into a Shapez 2 blueprint string
 * that can be pasted directly into the game with Ctrl+V.
 *
 * Format: SHAPEZ2-2-<base64(gzip(JSON))>$
 *
 * @module blueprintExport
 * @see docs/shapez-2-blueprint-reference.md
 */

import { BUILDING_DATA } from './buildingData.js';

// ---------------------------------------------------------------------------
// Belt kind → game building identifier
// ---------------------------------------------------------------------------

const BELT_TYPE_MAP = {
    normal:  "BeltDefaultForwardInternalVariant",
    split:   "Splitter1To2LInternalVariant",
    merge:   "Merger2To1LInternalVariant",
    lift:    "BeltDefaultForwardInternalVariant",
};

// Direction → rotation value (0=East, 1=South, 2=West, 3=North)
const DIR_TO_ROTATION = { E: 0, S: 1, W: 2, N: 3 };

// ---------------------------------------------------------------------------
// Export function
// ---------------------------------------------------------------------------

/**
 * Convert a BlueprintLayout to a Shapez 2 blueprint string.
 *
 * @param {import('./blueprintLayout.js').BlueprintLayout} layout
 * @returns {Promise<string>} Blueprint string: SHAPEZ2-2-<data>$
 */
export async function exportBlueprintString(layout) {
    const entries = [];

    // Add machines
    for (const machine of layout.machines) {
        const def = BUILDING_DATA[machine.operation];
        if (!def || !def.gameId) continue;

        const entry = {
            T: def.gameId,
            X: machine.x,
            Y: machine.y,
            R: 1, // all machines face South (inputs from North/back)
        };
        if (machine.floor > 0) entry.L = machine.floor;
        entries.push(entry);
    }

    // Add belts
    for (const belt of layout.belts) {
        const T = BELT_TYPE_MAP[belt.kind] || BELT_TYPE_MAP.normal;
        const entry = {
            T,
            X: belt.x,
            Y: belt.y,
            R: DIR_TO_ROTATION[belt.direction] ?? 1,
        };
        if (belt.floor > 0) entry.L = belt.floor;
        entries.push(entry);
    }

    const blueprint = {
        V: 1,
        BP: {
            $type: "Building",
            Entries: entries,
            Icon: { Data: [null, null, null, null] }
        }
    };

    return await encodeBlueprintString(blueprint);
}

// ---------------------------------------------------------------------------
// Encoding pipeline: JSON → gzip → base64 → SHAPEZ2-2-...$
// ---------------------------------------------------------------------------

/**
 * Encode a blueprint object into a SHAPEZ2-2 string.
 * @param {Object} blueprint
 * @returns {Promise<string>}
 */
async function encodeBlueprintString(blueprint) {
    const json = JSON.stringify(blueprint);

    // Gzip compress using CompressionStream API
    const blob = new Blob([json]);
    const cs = new CompressionStream('gzip');
    const compressedStream = blob.stream().pipeThrough(cs);
    const compressedBlob = await new Response(compressedStream).blob();
    const buffer = await compressedBlob.arrayBuffer();

    // Base64 encode
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    return `SHAPEZ2-2-${base64}$`;
}
