// Shared DOM class-name and id constants. SHAPE_LABEL_CLASS marks the <span> that holds
// a shape code inside each starting-shape item. It is assigned in shapeRendering.js
// (createShapeElement) and read back via the selector
// '#starting-shapes .shape-item .shape-label' in main.js and persistence.js.
// Centralising the literal here keeps assignment and read sites in lockstep — a
// rename can no longer silently break shape collection. Lives in its own
// dependency-free module so persistence.js can import the constant without pulling
// in the rendering chain (colorMode.js, shapeRenderingPart.js, …).
export const SHAPE_LABEL_CLASS = 'shape-label';

// Read by colorMode.js and listed in uiControls.js's FORM_FIELDS. colorMode.js sits
// below the rendering chain uiControls.js imports, so the id cannot live there.
export const COLOR_MODE_SELECT_ID = 'color-mode-select';
