// Builds the Pages artifact: `node .github/assemble-site.mjs <outDir> <shortSha>`.
//
// The artifact is what index.html reaches, walked through its scripts, modules and
// stylesheets, so a dev file added to the repo root stays out without anyone listing
// it. A reference to a file that does not exist throws, because the page would 404
// on it. tests/shared/assembleSite.test.js runs the same walk in the test job, which
// the deploy job needs.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const ENTRY = 'index.html';

const isExternal = (spec) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(spec);
const withoutQuery = (spec) => spec.replace(/[?#].*$/, '');
const captures = (text, re) => [...text.matchAll(re)].map((match) => match[1]);

function htmlRefs(text) {
    const live = text.replace(/<!--[\s\S]*?-->/g, '');
    return { relative: captures(live, /\b(?:src|href)="([^"]+)"/g) };
}

function cssRefs(text) {
    const live = text.replace(/\/\*[\s\S]*?\*\//g, '');
    return {
        relative: [
            ...captures(live, /url\(\s*['"]?([^'")]+)/g),
            ...captures(live, /@import\s+['"]([^'"]+)['"]/g),
        ],
    };
}

// `relative` paths resolve against the module. `fromPage` paths are strings the code
// hands to the DOM, which resolves them against the page, and `dirs` are the same
// thing built by a template (`images/operations/${name}.png`), whose whole directory
// has to ship because the names only exist at runtime.
export function jsRefs(text) {
    const live = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return {
        relative: [
            ...captures(live, /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g),
            ...captures(live, /^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm),
            ...captures(live, /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]/g),
            ...captures(live, /new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url/g),
        ],
        fromPage: captures(live, /['"]([\w-]+(?:\/[\w.-]+)*\/[\w.-]+\.\w+)['"]/g),
        dirs: captures(live, /`([\w./-]+\/)\$\{[^`]*\}\.\w+`/g),
    };
}

const SCANNERS = { '.html': htmlRefs, '.css': cssRefs, '.js': jsRefs };

function kindOf(root, path) {
    try {
        const stat = statSync(join(root, path));
        return stat.isFile() ? 'file' : stat.isDirectory() ? 'dir' : null;
    } catch {
        return null;
    }
}

/**
 * Repo-relative paths of every file the page loads, sorted.
 * @param {string} root repo root holding index.html
 * @returns {string[]}
 */
export function siteFiles(root) {
    const found = new Set();
    const pending = [];

    function add(from, path) {
        if (path.startsWith('../') || kindOf(root, path) !== 'file') {
            throw new Error(`broken site reference: ${from} → ${path}`);
        }
        if (!found.has(path)) {
            found.add(path);
            pending.push(path);
        }
    }

    add('(entry)', ENTRY);
    while (pending.length > 0) {
        const path = pending.pop();
        const scan = SCANNERS[posix.extname(path)];
        if (!scan) continue;
        const refs = scan(readFileSync(join(root, path), 'utf8'));
        for (const spec of refs.relative) {
            if (isExternal(spec)) continue;
            add(path, posix.normalize(posix.join(posix.dirname(path), withoutQuery(spec))));
        }
        for (const spec of refs.fromPage ?? []) {
            // A slashed string that names no repo directory is not a path, e.g. a MIME type.
            if (kindOf(root, spec.split('/')[0]) === 'dir') add(path, spec);
        }
        for (const dir of refs.dirs ?? []) {
            if (kindOf(root, dir) !== 'dir') throw new Error(`broken site reference: ${path} → ${dir}`);
            for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
                if (entry.isFile()) add(path, `${dir}${entry.name}`);
            }
        }
    }
    return [...found].sort();
}

/**
 * Copies the page's files to `outDir` and stamps the cache-buster into index.html.
 * @param {string} root repo root
 * @param {string} outDir directory to create or fill
 * @param {string} commit short SHA that replaces __COMMIT__
 */
export function assembleSite(root, outDir, commit) {
    for (const path of siteFiles(root)) {
        mkdirSync(dirname(join(outDir, path)), { recursive: true });
        copyFileSync(join(root, path), join(outDir, path));
    }
    const page = join(outDir, ENTRY);
    writeFileSync(page, readFileSync(page, 'utf8').replaceAll('__COMMIT__', commit));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const [outDir, commit] = process.argv.slice(2);
    if (!outDir || !commit) {
        console.error('usage: node .github/assemble-site.mjs <outDir> <shortSha>');
        process.exit(2);
    }
    assembleSite(process.cwd(), outDir, commit);
}
