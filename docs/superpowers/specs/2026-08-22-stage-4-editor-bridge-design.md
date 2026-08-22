# Stage 4 ProseMirror and IME Editor Bridge Design

## Goal

Extend the completed deterministic text-layout slice with a headless ProseMirror adapter and a browser-facing IME transaction bridge. Text content, paragraph attributes, run marks, and `bodyPr` must round-trip without semantic loss, while editing operations use ProseMirror transactions and selections as their source of truth.

This slice does not implement a formatting toolbar, visual caret painting, vertical text, bullets, tables, or a complete Vue text-box component. It establishes the document/editing contract that those later features consume.

## Scope and boundaries

- `@ppt4ai/text` owns the ProseMirror schema, `TextBody` conversion, editor state creation, transaction helpers, and composition lifecycle state.
- `@ppt4ai/text` remains headless: no Vue, DOM, Canvas, browser globals, system fonts, or Element Plus.
- `@ppt4ai/editor` owns browser integration only: hidden `contenteditable` focus/event wiring and future visual selection integration.
- Existing `createImeInputBridge` and `reduceImeSession` contracts remain compatible; the new adapter translates bridge events into ProseMirror transactions rather than duplicating text storage.
- `@ppt4ai/model` remains the canonical JSON-safe document contract and is not coupled to ProseMirror types.
- Existing Stage 0 IME lab behavior remains covered by its current tests and browser checks.

## Data model

### ProseMirror schema

The schema contains `doc`, `paragraph`, and `text` nodes plus one `pptText` mark. The package adds runtime dependencies only on `prosemirror-model`, `prosemirror-state`, and `prosemirror-commands`; it does not depend on `prosemirror-view` in this headless slice.

- `doc` contains one or more `paragraph` nodes.
- `paragraph` contains zero or more `text` nodes and has JSON-safe `TextParagraphAttrs` fields as attrs.
- `doc` stores optional `TextBodyProperties` in a single `bodyPr` attr.
- `text` nodes store their text in ProseMirror's native text content.
- `pptText` stores a complete `TextMarks` value in one JSON-safe `marks` attr. No mark means the run has no marks.

The schema does not use custom node views or browser-specific node attributes. ProseMirror JSON is an intermediate representation; public APIs return cloned JSON-safe values.

### Body conversion

`textBodyToProseMirror(body)` validates and clones the input, then creates a ProseMirror document. Each source run becomes a text node with one `pptText` mark when marks are present. Empty runs are rejected by the existing model validator; empty paragraphs are preserved.

`proseMirrorToTextBody(document)` reads only the declared schema, restores `bodyPr` and paragraph attrs, and coalesces adjacent text nodes whose `TextMarks` values are deeply equal. It returns a fresh `TextBody` and never exposes ProseMirror-owned mutable objects.

The conversion boundary throws a deterministic `TextEditorModelError` for invalid model input, malformed ProseMirror JSON, missing paragraphs, unsupported nodes/marks, or invalid attrs. Errors include a stable path where one is available.

## Editor state and transactions

`createTextEditorState(body, options?)` constructs an `EditorState` from the schema. A private ProseMirror state plugin stores `{ composing, compositionText, suppressedTextInput }`, so document, selection, and composition metadata all advance through transactions. The state itself is the only editing source of truth.

The public transaction helpers are pure with respect to the caller's state:

- `replaceText(state, text)` replaces the current selection with text and returns a new `EditorState`.
- `insertParagraph(state)` inserts a paragraph split at the current selection, equivalent to Enter.
- `deleteBackward(state)` applies backward deletion using the current selection and returns a new state.
- `applyImeEvent(state, event)` maps `text-input` to replacement, `insert-line-break` to paragraph insertion, and `delete-backward` to deletion. `composition-start` and `composition-update` update metadata only. `composition-end` inserts its final text once, clears the provisional buffer, and records that text for duplicate suppression.
- `getTextEditorSnapshot(state)` returns `{ body, selection, composing, compositionText }`, with cloned body and JSON-safe `{ anchor, head }` selection offsets.

For `composition-end`, the final committed text is applied once. The immediately following `text-input` carrying the same text is suppressed and clears `suppressedTextInput`; any different input clears suppression and is applied normally. Composition text is never included in `body` before `composition-end`.

Selection positions use ProseMirror document positions internally. The public snapshot exposes the native `{ anchor, head }` positions so the editor/layout bridge can map them without inventing a second offset model.

## Browser bridge

The first browser-facing API is a small controller factory in `@ppt4ai/editor` that accepts an existing host element, an initial `TextBody`, and optional bridge factory. It creates the headless text editor state, connects `ImeBridgeEvent` callbacks to `applyImeEvent`, and exposes:

- `getSnapshot()` for body, selection, composition state, and visible text;
- `focus()` to focus the hidden input bridge;
- `dispatch(event)` for deterministic test and keyboard integration;
- `destroy()` to remove listeners and the hidden input.

The controller does not render text or implement pointer hit-testing in this slice. It is intentionally usable in tests without a Vue component. The existing editor shell remains unchanged except for exporting the controller integration point when needed.

## Error handling and safety

- Validate `TextBody` before conversion and validate output after conversion.
- Never mutate caller-owned body, marks, attrs, or ProseMirror JSON.
- Reject `NaN`, infinities, functions, DOM objects, and unsupported schema values at public boundaries.
- All snapshots and conversion outputs must pass `structuredClone`.
- Composition lifecycle events that arrive out of order are handled deterministically: update without start opens a composition, end without start commits its final text, and destroy makes later controller events no-ops.

## Testing strategy

### Headless text tests

- body/ProseMirror/body round-trip with bodyPr, paragraph attrs, marks, multiple runs, and empty paragraphs;
- adjacent equivalent marks coalescing;
- malformed model and malformed ProseMirror input errors;
- insert, replace, paragraph split, backward deletion, selection snapshots;
- composition start/update/end, final commit, and duplicate commit suppression;
- structured-clone safety and no browser globals.

### Editor bridge tests

- controller creates a state from a body without mutating input;
- bridge events update snapshot content and selection;
- composition provisional text stays out of body until end;
- destroy removes the bridge and ignores later events.

The full repository gate remains `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, and `pnpm build`. Browser E2E remains a follow-up verification when the controller is connected to the visual text-box host.

## Deferred work

- formatting commands and toolbar UI;
- Canvas/layout caret and selection painting in `@ppt4ai/render` or `@ppt4ai/editor`;
- pointer-to-ProseMirror position mapping;
- bullets, vertical text, tables, shaping, and browser font measurement;
- PPTX export mapping for edited runs.
