# Stage 7 Table Text Editing Design

> Date: 2026-08-23
>
> Scope: edit text directly inside a selected table source cell with the existing Chromium IME bridge, local draft previews, and one atomic engine write on commit. Complete theme inheritance, table-style coverage, toolbar expansion, and PPTX export XML remain later slices.

## Goal

Add direct table-cell text editing without duplicating the existing text editor, leaking browser dependencies into `@ppt4ai/engine`, or creating one undo entry per character. A merged cell edits through its normalized source cell and uses the full merged bounds. The feature remains Vue 3 plus UnoCSS only and introduces no Element Plus dependency.

## Chosen architecture

The editor adds a focused `TableCellTextEditor` host and a headless table-cell text editing controller. The host composes the existing `TextBoxEditor`; it does not reimplement IME composition, caret mapping, selection mapping, automatic wrapping, paragraph insertion, or pointer selection.

`TextBoxEditor` gains an optional selection-frame mode:

```ts
type TextBoxEditorSelectionFrame = 'resize' | 'none'

interface TextBoxEditorProps {
  // Existing properties omitted.
  readonly selectionFrame?: TextBoxEditorSelectionFrame
}
```

The default is `resize`, preserving the current text-box border and eight resize handles. Table-cell editing passes `none`, because a cell text session must not present cell-level resize controls. The text surface, caret, text selection, composition underline, and IME bridge remain active.

This is preferred over two alternatives:

1. Extracting a new generic inline editor would produce a cleaner component hierarchy, but requires a broad `TextBoxEditor` refactor before the table behavior can be verified.
2. Reimplementing text interaction in the table overlay would duplicate the project's highest-risk composition and selection code.

The selected design keeps reuse explicit and limits the shared-component change to one backward-compatible visual option.

## Responsibilities

### `TextBoxEditor`

- owns the browser IME bridge and text editor state;
- renders provisional composition text, caret, selection, and automatic line wrapping;
- emits cloned committed composition/body snapshots through `update:body`;
- renders the resize selection frame only when `selectionFrame` is absent or equals `resize`.

It remains unaware of tables and the engine.

### `TableCellTextEditor`

- receives one `SceneTableLayoutCell`, viewport transform, and active state;
- initializes a cloned local draft from `cell.body` when a session begins;
- renders `TextBoxEditor` with `cell.bounds` and `selectionFrame="none"`;
- updates only the local draft while typing or composing;
- emits `commit` with a cloned final body and `cancel` without a body;
- treats ordinary Enter as text input rather than a session command;
- commits on blur or `Ctrl+Enter` and cancels on `Escape` when not composing.

The component does not import or dispatch to `@ppt4ai/engine`.

### Table-cell text editing controller

The headless controller bridges a session target to the engine:

```ts
interface TableCellTextEditingController {
  getState(): EngineState
  commit(target: TableCellPoint, body: TextBody): EngineState
  cancel(): EngineState
}
```

`commit` validates finite integer coordinates, reselects the requested source coordinate with `selectTableCell`, then dispatches the existing `setTableCellText` command. Reselecting immediately before the write prevents a stale engine focus from changing a different cell. Selection changes do not enter document history; the text replacement remains the only history patch. Covered coordinates are normalized by the existing engine command to their merged source.

`cancel` returns the current engine state without dispatching a document mutation. Invalid coordinates throw before any dispatch. If the table or target cell no longer exists, the engine selection dispatch throws and no text mutation or history entry occurs.

## Session lifecycle

The table overlay remains responsible for cell selection and exposes an edit request:

- double-clicking a source-cell hit surface emits `edit` for that source point;
- pressing Enter on the focused cell emits `edit` after ensuring the cell has a collapsed selection;
- Space continues to activate/select a cell and does not enter text editing;
- while a text session is active, the table selection overlay is inactive so it cannot intercept text pointer events;
- the host resolves the source cell from the latest scene node before rendering the text editor;
- if a rerender removes the table or source cell, the host closes the session and discards the stale draft.

