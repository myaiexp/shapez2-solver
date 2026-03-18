Let me dig into the specifics for you.Alright Mase, here's what I could piece together. Fair warning: some of this comes from community posts and discussions rather than a clean data source, so I'll flag confidence levels.

**1. Machine Footprints (tile dimensions)**

What I could confirm from community references:

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

**Couldn't confirm precisely:** Splitter (in Shapez 2, splitting is a belt mechanic, not a standalone building). Split Cutter might be a separate building variant. Pin Pusher, Crystal Generator dimensions are unknown from what I found.

**2. Belt Mechanics**

Belts occupy tiles and support straight paths, turns, and splitting. Splitters and mergers are created by dragging from existing belts or by placing buildings with inputs/outputs facing adjacent belts. Belts can split from 1 input to up to 3 outputs, and up to 3 inputs to 1 output, but you can't have 2-in 2-out.

Belt lifts transport shapes between floors using the floor-change hotkeys (E up, Q down) while placing a belt.

There are no underground belts like Factorio. Instead, you have **belt launchers and catchers** that throw items across a gap of 1-4 tiles, plus the floor system for vertical routing. Launchers and catchers can be dragged and dropped in pairs, with the distance limited to 1 to 4 tiles.

There's also an **Overflow Splitter** for managing backpressure situations (e.g., between a cutter's dual outputs and a stacker).

**3. Input/Output Positions**

Input and output directions on buildings are static, but you can rotate buildings in 4 directions and mirror them with the F key. So the relative positions are fixed per building type, but you choose orientation at placement time.

From what I gathered, the general pattern is: shapes enter from the rear and exit the front. For multi-input buildings like the Stacker, the two shape inputs come from different sides (one from each side for Bent Stacker, one above the other for Straight Stacker using different floors). The Painter takes shapes on a belt input and fluid through pipe inputs on the sides.

**4. Floors / Verticality**

You mentioned 4 vertical layers. From what I found in community discussions, the game had **3 floors** as of the main release, with the community actively requesting a 4th. It's possible the Dimensions update or a later patch changed this, so worth verifying in-game. The Straight Stacker specifically uses 2 floors (bottom shape on floor 1, top shape on floor 2, output on floor 1).

The Trash is restricted to the ground floor only, which is a layout constraint worth encoding.

**5. Info CC would need for an automatic factory builder**

Here's what jumps out as essential data the builder needs:

The building catalog with footprint (width × depth), height in floors, input positions (side + floor), output positions (side + floor), whether it can be mirrored, and the building-per-belt ratio (Straight Stacker = 6, Bent Stacker = 4, Swapper = 4, Painter = 4, per the in-game ratio display).

Platform/foundation constraints matter too. Foundations connect to other foundations or space belts only at notches, which are 1×4 build areas located on the edge of each space grid tile. Each platform type (1×1 = 16×16 tiles, 2×1 = 32×16, etc.) has a fixed number of notches. This determines how many belt lanes can enter/exit a platform.

Belt launcher/catcher pairs and their 1-4 tile range would be useful for the layout algorithm to route around obstacles vertically within a platform.

**What I couldn't find and you should test:**

- Exact input/output tile positions for each building variant (e.g., "Cutter: input at tile (0,0) facing north, left output at (1,0) west, right output at (1,0) east" type specifics)
- Whether buildings like the Stacker actually block the floor above them or just use it for input
- Exact floor count in the current version (3 vs 4)
- Crystal Generator and Pin Pusher footprints
- Whether the Bent Stacker is truly 1-floor or 2

One thing worth keeping in mind as you start: the notch system on platforms will probably be the trickiest constraint. The machines and belts inside a platform are relatively free-form, but getting shapes in and out is bottlenecked by those fixed 1×4 notch positions on platform edges. Your builder might want to work backwards from "how many inputs/outputs does this factory need" to "what platform size do I need" before doing internal layout.
