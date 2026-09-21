# Stage 4 Text Formatting Design

## Context

Stage 4 now has JSON-safe rich-text runs, ProseMirror conversion, IME transactions, pointer selection, caret geometry, and a reusable Vue text-box host. The next slice adds basic character and paragraph formatting without moving editing logic into Vue or introducing a component framework.

## Scope

- Character formatting: font family, font size, bold, italic, single underline, and text color.
- Paragraph formatting: left, center, and right alignment.
- Queryable toolbar state for collapsed selections, uniform ranges, and mixed ranges.
- A Vue + UnoCSS formatting toolbar that emits commands but does not own editor state.
- This slice excludes bullets, numbering, indentation controls, line spacing controls, vertical text, tables, rotated text, theme color resolution, undo integration, and PPTX export.

## Constraints

- Do not add Element Plus or any new runtime dependency.
- `@ppt4ai/text` stays headless and does not depend on Vue, DOM, Canvas, or editor UI code.
- Public command inputs, formatting state, snapshots, and event payloads remain `structuredClone` safe.
- ProseMirror positions remain UTF-16 based; formatting must not change text content or selection direction.
- Existing `TextMarks` and paragraph alignment values are the source of truth; no parallel UI-only formatting model is introduced.
- The completed slice produces one implementation commit.

## Headless Character Commands

Add `setTextMarks(state, patch)` and `toggleTextMark(state, name)`. A non-empty selection is formatted by visiting every text segment in the selection, merging the patch with each segment's current `TextMarks`, and replacing the single `pptText` mark. Undefined patch values remove that property, and an empty marks object removes the `pptText` mark entirely. Existing properties not named by the patch are preserved.

For a collapsed selection, commands update ProseMirror stored marks. The next inserted text inherits the selected formatting without changing existing text. Toggle commands derive their target from the current formatting state: uniform `true` becomes `false`; uniform `false` or mixed becomes `true`.

`fontFamily` must be a non-empty string, `fontSize` must be finite and positive, underline is `none` or `single`, and color uses the existing JSON-safe `Fill` contract. Invalid command input throws before changing state.

## Paragraph Commands

Add `setTextAlignment(state, align)`. The command updates every paragraph intersecting the current selection, including a collapsed selection's paragraph. It preserves all other paragraph attributes and selection direction. Alignment is limited to `left`, `center`, and `right`.

## Formatting State

Add `getTextFormattingState(state)` returning a JSON-safe structure with `bold`, `italic`, and `underline` as `true`, `false`, or `mixed`; `fontFamily`, `fontSize`, and `color` as a uniform value or `undefined`; and `align` as a uniform alignment or `undefined`. Missing boolean marks resolve to `false`, missing underline resolves to `false`, and differing values resolve to mixed or undefined.

Collapsed selections read stored marks first. If no stored marks exist, they read marks at the cursor with ProseMirror's inclusive mark semantics. Paragraph alignment reads all paragraphs intersecting the selection.

## Controller and Host

`TextEditorController` exposes character patch, boolean toggle, paragraph alignment, and formatting-state methods. Each command publishes exactly one cloned snapshot when state changes. `TextBoxEditor` emits the current formatting state beside body and selection updates so a parent toolbar can remain controlled.

## Toolbar

Add `TextFormattingToolbar.vue` as a controlled, presentational component. Props provide formatting state, font-family options, and font-size options. It uses semantic HTML controls and UnoCSS classes: icon-style buttons for bold, italic, underline, and alignment; native selects for font family and font size; and a native color input for sRGB color. It emits typed command payloads and never imports ProseMirror or mutates `TextBody`.

Mixed states use `aria-pressed="mixed"` on toggle buttons and an empty select value. Controls are disabled while the text editor is inactive. Locale keys name each control in zh-CN and en-US.

## Testing

- Headless tests cover partial-run selection formatting, preserving unrelated marks, run splitting/coalescing, reverse selection preservation, collapsed stored marks, invalid inputs, mixed state, and multi-paragraph alignment.
- Controller tests cover one publication per command and inert commands after destroy.
- Vue tests cover rendering state, disabled state, semantic emits, and no DOM text mirror.
- Full boundary checks, tests, typecheck, build, and diff checks remain mandatory.

## Acceptance

- Formatting a selection changes only selected characters and preserves text and selection direction.
- Collapsed formatting affects subsequent input without rewriting existing runs.
- Uniform and mixed toolbar states are deterministic and JSON safe.
- Paragraph alignment updates every intersecting paragraph and preserves unrelated paragraph attributes.
- The toolbar depends only on Vue, vue-i18n, and UnoCSS classes; Element Plus remains absent.
- All repository verification commands pass.
