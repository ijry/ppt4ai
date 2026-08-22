# Stage 7 Table Editor Overlay Design

## 1. Goal

Add a reusable Vue 3 + UnoCSS `TableEditorOverlay` to `@ppt4ai/editor`. The overlay provides the visual and pointer interaction layer for selecting table cells while keeping document mutation in the headless `@ppt4ai/engine` package.

This slice covers:

- Drawing the table grid and source-cell bounds from a render/layout table node.
- Clicking a cell to create a single-cell selection.
- Pointer dragging to create an inclusive rectangular cell selection.
- Normalizing clicks inside merged cells to the source cell coordinate.
- Rendering an active table border and selected-cell outlines.
- Emitting JSON-safe selection events that a host can translate to `selectTableCell` engine commands.

The component uses only Vue and existing UnoCSS conventions. It does not import Element Plus, access browser globals outside Vue event handlers, or mutate the engine directly.

## 2. Non-goals

This slice does not implement:

- Fill or border toolbars.
- Row/column insertion, deletion, resizing, merge, or split commands.
- Table text editing or IME ownership.
- PPTX export.
- Theme color or PowerPoint table-style inheritance.

Those features consume the emitted selection contract in later slices.

## 3. Component Boundary

`TableEditorOverlay.vue` receives a clone-safe table layout and viewport transform:

```ts
interface TableEditorOverlayProps {
  active: boolean
  table: SceneTableNode
  transform: TextViewportTransform
}
```

The render node remains the source of truth for cell geometry. The overlay does not infer cell sizes from DOM measurements. The interactive layer is a single `role="grid"` with one roving `tabindex="0"` cell surface; all other cell surfaces use `tabindex="-1"`. Each rendered cell carries `role="gridcell"`, `aria-label`, `data-table-cell-row`, `data-table-cell-column`, and `data-table-cell-source` attributes for tests and host diagnostics.

The component emits:

```ts
type TableCellPoint = { row: number; column: number }
type TableCellSelection = {
  anchor: TableCellPoint
  focus: TableCellPoint
}

select: [selection: TableCellSelection]
selectEnd: [selection: TableCellSelection]
```

The emitted coordinates are source-cell coordinates. A merged cell therefore produces the same source coordinate regardless of which occupied grid coordinate was clicked. The host may dispatch the first point with `extend: false`, then dispatch the final point with `extend: true`.

## 4. Geometry and Hit Testing

The overlay converts every `SceneTableLayoutCell.bounds` rectangle through the existing `layoutRectToScreen` transform. Cell bounds are stable absolute rectangles, so the overlay can hit-test by checking the pointer point against the transformed rectangles in source-cell order.

For a pointer inside a merged cell, the hit-test returns that cell's source `row` and `column`. It never returns a synthetic coordinate for an occupied but non-source grid position.

The selection preview stores the anchor and current focus source points. Its visual rectangle is the union of every source cell whose occupied rectangle intersects the inclusive row/column range. This makes merged cells appear selected as one continuous region and avoids duplicate outlines.

When the pointer leaves the table during a drag, the current focus remains the last hit cell. Pointer capture is used on the overlay surface so the drag completes reliably without global listeners.

## 5. Interaction State

The component has three states:

1. Inactive: renders nothing interactive and has no selection attributes.
2. Active and idle: renders the table border and cell hit surfaces.
3. Dragging: renders the anchor/focus preview, emits `select` on movement when the focus changes, and emits `selectEnd` exactly once on pointer release or cancel.

Only primary-button pointer input starts a selection. `preventDefault()` and `setPointerCapture()` are applied after a valid hit. A click without movement emits one collapsed `selectEnd` selection. A drag emits a collapsed `select` followed by range updates and one `selectEnd`.

The component does not own text caret state. Enter and Space activate the focused cell and emit a collapsed selection. Full arrow-key navigation is deferred to a later keyboard-navigation slice; the current roving tabindex still makes the grid reachable and gives keyboard users a visible focus ring.

## 6. Visual Contract

- The active table uses a visible `border-2 border-blue-500` outline.
- Selected cells use a translucent blue background and an inset border; the grid remains visible underneath.
- The preview must not change layout dimensions or move surrounding content.
- Every interactive cell surface has an accessible label containing its source coordinate and span information.
- The focused cell has a visible `focus:ring-2 focus:ring-blue-500` indicator; focus is never removed without a replacement.
- Styling uses existing UnoCSS utility classes and fixed absolute geometry; no new component framework or CSS dependency is added.

## 7. Testing Strategy

Add focused Vue tests and pure geometry tests:

- Inactive overlay has no interactive cell surfaces.
- Active overlay renders one hit surface per source cell and the table border.
- A click maps through the viewport transform and emits a collapsed source-cell selection.
- Clicking any occupied coordinate of a merged cell emits its source coordinate.
- Reverse drag emits the correct anchor/focus rectangle and updates only when focus changes.
- Pointer cancel/release emits one `selectEnd` and releases capture.
- Enter/Space on the focused grid cell emits a collapsed selection without starting a pointer drag.
- `structuredClone` of selection payloads remains equal to the original.
- UnoCSS class usage does not introduce Element Plus or browser dependencies into headless packages.

## 8. Integration Sequence

The first implementation commit adds the pure overlay interaction model and component tests. A second commit exports the component and records progress. Engine command wiring, table formatting controls, and text editing are separate slices so each can retain one-command history semantics and focused verification.
