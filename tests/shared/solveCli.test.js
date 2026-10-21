// Exit-code contract for tests/shared/solve.mjs (audit #12020) — run with:
//   node tests/shared/solveCli.test.js
//
// CI and pre-commit invoke this harness as a gate. A no-path result used to
// exit 0, so a solver that stopped solving the one-cut target stayed green.
// `--expect-solved` is what the gate passes; without it a miss stays 0 so the
// harness can still be used to inspect a failure. Unknown `--` flags exit 2
// (`--help` used to be parsed as a target and exit 0).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

function run(args) {
    return spawnSync(process.execPath, ['tests/shared/solve.mjs', ...args], {
        cwd: root,
        encoding: 'utf8',
    });
}

{
    const res = run(['--help']);
    check('--help is an unknown flag (exit 2), not a target', res.status === 2, `status=${res.status} stderr=${res.stderr}`);
    check('--help names the flag', (res.stderr || '').includes('unknown flag: --help'));
}

{
    const res = run(['not-a-shape', '--json', '--max-states', '30', '--timeout', '5000']);
    check('invalid target exits 2 before a search', res.status === 2, `status=${res.status} out=${res.stdout} err=${res.stderr}`);
    check('invalid target names the code on stderr', (res.stderr || '').includes('invalid target not-a-shape'));
    check('invalid target does not print a solve result', !(res.stdout || '').includes('solved'));
}

{
    const res = run(['CuCuCuCu', '--start', 'CuCuCuCu,nope', '--json', '--max-states', '30', '--timeout', '5000']);
    check('invalid starting shape exits 2', res.status === 2, `status=${res.status} err=${res.stderr}`);
    check('invalid starting shape names the code', (res.stderr || '').includes('invalid starting shape nope'));
}

{
    // A real shape code can start with '--' (empty quadrants). That must stay a
    // target, not an unknown flag — the rejection of --help must not swallow it.
    const res = run([
        '--CuCu--:RuRu----', '--start', 'CuCuCuCu,RuRuRuRu',
        '--ops', 'Cutter,Stacker', '--json', '--max-states', '50', '--timeout', '8000',
    ]);
    check('a shape code that starts with -- is not an unknown flag',
        res.status !== 2 || !(res.stderr || '').includes('unknown flag'),
        `status=${res.status} err=${res.stderr}`);
    check('that shape reaches the solver (json result)',
        (res.stdout || '').includes('"solved"'),
        `out=${res.stdout} err=${res.stderr}`);
}

{
    const res = run(['--not-a-real-flag']);
    check('any other unknown -- flag exits 2', res.status === 2, `status=${res.status}`);
}

{
    const res = run([
        'CuRuRuRu', '--start', 'CuCuCuCu', '--ops', 'Rotator CW',
        '--json', '--max-states', '50', '--timeout', '5000',
    ]);
    check('a miss without --expect-solved exits 0', res.status === 0, `status=${res.status} out=${res.stdout}`);
    const body = JSON.parse(res.stdout);
    check('that miss reports solved:false', body.solved === false);
}

{
    const res = run([
        'CuRuRuRu', '--start', 'CuCuCuCu', '--ops', 'Rotator CW',
        '--json', '--expect-solved', '--max-states', '50', '--timeout', '5000',
    ]);
    check('--expect-solved exits 1 when there is no path', res.status === 1, `status=${res.status} out=${res.stdout}`);
    const body = JSON.parse(res.stdout);
    check('--json still prints the miss before exiting 1', body.solved === false);
}

{
    const res = run([
        'CuCu----', '--start', 'CuCuCuCu', '--ops', 'Cutter',
        '--json', '--expect-solved', '--max-states', '1000',
    ]);
    check('the CI one-cut target passes --expect-solved', res.status === 0, `status=${res.status}\n${res.stderr}\n${res.stdout}`);
    const body = JSON.parse(res.stdout);
    check('that solve reports solved:true', body.solved === true && body.reachesTarget === true);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
