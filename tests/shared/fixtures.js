export const PURE_OP_CHECKS = [
    { name: 'cut-CuCuCuCu', op: 'cut', shapeArgs: ['CuCuCuCu'] },
    { name: 'stack-CuCuCuCu+RuRuRuRu', op: 'stack', shapeArgs: ['CuCuCuCu', 'RuRuRuRu'] },
    { name: 'rotate90CW-CuRuSuWu', op: 'rotate90CW', shapeArgs: ['CuRuSuWu'] },
    { name: 'getSimilarity-CuCu+RuRu', op: 'getSimilarity', shapeArgs: ['CuCuCuCu', 'RuRuRuRu'] },
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
        // Already-solved: the target is a starting shape, so the correct answer
        // is an EMPTY path at depth 0 (solverAlreadySolved.test.js pins the
        // contract). Kept here so smoke's goal gate keeps accepting a zero-op
        // solve — it reads as "no solution" the moment `starts` stops reaching it.
        name: 'already-solved',
        target: 'CuCuCuCu',
        starting: ['RuRuRuRu', 'CuCuCuCu'],
        ops: ['Cutter', 'Stacker'],
        method: 'A*',
        ...baseSolverParams,
    },
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
    // Multi-layer cut reachability: CuCu----:----SuSu has an empty half on each
    // layer, but on *different* sides — so a single Cut yields two useful pieces
    // (----SuSu and CuCu----). Guards the shapeSolverExpansion empty-half prune
    // against regressing to a layer-0-only check, which wrongly skips this cut
    // and makes ----SuSu unreachable from this start (audit finding).
    {
        name: 'multilayer-cut',
        target: '----SuSu',
        starting: ['CuCu----:----SuSu'],
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
    // (b) preventWaste + Trash: cutting CuRuSuWu yields CuRu---- (the target)
    //     plus ----SuWu. Under preventWaste the all-acceptable goal requires
    //     every available shape to be a rotation of the target, so ----SuWu
    //     must be removed. Trash (gated: preventWaste && not acceptable) removes
    //     it in 1 op, giving the 2-step solution: Cut → Trash. Without Trash in
    //     the ops list this same cut would leave an unremovable byproduct and the
    //     target would be unsolvable — exercising both preventWaste and Trash.
    {
        name: 'prevent-waste-blocks-waste',
        target: 'CuRu----',
        starting: ['CuRuSuWu'],
        ops: ['Cutter', 'Trash'],
        method: 'BFS',
        ...baseSolverParams,
        preventWaste: true,
        monolayerPainting: true,
    },
    // (c) preventWaste when the target is already a start but another start is
    //     leftover waste: solution is Trash-only on RuRuRuRu, leaving CuCuCuCu
    //     unmentioned in the path. Inventory gates must seed unused starts or
    //     this reads as "no target" / "empty inventory is clean" (finding #6417).
    {
        name: 'prevent-waste-target-as-start',
        target: 'CuCuCuCu',
        starting: ['CuCuCuCu', 'RuRuRuRu'],
        ops: ['Cutter', 'Stacker', 'Trash'],
        method: 'A*',
        ...baseSolverParams,
        preventWaste: true,
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
    // Multi-layer complementary-half cut: over-pruning that drops one half (or
    // the whole cut) changes counts and fails edge validation. Mirrors the
    // expandUnaryOp unit coverage with an end-to-end explorer fixture.
    {
        name: 'multilayer-complementary-cut',
        starting: ['CuCu----:----SuSu'],
        ops: ['Cutter'],
        depthLimit: 1,
        maxLayers: 4,
    },
    // Painter without a target: enumerateUnaryColors walks referenceCodes (all
    // inventory shapes). Explorer must pass an array (or array-producing getter),
    // not a bare function — a function is not iterable (audit finding #6317).
    // CrCrCrCr supplies a red circle color for CuCuCuCu so the op path is live.
    {
        name: 'painter-no-target',
        starting: ['CuCuCuCu', 'CrCrCrCr'],
        ops: ['Painter'],
        depthLimit: 1,
        maxLayers: 4,
    },
    // Painter WITH a target (finding #8619): the explorer's 7th arg narrows
    // Painter colors to those implied by the target, so Cg is not a paint color.
    // Smoke threads `target` through; the with/without count contrast lives in
    // shapeExplorerTarget.test.js.
    {
        name: 'painter-with-target',
        starting: ['CuCuCuCu', 'CrCrCrCr', 'CgCgCgCg'],
        ops: ['Painter'],
        depthLimit: 1,
        maxLayers: 4,
        target: 'CrCrCrCr',
    },
];

export { LAYOUT_FIXTURES } from './layoutFixtures.js';
