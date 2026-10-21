// Literal DOM ids in the root scripts must exist in index.html — run with:
//   node tests/shared/domIds.test.js
//
// persistenceApply.test.js checks the ids persistence.js touches while
// capturing and applying. The other scripts (main.js, uiControls.js, the
// graph modules) fail a renamed id only as a null dereference in the browser.
// Template ids (a tab name plus a suffix) are not literals; activateTab
// returns false when either half is missing, so they are not scanned here.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const page = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const pageIds = new Set([...page.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

// byId / getElementById literals, plus readInt('id') which is byId underneath.
const lookupRe = /(?:\bbyId|\bgetElementById|\breadInt)\(\s*['"]([^'"]+)['"]/g;

let passed = 0, total = 0, failed = false;
function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

const files = readdirSync(root).filter((name) => name.endsWith('.js')).sort();
const missing = [];
const seen = new Set();
for (const name of files) {
    const text = readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
    for (const match of text.matchAll(lookupRe)) {
        const id = match[1];
        if (seen.has(id)) continue;
        seen.add(id);
        if (!pageIds.has(id)) missing.push(`${name} → #${id}`);
    }
}

check('scanned the root scripts', files.length > 0);
check('found literal DOM lookups', seen.size > 0, `matched ${seen.size}`);
check('every literal DOM id exists in index.html', missing.length === 0, missing.join(', '));

// Repeated ids make getElementById ambiguous. separator and the input row are
// styling hooks, so they have to be classes — one id per element.
const idList = [...page.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const dupes = [...new Set(idList.filter((id, i) => idList.indexOf(id) !== i))];
check('index.html ids are unique', dupes.length === 0, dupes.join(', '));

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
check('separator styling hook is a class',
    page.includes('class="separator"') && !page.includes('id="separator"')
        && css.includes('.separator') && !css.includes('#separator'));
check('input-row styling hook is a class',
    page.includes('class="input-button-container"') && !page.includes('id="input-button-container"')
        && css.includes('.input-button-container') && !css.includes('#input-button-container'));

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
