export const PURE_OP_CHECKS = [
    { name: 'cut-CuCuCuCu', op: 'cut', shapeArgs: ['CuCuCuCu'] },
    { name: 'stack-CuCuCuCu+RuRuRuRu', op: 'stack', shapeArgs: ['CuCuCuCu', 'RuRuRuRu'] },
    { name: 'rotate90CW-CuRuSuWu', op: 'rotate90CW', shapeArgs: ['CuRuSuWu'] },
    { name: 'getSimilarity-CuCu+RuRu', op: '_getSimilarity', shapeArgs: ['CuCuCuCu', 'RuRuRuRu'] },
    // 1.0 refined shape X support (basic structural ops should be generic)
    { name: 'cut-XuXuXuXu', op: 'cut', shapeArgs: ['XuXuXuXu'] },
    // 1.0 Black (k) color: parses and survives structural ops
    { name: 'cut-CkCkCkCk', op: 'cut', shapeArgs: ['CkCkCkCk'] },
];

const baseSolverParams = {
    maxLayers: 4,
    maxStatesPerLevel: 1000,
    preventWaste: false,
    orientationSensitive: false,
    monolayerPainting: false,
    heuristicDivisor: 0.1,
    // Hard ceiling on distinct states so a fixture can never OOM helm's cgroup
    // (smoke.js otherwise runs the solver uncapped). All fixtures here solve in
    // well under a hundred states; this is purely a runaway-search backstop.
    maxStates: 100000,
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
    // 1.0: basic production of a refined (X) shape target
    {
        name: 'refined-x-cut',
        target: 'XuXu----',
        starting: ['XuXuXuXu'],
        ops: ['Cutter'],
        method: 'BFS',
        ...baseSolverParams,
    },
    // 1.0: paint a shape Black (k) — proves the new color solves end-to-end
    {
        name: 'paint-black-astar',
        target: 'CkCkCkCk',
        starting: ['CuCuCuCu'],
        ops: ['Painter'],
        method: 'A*',
        ...baseSolverParams,
    },
    // #2210: the Bidirectional search method had no fixture. These two exercise it
    // end-to-end — building the backward reachability map and the forward A* that
    // consumes it. A trivial 1-op stack, and a 3-op cut+stack so the forward loop
    // runs over several states. (cut+stack is orientation-sensitive so the final
    // code equals the target exactly rather than a rotation-equivalent of it.)
    {
        name: 'bidi-stack',
        target: 'CuCuCuCu:RuRuRuRu',
        starting: ['CuCuCuCu', 'RuRuRuRu'],
        ops: ['Stacker'],
        method: 'Bidirectional',
        ...baseSolverParams,
    },
    {
        name: 'bidi-cut-stack',
        target: 'CuCu----:RuRu----',
        starting: ['CuCuCuCu', 'RuRuRuRu'],
        ops: ['Cutter', 'Stacker'],
        method: 'Bidirectional',
        ...baseSolverParams,
        orientationSensitive: true,
    },
    // #2211: no fixture exercised preventWaste + monolayerPainting together.
    // (a) Solvable happy-path where monolayerPainting is pivotal: the only paint
    //     is on a single-layer shape (CuCu----), so if that branch wrongly blocked
    //     monolayer paints the target would become unsolvable. Both starting
    //     shapes are consumed by the stack, so preventWaste's all-shapes-acceptable
    //     goal is satisfied with no leftover.
    {
        name: 'prevent-waste-monolayer-paint',
        target: 'CrCr----:CuCu----',
        starting: ['CuCu----', 'CuCu----'],
        ops: ['Painter', 'Stacker'],
        method: 'A*',
        ...baseSolverParams,
        preventWaste: true,
        monolayerPainting: true,
    },
    // (b) preventWaste is pivotal here, so the expected result is NO solution
    //     (numOps/depth/finalShapeCode all null). Cutting CuRuSuWu yields
    //     CuRu---- (the target) plus ----SuWu, and ----SuWu is NOT a rotation of
    //     the target, so it is genuine waste. Trash produces no successor and the
    //     only op is Cutter, so the waste half can never be removed — with
    //     preventWaste on, the all-acceptable goal is unreachable. Without the
    //     flag this same cut would solve in 1 op (cf. the simple-cut fixture),
    //     so this guards the preventWaste branch of isGoal.
    {
        name: 'prevent-waste-blocks-waste',
        target: 'CuRu----',
        starting: ['CuRuSuWu'],
        ops: ['Cutter'],
        method: 'BFS',
        ...baseSolverParams,
        preventWaste: true,
        monolayerPainting: true,
    },
];

