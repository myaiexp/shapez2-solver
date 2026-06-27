// Unit tests for PriorityQueue (min-heap) — run with: node tests/solver/shapeSolverPriorityQueue.test.js
import { PriorityQueue } from '../../shapeSolverPriorityQueue.js';

// Verified contract (read from the source, not assumed):
//   - Min-heap: the lowest `priority` dequeues first.
//   - enqueue(val, priority) stores { val, priority }; dequeue() returns that
//     object, or `null` when the queue is empty.
//   - size() is the element count. There is NO peek().
//   - Tie-break is UNSPECIFIED: equal priorities neither bubble (>=) nor sink
//     (<), so the order among equal-priority items is implementation-defined.
//     Tests below assert only what the heap guarantees — global ascending order
//     across distinct priorities — never an intra-tie ordering.

let passed = 0;
let total = 0;
let failed = false;

function check(name, actual, expected) {
    total++;
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    if (match) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        failed = true;
    }
}

// Pop every item until the queue reports empty (dequeue() === null).
const drain = pq => {
    const out = [];
    let item;
    while ((item = pq.dequeue()) !== null) out.push(item);
    return out;
};

// --- Empty / size bookkeeping --------------------------------------------

// Empty-queue branch: dequeue() must return null (not undefined / not throw).
check('dequeue on an empty queue returns null',
    new PriorityQueue().dequeue(), null);

check('size() of a fresh queue is 0',
    new PriorityQueue().size(), 0);

// size() tracks enqueues and dequeues symmetrically.
const sz = new PriorityQueue();
sz.enqueue('x', 1);
sz.enqueue('y', 2);
sz.enqueue('z', 3);
check('size() reflects three enqueues', sz.size(), 3);
sz.dequeue();
check('size() decrements after one dequeue', sz.size(), 2);

// --- Single element ------------------------------------------------------

// Single-element dequeue exercises the `length > 0` guard that skips sinkDown
// once the last element is popped — easy to break with an off-by-one.
const single = new PriorityQueue();
single.enqueue('a', 5);
check('single enqueue → size 1', single.size(), 1);
check('single dequeue returns the stored {val, priority}',
    single.dequeue(), { val: 'a', priority: 5 });
check('size() back to 0 after draining the only element', single.size(), 0);
check('dequeue after draining the only element returns null again',
    single.dequeue(), null);

// --- Min-heap ordering ----------------------------------------------------

// Enqueued out of priority order; must dequeue ascending by priority.
const pq = new PriorityQueue();
[['e', 5], ['a', 1], ['c', 3], ['b', 2], ['d', 4]].forEach(([v, p]) => pq.enqueue(v, p));
check('dequeues in ascending priority order (min-heap)',
    drain(pq).map(x => x.val), ['a', 'b', 'c', 'd', 'e']);

// Interleaved enqueue/dequeue: the global minimum is always served next, even
// when smaller priorities arrive after larger ones have already been queued.
const mix = new PriorityQueue();
mix.enqueue('p4', 4);
mix.enqueue('p2', 2);
const first = mix.dequeue();
mix.enqueue('p1', 1);
mix.enqueue('p3', 3);
check('interleaved ops dequeue the global minimum first', first.val, 'p2');
check('remaining drain after interleave stays ascending',
    drain(mix).map(x => x.val), ['p1', 'p3', 'p4']);

// --- Ties: correctness without assuming a tie-break order -----------------

// priorities 3,1,2,1,3,2,1 → three 1s, two 2s, two 3s. The heap guarantees no
// larger priority is served before a smaller one; the order WITHIN each equal
// group is unspecified, so it is asserted only as a multiset (sorted).
const ties = new PriorityQueue();
[['a', 3], ['b', 1], ['c', 2], ['d', 1], ['e', 3], ['f', 2], ['g', 1]]
    .forEach(([v, p]) => ties.enqueue(v, p));
const tied = drain(ties);
check('equal-priority items never dequeue before a strictly smaller one',
    tied.map(x => x.priority), [1, 1, 1, 2, 2, 3, 3]);
check('every value is dequeued exactly once under ties (no loss / no dup)',
    tied.map(x => x.val).sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);

// --- Large deterministic sequence ----------------------------------------

// 101 is prime and 37 is coprime to it, so (i * 37) % 101 is a permutation of
// 0..100 — a fixed, non-trivial insertion order (no Math.random). Draining must
// reproduce a fully sorted 0..100, exercising bubbleUp/sinkDown end to end. An
// off-by-one in the child indices or a flipped comparator corrupts this output.
const N = 101;
const big = new PriorityQueue();
for (let i = 0; i < N; i++) big.enqueue('n' + i, (i * 37) % N);
const drainedBig = drain(big).map(x => x.priority);
check('large sequence drains every element', drainedBig.length, N);
check('large sequence dequeues in fully sorted ascending order',
    drainedBig, Array.from({ length: N }, (_, i) => i));

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
