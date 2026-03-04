/**
 * @typedef {Object} IOPort
 * @property {'back'|'front'|'left'|'right'} side
 * @property {number} offset
 * @property {number} [floor]
 * @property {string} [label]
 */

/**
 * @typedef {Object} BuildingDef
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
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0 }],
        outputs: [{ side: 'front', offset: 0 }]
    },
    "Rotator CCW": {
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0 }],
        outputs: [{ side: 'front', offset: 0 }]
    },
    "Rotator 180": {
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0 }],
        outputs: [{ side: 'front', offset: 0 }]
    },
    "Half Destroyer": {
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0 }],
        outputs: [{ side: 'front', offset: 0 }]
    },
    "Cutter": {
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
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0, label: 'shape' }],
        outputs: [{ side: 'front', offset: 0 }],
        fluidInputs: [{ side: 'left', offset: 0, label: 'paint' }]
    },
    "Pin Pusher": {
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0 }],
        outputs: [{ side: 'front', offset: 0 }]
    },
    "Crystal Generator": {
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0, label: 'shape' }],
        outputs: [{ side: 'front', offset: 0 }],
        fluidInputs: [{ side: 'left', offset: 0, label: 'crystal fluid' }]
    },
    "Trash": {
        width: 1,
        depth: 1,
        floors: 1,
        inputs: [{ side: 'back', offset: 0 }],
        outputs: [],
        floorRestriction: 0
    },
    "Belt Split": null
};
