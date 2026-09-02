# Shapez 2 Building & Mechanics Reference

In-game machine footprints, belt mechanics, and platform constraints used by the blueprint layout.

Sourced from community posts; confidence flagged per row. Building data footprints are not fully verified against in-game values — see Unverified below.

---

## Machine footprints (tile dimensions)

| Building           | Footprint | Height (floors) | Confidence                                                            |
| ------------------ | --------- | --------------- | --------------------------------------------------------------------- |
| Cutter             | 2×1       | 1               | High (confirmed in multiple posts)                                    |
| Half Destroyer     | 1×1       | 1               | Medium                                                                |
| Rotator            | 1×1       | 1               | High (confirmed)                                                      |
| Stacker (Straight) | 2×1       | 2               | Medium-high (spans 2 floors: bottom input floor 1, top input floor 2) |
| Stacker (Bent)     | 2×1       | 1               | Medium                                                                |
| Swapper            | 2×1       | 1               | High (confirmed)                                                      |
| Painter            | 1×1       | 1               | High (48 painters fit a 1×1 platform across 3 floors)                 |
| Trash              | 1×1       | 1               | High (ground floor only, confirmed by feedback posts)                 |

Splitter is a belt mechanic in Shapez 2, not a standalone building. Split Cutter may be a separate building variant. Pin Pusher and Crystal Generator dimensions are unknown.

## Belt mechanics

Belts occupy tiles and support straight paths, turns, and splitting. Splitters and mergers are created by dragging from existing belts or by placing buildings with inputs/outputs facing adjacent belts. Belts can split from 1 input to up to 3 outputs, and up to 3 inputs to 1 output, but you can't have 2-in 2-out.

Belt lifts transport shapes between floors using the floor-change hotkeys (E up, Q down) while placing a belt.

There are no underground belts. **Belt launchers and catchers** throw items across a gap of 1–4 tiles; the floor system handles vertical routing. Launchers and catchers can be dragged and dropped in pairs, with the distance limited to 1 to 4 tiles.

An **Overflow Splitter** manages backpressure (e.g. between a cutter's dual outputs and a stacker).

## Input/output positions

Input and output directions on buildings are static, but buildings rotate in 4 directions and mirror with the F key. Relative positions are fixed per building type; orientation is chosen at placement.

Shapes enter from the rear and exit the front. For multi-input buildings like the Stacker, the two shape inputs come from different sides (one from each side for Bent Stacker, one above the other for Straight Stacker using different floors). The Painter takes shapes on a belt input and fluid through pipe inputs on the sides.

## Floors / verticality

Community sources describe **3 floors** as of the main release, with a 4th requested; later patches may have changed this — verify in-game. The Straight Stacker uses 2 floors (bottom shape on floor 1, top shape on floor 2, output on floor 1).

The Trash is restricted to the ground floor only.

## Layout catalog

The factory builder needs a building catalog with footprint (width × depth), height in floors, input positions (side + floor), output positions (side + floor), whether it can be mirrored, and the building-per-belt ratio (Straight Stacker = 6, Bent Stacker = 4, Swapper = 4, Painter = 4, per the in-game ratio display).

Foundations connect to other foundations or space belts only at notches, which are 1×4 build areas on the edge of each space grid tile. Each platform type (1×1 = 16×16 tiles, 2×1 = 32×16, etc.) has a fixed number of notches. That determines how many belt lanes can enter/exit a platform.

Belt launcher/catcher pairs (1–4 tile range) are the layout algorithm's way to route around obstacles vertically within a platform.

The notch system is the tightest constraint. Machines and belts inside a platform are relatively free-form, but shapes in and out are bottlenecked by those fixed 1×4 notch positions. Layout can work backwards from "how many inputs/outputs does this factory need" to "what platform size is required" before doing internal placement.

## Unverified

- Exact input/output tile positions for each building variant (e.g. "Cutter: input at tile (0,0) facing north, left output at (1,0) west, right output at (1,0) east")
- Whether buildings like the Stacker actually block the floor above them or just use it for input
- Exact floor count in the current version (3 vs 4)
- Crystal Generator and Pin Pusher footprints
- Whether the Bent Stacker is truly 1-floor or 2
