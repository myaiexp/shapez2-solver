// Standalone tests for shapeValidation.js — run with: node tests/shape/shapeValidation.test.js
//
// Covers every rule in the pure validators validateShapeCode + validateLayer
// (audit #2208 — the file had zero coverage). validateLayer is not exported, so
// its per-part rules are exercised transitively: validateShapeCode routes every
// layer through it. showValidationErrors is browser-only (calls alert()) and is
// out of scope.
//
// Shape chars: - P c C R S W H F G X Y   (Nothing, Pin, Crystal, + structurals)
// Color chars: - u r g b y c m w k
import { validateShapeCode } from '../../shapeValidation.js';

let passed = 0;
let total = 0;
let failed = false;

// Asserts the code validates clean: isValid true AND no accumulated errors.
function checkValid(name, code) {
    total++;
    const res = validateShapeCode(code);
    if (res.isValid === true && res.errors.length === 0) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name}\n    expected: valid, no errors\n    actual:   isValid=${res.isValid}, errors=${JSON.stringify(res.errors)}`);
        failed = true;
    }
}

// Asserts the code is rejected AND at least one error contains `substr`
// (so we know the *specific* rule fired, not just some unrelated failure).
function checkInvalid(name, code, substr) {
    total++;
    const res = validateShapeCode(code);
    const hit = !res.isValid && res.errors.some(e => e.includes(substr));
    if (hit) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name}\n    expected: invalid with error containing "${substr}"\n    actual:   isValid=${res.isValid}, errors=${JSON.stringify(res.errors)}`);
        failed = true;
    }
}

// --- Type / empty guards (validateShapeCode top-level) ---
checkInvalid('non-string (number) rejected', 42, 'must be a string');
checkInvalid('non-string (null) rejected', null, 'must be a string');
checkInvalid('non-string (object) rejected', {}, 'must be a string');
checkInvalid('empty string rejected', '', 'cannot be empty');

// --- Happy paths ---
checkValid('single full layer (CuRuSuWu)', 'CuRuSuWu');
checkValid('multi-layer, consistent part counts', 'CuRuSuWu:CuRuSuWu');
checkValid('single part layer (Cu)', 'Cu');
checkValid('Nothing with no color (--)', '--');
checkValid('Pin with no color (P-)', 'P-');
checkValid('Crystal shape with color (cu)', 'cu');
checkValid('refined X/Y shapes (XuYu)', 'XuYu');
checkValid('hexagon/flower/gear (HuFuGu)', 'HuFuGu');
checkValid('structural with no color (C-)', 'C-');
checkValid('all valid colors across parts (CuRrSgWb)', 'CuRrSgWb');
checkValid('black + white + cyan + magenta (CkCwCcCm)', 'CkCwCcCm');

// --- Rule: even number of characters per layer (length parity) ---
checkInvalid('odd-length single layer (CuR)', 'CuR', 'even number of characters');
checkInvalid('odd-length trailing char (CuRuS)', 'CuRuS', 'even number of characters');

// --- Rule: empty layer (from a stray separator) ---
checkInvalid('trailing separator → empty layer (Cu:)', 'Cu:', 'is empty');
checkInvalid('leading separator → empty layer (:Cu)', ':Cu', 'is empty');
checkInvalid('double separator → empty middle layer (Cu::Ru)', 'Cu::Ru', 'is empty');

// --- Rule: valid shape characters ---
checkInvalid('invalid shape char (Zu)', 'Zu', "'Z' is not a valid shape");
checkInvalid('invalid shape char lowercase (su)', 'su', "'s' is not a valid shape");
checkValid('control: each valid structural shape (CuRuSuWuHuFuGu)', 'CuRuSuWuHuFuGu');

// --- Rule: valid color characters ---
checkInvalid('invalid color char (Cz)', 'Cz', "'z' is not a valid color");
checkInvalid('invalid color char uppercase (CR)', 'CR', "'R' is not a valid color");

// --- Rule: Nothing shape cannot have a color ---
checkInvalid('Nothing with color u (-u)', '-u', "'Nothing' shape cannot have a color");
checkInvalid('Nothing with color r in second part (Cu-r)', 'Cu-r', "'Nothing' shape cannot have a color");

// --- Rule: Pin shape cannot have a color ---
checkInvalid('Pin with color u (Pu)', 'Pu', "'Pin' shape cannot have a color");
checkInvalid('Pin with color in second part (CuPr)', 'CuPr', "'Pin' shape cannot have a color");

// --- Rule: cross-layer part-count consistency ---
checkInvalid('mismatched layer part counts (CuRu:SuWuHu)', 'CuRu:SuWuHu', 'same number of parts');
checkInvalid('mismatched part counts, 2 then 1 (CuRu:Cu)', 'CuRu:Cu', 'same number of parts');
checkValid('control: matching single-part layers (Cu:Ru:Su)', 'Cu:Ru:Su');

// --- Multiple rules accumulate in one pass ---
{
    total++;
    // 'Zz' → invalid shape 'Z' AND invalid color 'z': both errors should surface.
    const res = validateShapeCode('Zz');
    const hasShape = res.errors.some(e => e.includes("'Z' is not a valid shape"));
    const hasColor = res.errors.some(e => e.includes("'z' is not a valid color"));
    if (!res.isValid && hasShape && hasColor && res.errors.length >= 2) {
        console.log('✓ multiple rule violations accumulate (Zz)');
        passed++;
    } else {
        console.log(`✗ multiple rule violations accumulate (Zz)\n    actual: isValid=${res.isValid}, errors=${JSON.stringify(res.errors)}`);
        failed = true;
    }
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
