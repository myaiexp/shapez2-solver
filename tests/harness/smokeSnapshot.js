// Compare-or-record a smoke snapshot value. Writing a missing (or changed)
// baseline requires an explicit opt-in so a lost snapshots.json cannot
// self-bless current behavior and keep CI green.

export function applySnapshot(key, actual, snapshots, { update }) {
    if (!(key in snapshots)) {
        if (update) {
            snapshots[key] = actual;
            return { status: 'written' };
        }
        return { status: 'missing' };
    }
    const expected = snapshots[key];
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        return { status: 'pass' };
    }
    if (update) {
        snapshots[key] = actual;
        return { status: 'updated', expected };
    }
    return { status: 'fail', expected };
}
