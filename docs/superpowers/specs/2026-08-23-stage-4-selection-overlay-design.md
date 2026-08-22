# Stage 4 Selection Overlay Design

## Goal

Add the first visible selection affordance for editor elements: an active bounding border and eight resize handles. The geometry remains deterministic and testable outside the browser, while `@ppt4ai/editor` supplies the UnoCSS-only Vue overlay and emits final bounds for the existing engine `resize` command.

## Scope and boundaries

- `@ppt4ai/editor` owns selection overlay geometry, resize-session calculations, and the browser overlay component.
- `@ppt4ai/engine` remains the source of document mutation. The overlay does not duplicate document state or directly mutate elements.
- This slice supports one active element at a time. Multi-selection bounds can be displayed by callers, but proportional multi-element resize is deferred.
- Handles use the same coordinate space as the supplied bounds. The host is responsible for converting EMU coordinates to viewport pixels before rendering.
- No Element Plus, no new UI framework, and no CSS framework beyond the existing UnoCSS setup.
- Visual caret, text selection painting, pointer-to-ProseMirror mapping, and text-box editing activation remain the next slice.

## Geometry contract

`createSelectionOverlay(bounds, options?)` returns a cloned border rectangle and eight handle rectangles identified by `nw`, `n`, `ne`, `e`, `se`, `s`, `sw`, and `w`. Handle centers sit on the four corners and four edge midpoints. The default handle size is 8 coordinate units; callers may supply a positive size.

`resizeBounds(startBounds, handle, pointer, options?)` calculates a new positive rectangle while keeping the opposite edge fixed. The default minimum width and height are 1. Pointer movement is clamped at the minimum instead of allowing negative dimensions or flipping the element. The function accepts finite values only and throws deterministic errors for invalid input.

The overlay emits the final `Rect` from a resize session. A caller can dispatch `{ type: 'resize', elementId, bounds }` through `EditorEngine`; undo/redo therefore continues to use the existing patch history.

## Vue component

`SelectionOverlay.vue` renders nothing when `active` is false. When active it renders one border and eight handle buttons with directional cursor classes. It accepts `bounds`, `handleSize`, and `active` props and emits `resize-start`, `resize`, and `resize-end` with the handle name and pointer coordinates. It does not own pointer capture or engine state; those responsibilities stay with the editor host.

## Testing

- Geometry tests cover all handle centers, cloned input/output, custom handle size, corner and edge resizing, minimum dimensions, and invalid values.
- Component tests are intentionally limited to the public render contract: inactive overlays are empty and active overlays contain one border plus eight handles with stable data attributes.
- Existing boundary, unit, type, build, and diff checks remain required.
