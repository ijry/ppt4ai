# Stage 4 Text Editor Host Design

## Context

Stage 4 already provides headless TextBody layout, ProseMirror editing state, the IME input bridge, object selection bounds, and caret/selection geometry. This slice combines those pieces into a reusable Vue text-box host for activation, click placement, drag selection, and IME composition preview.

## Constraints

- Do not add Element Plus; UI uses Vue and UnoCSS only.
- The text, model, and render packages stay headless and do not depend on DOM, Canvas, or Vue.
- TextBody, snapshots, and public event data remain structuredClone safe; ProseMirror EditorState is not exposed to Vue.
- ProseMirror positions use UTF-16 offsets. Enter splits paragraphs and does not insert a newline text node.
- Composition provisional text is layout-only and never mutates TextBody; composition end commits once.
- This slice excludes formatting commands, bullets, vertical text, tables, rotated text, and PPTX export.

## Design

### Controller

Extend TextEditorController as the single text state entry point with getSnapshot, setSelection, subscribe, syncCaret, focus, dispatch, and destroy. IME callbacks, pointer selection transactions, and lifecycle checks all pass through the controller. Selection uses anchor and head; every state change notifies subscribers, while destroy disables notifications, input, and caret synchronization.

### TextBoxEditor

Add TextBoxEditor.vue as a controlled text-box host. Props provide TextBody, EMU bounds, viewport transform, active state, and an optional bridge factory. When active, it creates a controller, runs layoutText and createTextInteraction from the snapshot, renders through TextEditorOverlay, and converts pointer events to layout hit-test positions.

A click creates a collapsed selection. Pointer down stores the anchor, pointer move updates the head, and pointer up completes the transaction. Hit-test clamping handles points outside the text box. Pointer and controller resources are cleaned up on deactivation and unmount.

### Composition preview

compositionText remains outside the committed body. The host creates a short-lived preview body/layout with provisional text at the current head only for overlay geometry. After composition end the host returns to the committed layout and emits the committed body once.

### Visual layer

The host uses an absolutely positioned transparent pointer surface; existing SceneGraph/render output remains responsible for text pixels. Active state renders selection, caret, and optional composition preview through the existing overlay. Existing SelectionOverlay border and resize handles remain unchanged.

## Acceptance

- Inactive, selected, and editing states create only one valid controller and clean it up on deactivation/unmount.
- Clicks place the caret before or after each character; drag supports soft wraps, explicit paragraphs, and reverse selections.
- Selection changes update caret and IME bridge coordinates consistently across viewport origin and zoom changes.
- Composition update shows provisional text without changing the body; composition end adds committed text once.
- Old pointer, IME, and subscriber callbacks are inert after destroy.
- Editor/text tests, boundary checks, full tests, typecheck, build, and git diff check pass.
