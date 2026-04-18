export const PURE_OP_CHECKS = [
    { name: 'cut-CuCuCuCu', op: 'cut', shapeArgs: ['CuCuCuCu'] },
    { name: 'stack-CuCuCuCu+RuRuRuRu', op: 'stack', shapeArgs: ['CuCuCuCu', 'RuRuRuRu'] },
    { name: 'rotate90CW-CuRuSuWu', op: 'rotate90CW', shapeArgs: ['CuRuSuWu'] },
    { name: 'getSimilarity-CuCu+RuRu', op: '_getSimilarity', shapeArgs: ['CuCuCuCu', 'RuRuRuRu'] },
];

const baseSolverParams = {
    maxLayers: 4,
    maxStatesPerLevel: 1000,
    preventWaste: false,
    orientationSensitive: false,
    monolayerPainting: false,
    heuristicDivisor: 0.1,
};

export const SOLVER_FIXTURES = [
    {
        name: 'simple-cut',
        target: 'CuCu----',
        starting: ['CuCuCuCu'],
        ops: ['Cutter'],
        method: 'BFS',
        ...baseSolverParams,
    },
    {
        name: 'rotate-astar',
        target: 'CuRuCuRu',
        starting: ['RuCuRuCu'],
        ops: ['Rotator CW'],
        method: 'A*',
        ...baseSolverParams,
        orientationSensitive: true,
    },
    {
        name: 'stack-astar',
        target: 'CuCuCuCu:RuRuRuRu',
        starting: ['CuCuCuCu', 'RuRuRuRu'],
        ops: ['Stacker'],
        method: 'A*',
        ...baseSolverParams,
    },
    {
        name: 'paint-astar',
        target: 'CrCrCrCr',
        starting: ['CuCuCuCu'],
        ops: ['Painter'],
        method: 'A*',
        ...baseSolverParams,
    },
    {
        name: 'cut-stack-astar',
        target: 'CuCu----:RuRu----',
        starting: ['CuCuCuCu', 'RuRuRuRu'],
        ops: ['Cutter', 'Stacker'],
        method: 'A*',
        ...baseSolverParams,
    },
    {
        name: 'rotate-ida',
        target: 'CuRuCuRu',
        starting: ['RuCuRuCu'],
        ops: ['Rotator CW'],
        method: 'IDA*',
        ...baseSolverParams,
        orientationSensitive: true,
    },
];

export const LAYOUT_FIXTURES = [
    {
        name: 'simple-cut-stack',
        solutionPath: [
            {
                operation: 'Cutter',
                inputs: [{ id: 'src', shape: 'CuCuCuCu' }],
                outputs: [{ id: 'L', shape: 'CuCu----' }, { id: 'R', shape: '----CuCu' }],
                params: {}
            },
            {
                operation: 'Stacker',
                inputs: [{ id: 'L', shape: 'CuCu----' }, { id: 'R', shape: '----CuCu' }],
                outputs: [{ id: 'final', shape: 'CuCuCuCu:CuCuCuCu' }],
                params: {}
            },
        ]
    },
];
