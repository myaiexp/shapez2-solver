# Design Document: Unused Shape/Color Filtering for Shapez2 Solver

## Overview

This document describes the design for automatically detecting and excluding unused shapes/colors from the search space in the Shapez2 solver. The feature analyzes the target shape to determine which colors and shapes are actually needed, then filters the available starting shapes to only include relevant ones.

## Problem Statement

**Example Problem:**
- Available inputs: `CuCuCuCu`, `RuRuRuRu`, `SuSuSuSu`, `WuWuWuWu`
- Goal: `WuWuWuWu:WuCuWuCu`
- Observation: `Ru` and `Su` are not needed since the goal only contains `Wu` and `Cu` shapes

Currently, the solver includes all starting shapes in the search, even when some are irrelevant to the goal. This unnecessarily expands the search space and can slow down solving.

## Algorithm

### Step 1: Extract Required Colors from Target

Parse the target shape code and collect all unique colors that appear in paintable shapes.

```javascript
function getRequiredColors(targetShape) {
    const colors = new Set();
    
    for (const layer of targetShape.layers) {
        for (const part of layer) {
            // Skip unpaintable shapes
            if (UNPAINTABLE_SHAPES.includes(part.shape)) continue;
            
            // Add non-uncolored parts
            if (part.color !== 'u') {
                colors.add(part.color);
            }
        }
    }
    
    return colors;
}
```

### Step 2: Extract Required Shapes from Target

Parse the target shape code and collect all unique shape types that appear.

```javascript
function getRequiredShapes(targetShape) {
    const shapes = new Set();
    
    for (const layer of targetShape.layers) {
        for (const part of layer) {
            // Skip nothing and crystal shapes (they're generated, not base shapes)
            if (part.shape !== NOTHING_CHAR && part.shape !== CRYSTAL_CHAR) {
                shapes.add(part.shape);
            }
        }
    }
    
    return shapes;
}
```

### Step 3: Filter Starting Shapes

For each starting shape, check if it contains any required shapes or colors. Keep only shapes that are potentially useful.

```javascript
function filterStartingShapes(startingShapes, requiredShapes, requiredColors) {
    return startingShapes.filter(shapeCode => {
        const shape = Shape.fromShapeCode(shapeCode);
        
        for (const layer of shape.layers) {
            for (const part of layer) {
                // Check if this part's shape is required
                if (requiredShapes.has(part.shape)) {
                    return true;
                }
                
                // Check if this part's color is required (and shape is paintable)
                if (!UNPAINTABLE_SHAPES.includes(part.shape) && 
                    requiredColors.has(part.color)) {
                    return true;
                }
            }
        }
        
        return false;
    });
}
```

### Complete Algorithm

```javascript
function filterUnusedShapes(startingShapeCodes, targetShapeCode) {
    const target = Shape.fromShapeCode(targetShapeCode);
    const requiredColors = getRequiredColors(target);
    const requiredShapes = getRequiredShapes(target);
    
    // If target has no specific colors or shapes, keep all starting shapes
    if (requiredColors.size === 0 && requiredShapes.size === 0) {
        return startingShapeCodes;
    }
    
    return filterStartingShapes(startingShapeCodes, requiredShapes, requiredColors);
}
```

## Integration Points

### Integration with main.js

The filtering should be applied in the solve button click handler, before sending data to the worker.

**Location:** [`main.js:157-236`](main.js:157)

**Changes:**
1. Add a new configuration option (checkbox) to enable/disable the filtering feature
2. Apply filtering to `starting` array before passing to worker
3. Optionally show a notification about which shapes were filtered out

```javascript
// In the solve button click handler, after gathering inputs:
const filterUnusedShapes = byId('filter-unused-shapes').checked;

let filteredStarting = starting;
if (filterUnusedShapes) {
    const originalCount = starting.length;
    filteredStarting = filterUnusedShapes(starting, target);
    const removedCount = originalCount - filteredStarting.length;
    if (removedCount > 0) {
        console.log(`Filtered out ${removedCount} unused starting shapes`);
    }
}
```

### Integration with shapeSolver.js