export const EXPLORER_FIXTURES = [
    {
        name: 'small-explore',
        starting: ['CuCuCuCu', 'RuRuRuRu'],
        ops: ['Cutter', 'Rotator CW'],
        depthLimit: 2,
        maxLayers: 4,
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
    // #2214: BlueprintLayout was only covered by the trivial two-step fixture above.
    // The three below exercise the layout paths it never reached.

    // A 3-row graph that both branches and merges, plus a Painter step carrying
    // params (color): the Cutter feeds two downstream machines (its L half goes to
    // the Painter, its R half straight to the Stacker), and the Stacker merges the
    // painted half with the raw half.
    {
        name: 'cut-paint-stack',
        solutionPath: [
            {
                operation: 'Cutter',
                inputs: [{ id: 'src', shape: 'CuCuCuCu' }],
                outputs: [{ id: 'L', shape: 'CuCu----' }, { id: 'R', shape: '----CuCu' }],
                params: {}
            },
            {
                operation: 'Painter',
                inputs: [{ id: 'L', shape: 'CuCu----' }],
                outputs: [{ id: 'P', shape: 'CrCr----' }],
                params: { color: 'r' }
            },
            {
                operation: 'Stacker',
                inputs: [{ id: 'P', shape: 'CrCr----' }, { id: 'R', shape: '----CuCu' }],
                outputs: [{ id: 'F', shape: 'CrCr----:----CuCu' }],
                params: {}
            },
        ]
    },

    // Belt Split topology: the splitter is a pass-through (excluded from placed
    // machines) and its two copies must resolve back through it to the source
    // shape. One copy is rotated, then both are stacked — exercising the
    // resolveProducer / findDownstreamPlaceable Belt Split handling.
    {
        name: 'belt-split-passthrough',
        solutionPath: [
            {
                operation: 'Belt Split',
                inputs: [{ id: 'src', shape: 'CuRuSuWu' }],
                outputs: [{ id: 'd1', shape: 'CuRuSuWu' }, { id: 'd2', shape: 'CuRuSuWu' }],
                params: {}
            },
            {
                operation: 'Rotator CW',
                inputs: [{ id: 'd1', shape: 'CuRuSuWu' }],
                outputs: [{ id: 'r1', shape: 'WuCuRuSu' }],
                params: {}
            },
            {
                operation: 'Stacker',
                inputs: [{ id: 'r1', shape: 'WuCuRuSu' }, { id: 'd2', shape: 'CuRuSuWu' }],
                outputs: [{ id: 'F', shape: 'WuCuRuSu:CuRuSuWu' }],
                params: {}
            },
        ]
    },

    // Multiple source shapes and two independent chains that converge: one chain
    // stacks two sources then paints the result, the other cuts a third source;
    // a final Stacker merges them. Produces a wider, deeper grid (more rows and
    // columns) than any other fixture, and leaves an unused terminal output.
    {
        name: 'multi-source-deep',
        solutionPath: [
            {
                operation: 'Stacker',
                inputs: [{ id: 'a', shape: 'CuCuCuCu' }, { id: 'b', shape: 'RuRuRuRu' }],
                outputs: [{ id: 's1', shape: 'CuCuCuCu:RuRuRuRu' }],
                params: {}
            },
            {
                operation: 'Painter',
                inputs: [{ id: 's1', shape: 'CuCuCuCu:RuRuRuRu' }],
                outputs: [{ id: 'p1', shape: 'CgCgCgCg:RuRuRuRu' }],
                params: { color: 'g' }
            },
            {
                operation: 'Cutter',
                inputs: [{ id: 'c', shape: 'SuSuSuSu' }],
                outputs: [{ id: 'cl', shape: 'SuSu----' }, { id: 'cr', shape: '----SuSu' }],
                params: {}
            },
            {
                operation: 'Stacker',
                inputs: [{ id: 'p1', shape: 'CgCgCgCg:RuRuRuRu' }, { id: 'cl', shape: 'SuSu----' }],
                outputs: [{ id: 'F', shape: 'SuSu----:CgCgCgCg:RuRuRuRu' }],
                params: {}
            },
        ]
    },

    // Belt Split fed by a *machine* (not a source): the Cutter's L half feeds a
    // Belt Split that fans out to two downstream machines (a Rotator and the
    // final Stacker). This is the only fixture that triggers the *forward* Belt
    // Split walk — where a topology edge's `to` side is a Belt Split that must be
    // resolved through to its real downstream consumers (the shared
    // findDownstreamPlaceable helper). belt-split-passthrough only feeds its
    // split from a source, so it never reaches that recursive branch.
    {
        name: 'machine-fed-belt-split',
        solutionPath: [
            {
                operation: 'Cutter',
                inputs: [{ id: 'src', shape: 'CuCuCuCu' }],
                outputs: [{ id: 'L', shape: 'CuCu----' }, { id: 'R', shape: '----CuCu' }],
                params: {}
            },
            {
                operation: 'Belt Split',
                inputs: [{ id: 'L', shape: 'CuCu----' }],
                outputs: [{ id: 'L1', shape: 'CuCu----' }, { id: 'L2', shape: 'CuCu----' }],
                params: {}
            },
            {
                operation: 'Rotator CW',
                inputs: [{ id: 'L1', shape: 'CuCu----' }],
                outputs: [{ id: 'rL', shape: '--CuCu--' }],
                params: {}
            },
            {
                operation: 'Stacker',
                inputs: [{ id: 'L2', shape: 'CuCu----' }, { id: 'R', shape: '----CuCu' }],
                outputs: [{ id: 'F', shape: 'CuCuCuCu' }],
                params: {}
            },
        ]
    },
];
