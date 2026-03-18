# Shapez 2 Blueprint Code Reference

Technical reference for generating game-importable blueprint strings from solver output.

Sources: [Shapez 2 Wiki — Blueprint Code](https://shapez2.wiki.gg/wiki/Blueprint_Code), [shapez-vortex](https://github.com/DontMash/shapez-vortex)

---

## Blueprint String Format

```
SHAPEZ2-2-<base64_data>$
```

| Part | Description |
|------|-------------|
| `SHAPEZ2` | Magic bytes identifying the file as a blueprint |
| `2` | Format version (version 1 blueprints use `1`) |
| `<base64_data>` | Base64-encoded gzip-compressed JSON (standard alphabet) |
| `$` | Terminator (not part of the data) |

### Encoding Pipeline

```
JSON object → JSON.stringify → gzip compress → base64 encode → "SHAPEZ2-2-" + data + "$"
```

### Decoding Pipeline

```
Strip "SHAPEZ2-2-" prefix and "$" suffix → base64 decode → gzip decompress → JSON.parse
```

---

## JSON Structure

```json
{
  "V": 1,
  "BP": {
    "$type": "Building",
    "Entries": [
      { "T": "CutterDefaultInternalVariant", "X": 0, "Y": 0, "R": 1 },
      { "T": "BeltDefaultForwardInternalVariant", "X": 0, "Y": -1, "R": 1 }
    ],
    "Icon": {
      "Data": [null, null, null, null]
    }
  }
}
```

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `V` | integer | Blueprint format version |
| `BP` | object | Blueprint data (Island or Building type) |

### Blueprint Data (`BP`)

| Field | Type | Description |
|-------|------|-------------|
| `$type` | `"Building"` or `"Island"` | Whether blueprint contains buildings or islands |
| `Entries` | array | Array of building/island entries |
| `Icon` | object | Icon data: `{ Data: [null, null, null, null] }` |

### Building Entry Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `T` | string | Yes | Building type identifier (see table below) |
| `X` | integer | No | X position (column, relative) |
| `Y` | integer | No | Y position (row, relative) |
| `L` | 0, 1, or 2 | No | Layer/floor (0 = ground, omit for default) |
| `R` | 0-3 | No | Rotation (see below, omit for default East) |
| `C` | string | No | Extra data (base64 encoded, for signals/labels) |

---

## Rotation Encoding

| Value | Direction | Description |
|-------|-----------|-------------|
| 0 | East | Default facing, inputs from West |
| 1 | South | Rotated 90° CW, inputs from North |
| 2 | West | Rotated 180°, inputs from East |
| 3 | North | Rotated 270° CW, inputs from South |

Our layout places machines facing South (inputs enter from back/North, outputs exit front/South), so all machines use **R=1**.

Belt direction mapping:
- Belt flowing South → R=1
- Belt flowing North → R=3
- Belt flowing East → R=0
- Belt flowing West → R=2

---

## Building Type Identifiers

### Processing Machines

| Solver Operation | Game Identifier | Notes |
|-----------------|-----------------|-------|
| Rotator CW | `RotatorOneQuadInternalVariant` | 90° clockwise |
| Rotator CCW | `RotatorOneQuadCCWInternalVariant` | 90° counter-clockwise |
| Rotator 180 | `RotatorHalfInternalVariant` | 180° rotation |
| Half Destroyer | `CutterHalfInternalVariant` | Destroys one half |
| Cutter | `CutterDefaultInternalVariant` | Splits into left/right halves |
| Cutter (mirrored) | `CutterDefaultInternalVariantMirrored` | Mirrored variant |
| Swapper | `HalvesSwapperDefaultInternalVariant` | Swaps left/right halves |
| Stacker | `StackerDefaultInternalVariant` | Stacks bottom + top |
| Stacker (mirrored) | `StackerDefaultInternalVariantMirrored` | Mirrored variant |
| Stacker (straight) | `StackerStraightInternalVariant` | Straight-through variant |
| Painter | `PainterDefaultInternalVariant` | Paints top layer |
| Painter (mirrored) | `PainterDefaultInternalVariantMirrored` | Mirrored variant |
| Pin Pusher | `PinPusherDefaultInternalVariant` | Adds pin layer |
| Crystal Generator | `CrystalGeneratorDefaultInternalVariant` | Generates crystals |
| Crystal Gen (mirrored) | `CrystalGeneratorDefaultInternalVariantMirrored` | Mirrored variant |
| Trash | `TrashDefaultInternalVariant` | Destroys input |

### Belts and Logistics

| Type | Game Identifier | Notes |
|------|-----------------|-------|
| Belt (forward) | `BeltDefaultForwardInternalVariant` | Straight conveyor |
| Belt (left turn) | `BeltDefaultLeftInternalVariant` | Curves left |
| Belt (right turn) | `BeltDefaultLeftInternalVariantMirrored` | Curves right (mirrored left) |
| Splitter (1→2 L) | `Splitter1To2LInternalVariant` | Splits belt into 2 |
| Splitter (1→2 mirrored) | `Splitter1To2LInternalVariantMirrored` | Mirrored splitter |
| Splitter (1→3) | `Splitter1To3InternalVariant` | Splits belt into 3 |
| Splitter (T-shape) | `SplitterTShapeInternalVariant` | T-shaped splitter |
| Merger (2→1 L) | `Merger2To1LInternalVariant` | Merges 2 belts |
| Merger (2→1 mirrored) | `Merger2To1LInternalVariantMirrored` | Mirrored merger |
| Merger (3→1) | `Merger3To1InternalVariant` | Merges 3 belts |
| Merger (T-shape) | `MergerTShapeInternalVariant` | T-shaped merger |

### Other Buildings

| Type | Game Identifier |
|------|-----------------|
| Extractor | `ExtractorDefaultInternalVariant` |
| Mixer | `MixerDefaultInternalVariant` |
| Mixer (mirrored) | `MixerDefaultInternalVariantMirrored` |

---

## Extra Data (`C` Field)

Base64-encoded binary data for building-specific configuration.

### Constant Signal
- Byte 0: Signal type (1=null, 2=conflict, 3=numbers, 4=zero, 5=one, 6=shapes, 7=colors)
- For numbers: bytes 1-4 = 32-bit little-endian integer
- For shapes: bytes after type = length + shape code string
- For colors: byte 1 = length (always 1), byte 2 = color char (`r`, `g`, `b`, etc.)

---

## Implementation Notes

### Coordinate System
- Positions are **relative** within the blueprint (not absolute world coords)
- Origin (0,0) is typically the first placed building
- Y increases downward (South)

### Multi-Floor Buildings
- Stacker spans floors 0 and 1; use `L: 0` for placement
- Belt lifts: place belt on floor 0 and floor 1 at same (X, Y) position
- Trash: restricted to `L: 0` (ground floor)

### Browser API for Encoding
```js
// Gzip compression using CompressionStream (modern browsers)
const blob = new Blob([jsonString]);
const cs = new CompressionStream('gzip');
const compressed = await new Response(blob.stream().pipeThrough(cs)).arrayBuffer();
const base64 = btoa(String.fromCharCode(...new Uint8Array(compressed)));
const blueprintString = `SHAPEZ2-2-${base64}$`;
```
