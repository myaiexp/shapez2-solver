// Every root module must load under some test — run with:
//   node tests/shared/coverageReach.test.js
//
// Node's coverage report omits a module no test loads instead of counting it as
// 0%, so the floor in tests/run-suite.sh cannot see one. This walks the import
// graph from the test entry files and fails on any root module it doesn't reach.
// BROWSER_ENTRY is the exemption: main.js wires the whole page at import time and
// is covered by driving it in a browser, so it is named here rather than ignored.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsRefs } from '../../.github/assemble-site.mjs';

const BROWSER_ENTRY = ['main.js'];

let passed = 0, total = 0, failed = false;
function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

function testEntries(root) {
    const entries = ['tests/shared/smoke.js'];
    const dirs = ['tests'];
    while (dirs.length > 0) {
        const dir = dirs.pop();
        for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
            const path = `${dir}/${entry.name}`;
            if (entry.isDirectory()) dirs.push(path);
            else if (entry.name.endsWith('.test.js')) entries.push(path);
        }
    }
    return entries;
}

function readIfPresent(root, path) {
    try {
        return readFileSync(join(root, path), 'utf8');
    } catch {
        return null;
    }
}

// Test files hold fixture text with paths that resolve to nothing, so a miss
// is skipped here where the site walk would throw.
function unreachedModules(root) {
    const reached = new Set();
    const pending = testEntries(root);
    while (pending.length > 0) {
        const path = pending.pop();
        if (reached.has(path) || !/\.m?js$/.test(path)) continue;
        const text = readIfPresent(root, path);
        if (text === null) continue;
        reached.add(path);
        for (const spec of jsRefs(text).relative) {
            pending.push(posix.normalize(posix.join(posix.dirname(path), spec.replace(/[?#].*$/, ''))));
        }
    }
    return readdirSync(root).filter((name) => name.endsWith('.js') && !reached.has(name)).sort();
}

const scratch = mkdtempSync(join(tmpdir(), 'coverage-reach-'));
for (const [path, text] of Object.entries({
    'tests/shared/smoke.js': `import '../../viaSmoke.js';`,
    'tests/nested/a.test.js': `const m = await import('../../viaDynamic.js');
        // import '../../commentedOut.js';
        const fixture = \`from './noSuchFile.js'\`;`,
    'viaSmoke.js': `import { x } from './transitive.js';`,
    'viaDynamic.js': '',
    'transitive.js': '',
    'commentedOut.js': '',
    'orphan.js': '',
})) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), text);
}
check('a fixture repo reports only its unloaded modules',
    unreachedModules(scratch).join() === 'commentedOut.js,orphan.js', unreachedModules(scratch).join());
rmSync(scratch, { recursive: true, force: true });

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const unreached = unreachedModules(repoRoot);
check('every root module loads under a test, bar the browser entry',
    unreached.join() === BROWSER_ENTRY.join(), `unreached: ${unreached.join(', ')}`);

console.log(`\n${passed}/${total} passed`);
process.exit(failed ? 1 : 0);
