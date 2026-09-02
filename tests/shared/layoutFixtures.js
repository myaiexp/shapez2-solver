// Hand-written solution paths that buildLayout / smoke consume. Every path must
// clear invalidPathSteps + invalidPathIds (smoke gates both before snapshotting
// counts): Cutter outputs are [left, right] order, Painter recolors only the
// top layer, and Stacker gravity-merges same-layer halves rather than inventing
// multi-layer products. Keep narrative coverage (branch/merge, belt-split
// pass-through, multi-source depth, machine-fed split, chained split) without
// fabricating ops. Re-exported from fixtures.js so smoke / export tests stay
// on one import.
export const LAYOUT_FIXTURES = [
    {
        name: 'simple-cut-stack',
        solutionPath: [
            {
                operation: 'Cutter',
                inputs: [{ id: 'src', shape: 'CuCuCuCu' }],
                // cut() returns [left, right] = [----CuCu, CuCu----]
                outputs: [{ id: 'L', shape: '----CuCu' }, { id: 'R', shape: 'CuCu----' }],
                params: {}
            },
            {
                operation: 'Stacker',
                inputs: [{ id: 'L', shape: '----CuCu' }, { id: 'R', shape: 'CuCu----' }],
                // Same-layer halves gravity-merge back to a full circle.
                outputs: [{ id: 'final', shape: 'CuCuCuCu' }],
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
                outputs: [{ id: 'L', shape: '----CuCu' }, { id: 'R', shape: 'CuCu----' }],
                params: {}
            },
            {
                operation: 'Painter',
                inputs: [{ id: 'L', shape: '----CuCu' }],
                outputs: [{ id: 'P', shape: '----CrCr' }],
                params: { color: 'r' }
            },
            {
                operation: 'Stacker',
                inputs: [{ id: 'P', shape: '----CrCr' }, { id: 'R', shape: 'CuCu----' }],
                outputs: [{ id: 'F', shape: 'CuCuCrCr' }],
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
    // stacks two sources then paints the result (top layer only), the other cuts a
    // third source; a final Stacker merges them. Produces a wider, deeper grid
    // (more rows and columns) than any other fixture, and leaves an unused
    // terminal output (the Cutter's right half).
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
                // Painter recolors only the top layer.
                outputs: [{ id: 'p1', shape: 'CuCuCuCu:RgRgRgRg' }],
                params: { color: 'g' }
            },
            {
                operation: 'Cutter',
                inputs: [{ id: 'c', shape: 'SuSuSuSu' }],
                outputs: [{ id: 'cl', shape: '----SuSu' }, { id: 'cr', shape: 'SuSu----' }],
                params: {}
            },
            {
                operation: 'Stacker',
                inputs: [{ id: 'p1', shape: 'CuCuCuCu:RgRgRgRg' }, { id: 'cl', shape: '----SuSu' }],
                outputs: [{ id: 'F', shape: 'CuCuCuCu:RgRgRgRg:----SuSu' }],
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
                outputs: [{ id: 'L', shape: '----CuCu' }, { id: 'R', shape: 'CuCu----' }],
                params: {}
            },
            {
                operation: 'Belt Split',
                inputs: [{ id: 'L', shape: '----CuCu' }],
                outputs: [{ id: 'L1', shape: '----CuCu' }, { id: 'L2', shape: '----CuCu' }],
                params: {}
            },
            {
                operation: 'Rotator CW',
                inputs: [{ id: 'L1', shape: '----CuCu' }],
                outputs: [{ id: 'rL', shape: 'Cu----Cu' }],
                params: {}
            },
            {
                operation: 'Stacker',
                inputs: [{ id: 'L2', shape: '----CuCu' }, { id: 'R', shape: 'CuCu----' }],
                outputs: [{ id: 'F', shape: 'CuCuCuCu' }],
                params: {}
            },
        ]
    },

    // Chained Belt Split: a split consumes another split's output, then two
    // machines consume the second split. findDownstreamPlaceable recurses on
    // split→split, and propagateBeltSplits offsets each copy horizontally.
    // machine-fed-belt-split only walks a single split, so this is the fixture
    // that reaches the recursive branch Constructive actually emits.
    {
        name: 'chained-belt-split',
        solutionPath: [
            {
                operation: 'Belt Split',
                inputs: [{ id: 'src', shape: 'CuRuSuWu' }],
                outputs: [{ id: 'd1', shape: 'CuRuSuWu' }, { id: 'd2', shape: 'CuRuSuWu' }],
                params: {}
            },
            {
                operation: 'Belt Split',
                inputs: [{ id: 'd1', shape: 'CuRuSuWu' }],
                outputs: [{ id: 'e1', shape: 'CuRuSuWu' }, { id: 'e2', shape: 'CuRuSuWu' }],
                params: {}
            },
            {
                operation: 'Rotator CW',
                inputs: [{ id: 'e1', shape: 'CuRuSuWu' }],
                outputs: [{ id: 'r1', shape: 'WuCuRuSu' }],
                params: {}
            },
            {
                operation: 'Stacker',
                inputs: [{ id: 'e2', shape: 'CuRuSuWu' }, { id: 'd2', shape: 'CuRuSuWu' }],
                outputs: [{ id: 'F', shape: 'CuRuSuWu:CuRuSuWu' }],
                params: {}
            },
        ]
    },
];