The initial session body is cloned. `update:body` replaces the local draft with another clone but does not call the engine. A successful commit emits or dispatches exactly once. Committing an unchanged body reaches the existing engine no-op comparison and creates no history entry.

## Keyboard and focus behavior

- `Enter`: insert the normal paragraph or line-break operation supplied by the text editor; never close the session.
- `Ctrl+Enter`: commit and close the session.
- `Escape`: cancel and close the session.
- blur/focus leaving the table text editor: commit once.
- composition in progress: session-level `Escape`, `Ctrl+Enter`, and blur handling must not race the browser's composition completion. The text editor remains the owner until composition ends; the final committed composition snapshot becomes the draft before a deferred close is processed.

After commit or cancel, keyboard focus returns to the table source-cell hit surface and the collapsed cell selection remains available for subsequent table commands.

## Geometry and merged cells

`SceneTableLayoutCell` is the single geometry and body source. Its `bounds` already represent the complete `rowSpan` and `colSpan`, so no table-specific text coordinate math is added. The existing viewport transform maps those bounds into the editor overlay. Hit testing already returns source cells, and the engine independently normalizes covered coordinates; both boundaries therefore agree for merged cells.

Text layout uses the existing `layoutText({ bounds: cell.bounds, body })` path. Automatic wrapping remains enabled by the existing layout engine. Manual Enter is only required when the user wants a paragraph break, not to wrap text at the cell edge.

## History and clone safety

- draft updates never modify `EditorEngine` state;
- composition previews never modify `EditorEngine` state;
- commit dispatches one existing `setTableCellText` command after target reselection;
- unchanged commit produces no document patch and no undo entry;
- cancel produces no document patch and no undo entry;
- emitted bodies, stored drafts, and controller payloads are cloned so later caller mutation cannot alter editor or engine state;
- undo and redo use the existing atomic body-replacement patch.

## Error handling

- invalid scene-cell bounds continue to fail in existing layout/overlay validation;
- invalid controller coordinates fail before selection or history changes;
- missing table or missing cell during commit fails through `selectTableCell`, leaving the stale draft uncommitted;
- invalid `TextBody` fails through the existing `setTableCellText` validation after selection is normalized, without a document history patch;
- repeated commit/blur signals are guarded by the session host so a session closes at most once.

## Public surface

`@ppt4ai/editor` exports:

- `TableCellTextEditor` and its prop/event types;
- `createTableCellTextEditingController` and its controller types;
- `TextBoxEditorSelectionFrame` as part of the extended text-box contract;
- the `edit` event contract on `TableEditorOverlay`.

No model or engine command is added. `@ppt4ai/engine` remains headless and imports no Vue, DOM, Canvas, `window`, or other browser global.

## Testing

Pure controller tests cover:

- commit reselects the requested table source and replaces only that cell body;
- covered merged coordinates resolve to the source cell;
- one changed commit adds exactly one undo entry and remains undoable/redoable;
- unchanged commit and cancel add no history;
- invalid or stale targets never write text;
- caller mutation after commit cannot change engine state.

Vue component tests cover:

- double-click and Enter request editing while Space only selects;
- table text editing renders the source-cell bounds and no resize frame or handles;
- the default `TextBoxEditor` still renders its border and eight handles;
- draft updates do not call the engine-facing commit event;
- composition preview and completion remain local until commit;
- Enter remains text input, while `Ctrl+Enter`, blur, and `Escape` follow commit/cancel semantics;
- merged source cells use their complete bounds;
- a session closes only once.

The slice finishes with boundary checks, focused tests, the complete test suite, type checking, production builds, and `git diff --check`.

## Out of scope

- rich table-cell formatting toolbar integration beyond the existing text editor state;
- multiple-cell simultaneous text replacement;
- complete PowerPoint theme color and table-style inheritance;
- table row/column resizing while editing text;
- PPTX table export XML;
- mobile, Safari, Firefox, or non-Chromium IME behavior.
