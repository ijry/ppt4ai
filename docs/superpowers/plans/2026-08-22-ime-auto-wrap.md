# IME Canvas Automatic Wrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visual automatic wrapping to the Canvas IME lab without inserting newline characters into stored text.

**Architecture:** Introduce a shared measured layout result used by both Canvas painting and click hit-testing. Explicit newlines and soft visual wraps produce the same line model, while only explicit newlines remain in `ImeSessionState`.

**Tech Stack:** TypeScript 6.0.3, Canvas 2D, Vitest 4.1.11, Playwright 1.62.1, Chromium 148.

## Global Constraints

- Do not add a UI component framework or any new runtime dependency.
- Keep soft wraps out of `committedText`; Enter remains a real `\n`.
- Keep the hidden contenteditable aligned with the Canvas caret.
- Use character-level wrapping only in the Stage 0 lab.
- Preserve current Chinese IME composition and duplicate-commit prevention behavior.

---

### Task 1: Shared Measured Text Layout

**Files:**
- Create: `apps/ime-lab/src/text-layout.ts`
- Create: `apps/ime-lab/src/text-layout.test.ts`
- Modify: `apps/ime-lab/src/canvas-painter.ts`

**Interfaces:**
- Consumes: `ImeSessionState`, `CanvasRenderingContext2D`, and `PaintMetrics` with `textBoxWidth`.
- Produces: `layoutImeText()` and `hitTestImeText()` with positioned visual lines and a caret rectangle.

- [ ] Write tests for soft wrap, explicit newline, composition wrap, and unchanged visible text.
- [ ] Run the layout tests and confirm they fail before implementation.
- [ ] Implement character measurement, line construction, caret placement, and hit-testing.
- [ ] Refactor the painter to render the shared layout result.
- [ ] Run layout and painter unit tests.

### Task 2: Wrapped-Line Click Placement

**Files:**
- Modify: `apps/ime-lab/src/ime-lab-controller.ts`
- Modify: `apps/ime-lab/src/ime-lab-controller.test.ts`

**Interfaces:**
- Consumes: `hitTestImeText()` from Task 1.
- Produces: click-to-caret behavior that understands soft and explicit lines.

- [ ] Add a failing controller test for clicking the second soft line.
- [ ] Replace controller-local line math with shared hit-testing.
- [ ] Verify empty-canvas origin placement and existing click behavior remain valid.

### Task 3: Browser Regression Proof

**Files:**
- Modify: `apps/ime-lab/e2e/ime.spec.ts`

**Interfaces:**
- Consumes: the IME lab test probe and configured text-box width.
- Produces: browser proof that soft wrapping moves both Canvas caret and native IME anchor without changing stored text.

- [ ] Add a Chromium E2E test that types past a narrow configured width.
- [ ] Assert `committedText` has no newline and caret Y advances one line.
- [ ] Run unit tests, typecheck, production build, and Chromium E2E.

