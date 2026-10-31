// The Pages artifact is the set of files the page actually loads — run with:
//   node tests/shared/assembleSite.test.js
//
// Fixture repos pin each kind of reference the walk follows; the last block runs
// it on this repo, so a root dev file can't reach the live site and a reference
// to a file that doesn't exist fails the test job before the deploy job starts.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleSite, siteFiles } from '../../.github/assemble-site.mjs';

let passed = 0, total = 0, failed = false;
function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

const scratch = mkdtempSync(join(tmpdir(), 'assemble-site-'));
let fixtureCount = 0;

function repo(files) {
    const root = join(scratch, `repo-${fixtureCount++}`);
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    }
    return root;
}

const page = (body) => `<html><head>${body}</head></html>`;

const walked = siteFiles(repo({
    'index.html': page(`
        <link rel="stylesheet" href="styles.css?v=__COMMIT__">
        <link rel="icon" href="images/favicon.ico?v=__COMMIT__">
        <script src="https://unpkg.com/lib@1/lib.js"></script>
        <script type="module" src="main.js?v=__COMMIT__"></script>`),
    'styles.css': `@import url('fonts/fonts.css'); body { background: url("images/bg.png"); }`,
    'fonts/fonts.css': `@font-face { src: url('./a.woff2?v=abc') format('woff2'); }`,
    'fonts/a.woff2': '',
    'fonts.json': '{}',
    'images/favicon.ico': '',
    'images/bg.png': '',
    'images/literal.png': '',
    'images/operations/cutter.png': '',
    'images/operations/stacker.png': '',
    'main.js': `import { a } from './a.js';
        import './side.js';
        export { b } from './b.js';
        const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        const src = \`images/operations/\${name}.png\`;
        const icon = 'images/literal.png';
        const lazy = import('./lazy.js');
        // import './commentedOut.js';
        /** @type {import('./typeOnly.js').Thing} */`,
    'a.js': `import { c } from './nested/c.js';`,
    'nested/c.js': `import { a } from '../a.js';`,
    'side.js': '',
    'b.js': '',
    'worker.js': `import { a } from './a.js';`,
    'typeOnly.js': '',
    'commentedOut.js': '',
    'lazy.js': '',
    'unusedTestUtils.js': '',
    'CLAUDE.md': '',
    'package.json': '{}',
}));

const expected = [
    'a.js', 'b.js', 'fonts/a.woff2', 'fonts/fonts.css', 'images/bg.png', 'images/favicon.ico',
    'images/literal.png', 'images/operations/cutter.png', 'images/operations/stacker.png',
    'index.html', 'lazy.js', 'main.js', 'nested/c.js', 'side.js', 'styles.css', 'worker.js',
];
check('walks every reference kind and nothing else', JSON.stringify(walked) === JSON.stringify(expected),
    JSON.stringify(walked));

function throwsNaming(root, needle) {
    try {
        siteFiles(root);
        return false;
    } catch (error) {
        return error.message.includes(needle);
    }
}

check('a missing import fails the walk, naming the file that holds it',
    throwsNaming(repo({
        'index.html': page('<script type="module" src="main.js"></script>'),
        'main.js': `import './gone.js';`,
    }), 'main.js → gone.js'));
check('a missing stylesheet fails the walk',
    throwsNaming(repo({ 'index.html': page('<link rel="stylesheet" href="gone.css">') }),
        'index.html → gone.css'));
check('a reference that climbs out of the repo fails the walk',
    throwsNaming(repo({
        'index.html': page('<script type="module" src="main.js"></script>'),
        'main.js': `import '../outside.js';`,
    }), 'main.js → ../outside.js'));
check('a template path over a missing directory fails the walk',
    throwsNaming(repo({
        'index.html': page('<script type="module" src="main.js"></script>'),
        'main.js': 'const src = `images/gone/${name}.png`;',
    }), 'main.js → images/gone/'));

const stamped = repo({
    'index.html': page('<script type="module" src="main.js?v=__COMMIT__"></script>'),
    'main.js': '',
    'dev.js': '',
});
const out = join(scratch, 'site');
assembleSite(stamped, out, 'abc1234');
check('stamps the commit into index.html', readFileSync(join(out, 'index.html'), 'utf8').includes('main.js?v=abc1234'));
check('leaves unreferenced files out of the artifact', !existsSync(join(out, 'dev.js')));

const linked = repo({ 'index.html': page('<script type="module" src="main.js"></script>'), 'target.js': 'x' });
symlinkSync(join(linked, 'target.js'), join(linked, 'main.js'));
const linkedOut = join(scratch, 'linked-site');
assembleSite(linked, linkedOut, 'abc1234');
check('a symlinked page file lands as a regular file',
    readFileSync(join(linkedOut, 'main.js'), 'utf8') === 'x');

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const live = new Set(siteFiles(repoRoot));
const liveHas = (path) => live.has(path);
for (const path of ['index.html', 'main.js', 'shapeSolver.js', 'styles.css', 'fonts/fonts.css',
    'fonts/barlow-400.woff2', 'images/favicon.ico']) {
    check(`this repo publishes ${path}`, liveHas(path));
}
for (const name of readdirSync(join(repoRoot, 'images/operations'))) {
    check(`this repo publishes operation icon ${name}`, liveHas(`images/operations/${name}`));
}
for (const path of ['shapeOperationsTestUtils.js', 'CLAUDE.md', 'AGENTS.md', 'README.md', 'package.json',
    'deploy.sh', 'fonts.json']) {
    check(`this repo keeps ${path} out`, !liveHas(path));
}
const rootScripts = readdirSync(repoRoot).filter((name) => name.endsWith('.js'));
const unreached = rootScripts.filter((name) => !liveHas(name));
check('every root script but the test utilities is reached from index.html',
    JSON.stringify(unreached) === JSON.stringify(['shapeOperationsTestUtils.js']), unreached.join(', '));
check('nothing outside the page and its assets is published',
    [...live].every((path) => !path.startsWith('tests/') && !path.startsWith('docs/') && !path.startsWith('.')));

rmSync(scratch, { recursive: true, force: true });

console.log(`\n${passed}/${total} passed`);
process.exit(failed ? 1 : 0);