No changes required in the solver itself - it already receives the filtered starting shapes as input.

### UI Changes

Add a new checkbox option in the settings panel:

```html
<div class="option-group">
    <label class="checkbox-label">
        <input type="checkbox" id="filter-unused-shapes" checked>
        <span>Filter unused starting shapes</span>
        <span class="help-text">Automatically remove shapes/colors not needed for the target</span>
    </label>
</div>
```

## Edge Cases

### Edge Case 1: Target Contains Only Uncolored Shapes

If the target shape has no colors (all `u`), the filtering will keep shapes that have matching shapes (e.g., if target needs `C` shapes, keep `CuCuCuCu` but not `RuRuRuRu`).

### Edge Case 2: Target Contains Only Colors, No Specific Shapes

If the target has colors but all shapes are generic (e.g., `CuCuCuCu` with different colors), the filtering will keep shapes that have the required colors.

### Edge Case 3: Empty Starting Shapes After Filtering

If all starting shapes are filtered out, show a warning to the user and don't start the solver.

### Edge Case 4: Pin and Crystal Shapes

Pins (`P`) and crystals (`c`) are handled specially:
- Pins are not paintable, so they're only kept if the target needs pins
- Crystals are generated shapes, so they're only kept if the target needs crystals

### Edge Case 5: Multi-layer Targets

The algorithm correctly handles multi-layer targets by checking all layers.

## Example Walkthrough

**Input:**
- Starting shapes: `CuCuCuCu`, `RuRuRuRu`, `SuSuSuSu`, `WuWuWuWu`
- Target: `WuWuWuWu:WuCuWuCu`

**Step 1: Extract Required Colors**
- Target layers: `WuWuWuWu` and `WuCuWuCu`
- Colors found: `u`, `u`, `u`, `u`, `u`, `u`, `u`, `u` (all uncolored)
- Required colors: `{}` (empty set)

**Step 2: Extract Required Shapes**
- Shapes found: `W`, `W`, `W`, `W`, `W`, `C`, `W`, `C`
- Required shapes: `{W, C}`

**Step 3: Filter Starting Shapes**
- `CuCuCuCu`: Contains `C` shape → **KEEP**
- `RuRuRuRu`: Contains `R` shape (not in required) → **REMOVE**
- `SuSuSuSu`: Contains `S` shape (not in required) → **REMOVE**
- `WuWuWuWu`: Contains `W` shape → **KEEP**

**Result:** `CuCuCuCu`, `WuWuWuWu`

## Performance Impact

- **Time Complexity:** O(n * m * l) where n = starting shapes, m = layers per shape, l = parts per layer
- **Space Complexity:** O(1) additional space (sets of colors and shapes)
- **Expected Improvement:** Significant reduction in search space when target uses only subset of available shapes/colors

## Future Enhancements (Out of Scope for v1)

1. **Operation Filtering:** Skip operations that aren't needed (e.g., skip Painter if no painting required)
2. **Intermediate Shape Analysis:** Consider that intermediate steps might need certain colors
3. **User Override:** Allow users to manually specify which shapes to keep/remove
4. **Presets:** Save and load shape filtering presets

## Testing Strategy

1. **Unit Tests:**
   - Test `getRequiredColors` with various target shapes
   - Test `getRequiredShapes` with various target shapes
   - Test `filterStartingShapes` with edge cases

2. **Integration Tests:**
   - Test the complete filtering pipeline with real solver inputs
   - Verify solver still finds solutions after filtering
   - Verify performance improvement in search time

3. **Manual Testing:**
   - Test with the example from the problem statement
   - Test with various combinations of shapes and colors
   - Test edge cases (empty results, all shapes kept, etc.)

## Implementation Steps

1. Add helper functions to `shapeOperations.js`:
   - `getRequiredColors(targetShape)`
   - `getRequiredShapes(targetShape)`
   - `filterUnusedShapes(startingShapeCodes, targetShapeCode)`

2. Update `main.js`:
   - Add UI checkbox for the feature
   - Apply filtering before sending to worker
   - Add user feedback about filtered shapes

3. Add tests for the new functionality

4. Document the feature in README
