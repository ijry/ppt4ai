# IME Canvas Automatic Wrap Design

## Goal

Add PowerPoint-style visual wrapping to the Stage 0 Canvas IME lab. Text wraps when it reaches the configured text-box width, while the stored text remains unchanged. Pressing Enter remains the only operation that inserts a real newline character.

## Behavior

- Add `textBoxWidth` to Canvas paint metrics. The width is expressed in Canvas CSS pixels and begins at `origin.x`.
- Split committed and composition text into measured glyphs. Explicit `\n` characters force a new line; overflowing glyphs create soft visual lines.
- Keep `committedText` unchanged when a soft line is created.
- Render the composition underline and Canvas caret on the visual line produced by the same layout result.
- Use the same layout result for click hit-testing so painting, caret placement, and the hidden IME anchor cannot disagree.
- Use character-level wrapping for this Stage 0 risk harness. Word-boundary, punctuation, and full Unicode line-breaking rules belong to the later `@ppt4ai/layout` package.

## Architecture

Create a pure Canvas measurement module in `apps/ime-lab/src/text-layout.ts`. It consumes the current IME state, `CanvasRenderingContext2D`, and paint metrics, then returns visual lines, positioned glyphs, the caret rectangle, and hit-test metadata. `canvas-painter.ts` renders that result, while `ime-lab-controller.ts` uses it to map clicks back to committed-text offsets.

The IME reducer remains the source of truth for stored text and caret offset. Soft line breaks never enter `ImeSessionState`; explicit Enter continues to produce `insert-line-break` and a stored `\n`.

## Verification

- Unit tests prove wrapping occurs at `textBoxWidth` without inserting `\n`.
- Painter tests prove text and caret move to the correct visual line.
- Controller tests prove clicks on wrapped lines resolve to the correct committed offset.
- Chromium E2E proves typing past the width moves the Canvas and native IME caret anchor to the next visual line.

