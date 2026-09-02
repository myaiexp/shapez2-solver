// Unit tests for the smoke snapshot compare/update gate. Run with:
//   node tests/shared/smokeSnapshot.test.js
import { applySnapshot } from './smokeSnapshot.js';

let passed = 0, total = 0, failed = false;

function check(name, actual, expected) {
    total++;
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    if (match) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed = true; }
}

{
    const snapshots = {};
    const result = applySnapshot('Op: new', ['CuCu----'], snapshots, { update: false });
    check('missing key without UPDATE → missing', result, { status: 'missing' });
    check('missing key without UPDATE does not write', snapshots, {});
}

{
    const snapshots = {};
    const result = applySnapshot('Op: new', ['CuCu----'], snapshots, { update: true });
    check('missing key with UPDATE → written', result, { status: 'written' });
    check('missing key with UPDATE records the actual', snapshots['Op: new'], ['CuCu----']);
}

{
    const snapshots = { 'Op: cut': ['----CuCu', 'CuCu----'] };
    const result = applySnapshot('Op: cut', ['----CuCu', 'CuCu----'], snapshots, { update: false });
    check('matching key → pass', result, { status: 'pass' });
}

{
    const snapshots = { 'Op: cut': ['old'] };
    const actual = ['new'];
    const result = applySnapshot('Op: cut', actual, snapshots, { update: false });
    check('mismatch without UPDATE → fail, keeps expected', result, { status: 'fail', expected: ['old'] });
    check('mismatch without UPDATE does not overwrite', snapshots['Op: cut'], ['old']);
}

{
    const snapshots = { 'Op: cut': ['old'] };
    const result = applySnapshot('Op: cut', ['new'], snapshots, { update: true });
    check('mismatch with UPDATE → updated', result, { status: 'updated', expected: ['old'] });
    check('mismatch with UPDATE overwrites the baseline', snapshots['Op: cut'], ['new']);
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
