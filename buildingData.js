/**
 * @typedef {Object} IOPort
 * @property {'back'|'front'|'left'|'right'} side
 * @property {number} offset
 * @property {number} [floor]
 * @property {string} [label]
 */

/**
 * @typedef {Object} BuildingDef
 * @property {string} gameId           - Shapez 2 internal variant identifier for blueprint export
 * @property {number} width
 * @property {number} depth
 * @property {number} floors
 * @property {IOPort[]} inputs
 * @property {IOPort[]} outputs
 * @property {IOPort[]} [fluidInputs]
 * @property {number} [floorRestriction]
 */

/**
 * Building definitions keyed by solver operation name.
 * Dimensions are in tiles (width = left-right, depth = back-front).
 * Inputs enter from the back, outputs exit from the front, unless noted.
 * "Belt Split" is null — it's a belt mechanic, not a building.
 * @type {Object.<string, BuildingDef|null>}
 */
export const BUILDING_DATA = {
    "Rotator CW": {
        gameId: "RotatorOneQuadInternalVariant",
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0 }],
        outputs: [{ side: 'front', offset: 0 }]
    },
    "Rotator CCW": {
        gameId: "RotatorOneQuadCCWInternalVariant",
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0 }],
        outputs: [{ side: 'front', offset: 0 }]
    },
    "Rotator 180": {
        gameId: "RotatorHalfInternalVariant",
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0 }],
        outputs: [{ side: 'front', offset: 0 }]
    },
    "Half Destroyer": {
        gameId: "CutterHalfInternalVariant",
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0 }],
        outputs: [{ side: 'front', offset: 0 }]
    },
    "Cutter": {
        gameId: "CutterDefaultInternalVariant",
        width: 2,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0, label: 'shape' }],
        outputs: [
            { side: 'front', offset: 0, label: 'left half' },
            { side: 'front', offset: 1, label: 'right half' }
        ]
    },
    "Swapper": {
        gameId: "HalvesSwapperDefaultInternalVariant",
        width: 2,
        depth: 1,
        floors: 1,
        inputs: [
            { side: 'back', offset: 0, label: 'left' },
            { side: 'back', offset: 1, label: 'right' }
        ],
        outputs: [
            { side: 'front', offset: 0, label: 'left swapped' },
            { side: 'front', offset: 1, label: 'right swapped' }
        ]
    },
    "Stacker": {
        gameId: "StackerDefaultInternalVariant",
        width: 2,
        depth: 1,
        floors: 2,
        inputs: [
            { side: 'back', offset: 0, floor: 0, label: 'bottom' },
            { side: 'back', offset: 0, floor: 1, label: 'top' }
        ],
        outputs: [{ side: 'front', offset: 0, floor: 0 }]
    },
    "Painter": {
        gameId: "PainterDefaultInternalVariant",
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0, label: 'shape' }],
        outputs: [{ side: 'front', offset: 0 }],
        fluidInputs: [{ side: 'left', offset: 0, label: 'paint' }]
    },
    "Pin Pusher": {
        gameId: "PinPusherDefaultInternalVariant",
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0 }],
        outputs: [{ side: 'front', offset: 0 }]
    },
    "Crystal Generator": {
        gameId: "CrystalGeneratorDefaultInternalVariant",
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0, label: 'shape' }],
        outputs: [{ side: 'front', offset: 0 }],
        fluidInputs: [{ side: 'left', offset: 0, label: 'crystal fluid' }]
    },
    "Trash": {
        gameId: "TrashDefaultInternalVariant",
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0 }],
        outputs: [],
        floorRestriction: 0
    },
    "Belt Split": null
};
