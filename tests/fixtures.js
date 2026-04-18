export const PURE_OP_CHECKS = [
    { name: 'cut-CuCuCuCu', op: 'cut', shapeArgs: ['CuCuCuCu'] },
    { name: 'stack-CuCuCuCu+RuRuRuRu', op: 'stack', shapeArgs: ['CuCuCuCu', 'RuRuRuRu'] },
    { name: 'rotate90CW-CuRuSuWu', op: 'rotate90CW', shapeArgs: ['CuRuSuWu'] },
    { name: 'getSimilarity-CuCu+RuRu', op: '_getSimilarity', shapeArgs: ['CuCuCuCu', 'RuRuRuRu'] },
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
