// Shared DOM class-name and id constants. SHAPE_LABEL_CLASS marks the <span> that holds
// a shape code inside each starting-shape item. It is assigned in shapeRendering.js
// (createShapeElement) and read back by readStartingShapes in uiControls.js, which
// builds its selector from this constant. Centralising the literal here keeps the
// assignment and read sites in lockstep — a rename can no longer silently break
// shape collection. The module stays dependency-free because colorMode.js, at the
// bottom of the rendering chain, imports it too.
export const SHAPE_LABEL_CLASS = 'shape-label';

// Read by colorMode.js and listed in uiControls.js's FORM_FIELDS. colorMode.js sits
// below the rendering chain uiControls.js imports, so the id cannot live there.
export const COLOR_MODE_SELECT_ID = 'color-mode-select';
