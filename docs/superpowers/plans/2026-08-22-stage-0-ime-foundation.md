# Stage 0: Workspace Foundation and IME Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build the pnpm workspace and prove, with repeatable automation plus a Windows manual check, that a Canvas-rendered caret, a hidden contenteditable, and a Chinese IME candidate window work together in modern Chromium desktop browsers.

**Architecture:** Start with the smallest Vite/Playwright IME risk harness. Only after the go/no-go gate passes, expand it into the complete workspace. The input bridge owns browser input, composition lifecycle, and candidate-anchor placement; the Canvas demo consumes normalized events and paints committed text, composition text, and the caret. ProseMirror model/state/transform integration is deferred to phase 4; phase 0 does not use prosemirror-view.

**Tech Stack:** Node.js 20.20.2 (minimum 20.19.0), pnpm 10.33.2, TypeScript 6.0.3, Vite 8.2.2, Vue 3.5.41, vue-i18n 11.2.8, Vitest 4.1.11, Playwright 1.62.1, Chromium 148, Canvas 2D, native contenteditable and Composition Events.

## Global Constraints

- Target only modern Chromium desktop: latest two Chrome/Edge versions; no Safari, Firefox, iOS, or Android branches.
- Use TypeScript strict everywhere; enable noUncheckedIndexedAccess, exactOptionalPropertyTypes, and useUnknownInCatchVariables.
- Pin TypeScript to 6.0.3; do not upgrade to 7.x until repository tests re-prove vue-tsc compatibility.
- Pin pnpm 10.33.2 and Node >=20.19.0; use exact dependency versions, never ^, ~, or latest.
- Keep headless core separate from Vue UI; core packages cannot import Vue or access the DOM, except the text IME bridge.
- Store model coordinates in native OOXML units. Name screen types ScreenPoint and ScreenRect.
- Enable i18n from the first UI commit with semantic keys, never hash keys.
- Project license is Apache-2.0; never read, copy, or derive PPTist src; never install emf-to-png.
- Record every dependency in THIRD-PARTY.md; phase 0 must not add prosemirror-view.
- E2E IME proof must use Chromium CDP Input.imeSetComposition and Input.insertText, not keyboard.type().
- Native OS candidate windows cannot be reliably asserted in headless screenshots; keep a Windows Chinese IME manual check.

## File Map

| Path | Responsibility |
|---|---|
| package.json, pnpm-workspace.yaml, pnpm-lock.yaml | root scripts, pins, and workspace |
| tsconfig.base.json, vitest.workspace.ts, playwright.config.ts | TypeScript, unit-test, browser-test baseline |
| packages/text/src/ime/types.ts | public IME event, state, and screen-coordinate types |
| packages/text/src/ime/create-ime-input-bridge.ts | hidden contenteditable lifecycle, event normalization, anchor placement |
| packages/text/src/ime/*.test.ts | state, positioning, cleanup, repeated composition tests |
| packages/text/src/ime/ime-session.ts | pure state reducer for committed/composition text |
| apps/ime-lab/src/canvas-painter.ts | Canvas text, underline, and caret painting |
| apps/ime-lab/src/main.ts | bridge/session/painter composition and test probe |
| apps/ime-lab/e2e/ime.spec.ts | CDP-driven native composition proof |
| apps/ime-lab/e2e/manual-ime-checklist.md | Windows manual candidate-window checklist |
| packages/*, apps/playground | full skeleton after the IME gate |
| THIRD-PARTY.md, README.md, 进度.md | license, commands, risk result, handoff |

---

### Task 1: Bootstrap the IME Risk Harness

**Files:** Create root manifests, TypeScript and Playwright configs, THIRD-PARTY.md, packages/text manifests, and apps/ime-lab Vite entry, styles, and smoke test.

**Interfaces:** Consumes Node.js >=20.19.0, pnpm 10.33.2, and Playwright Chromium. Produces package @ppt4ai/text, scripts build/typecheck/test/test:e2e/dev:ime, and URL http://127.0.0.1:4173 with data-testid=ime-canvas.

- [ ] Step 1: Create exact root manifests. Use packageManager pnpm@10.33.2, engines.node >=20.19.0, exact dev dependencies @playwright/test 1.62.1, typescript 6.0.3, vite 8.2.2, and vitest 4.1.11. Declare packages/* and apps/*, set .npmrc save-exact=true, and enable all strict flags above.
- [ ] Step 2: Create the runnable app. Render a 960 by 540 Canvas with data-testid=ime-canvas. Configure Vite on port 4173 and Playwright reuseExistingServer. The smoke test must assert both intrinsic dimensions with toHaveJSProperty.
- [ ] Step 3: Install and verify. Run corepack enable, pnpm install, and pnpm exec playwright install chromium. Then run pnpm typecheck && pnpm build && pnpm test:e2e apps/ime-lab/e2e/smoke.spec.ts. Expect exit 0 and 1 passed.
- [ ] Step 4: Record exact versions and licenses in THIRD-PARTY.md and commit with message chore: bootstrap IME risk harness.

### Task 2: Define the Browser-Neutral IME Contract

**Files:** Create packages/text/src/ime/types.ts, ime-session.ts, ime-session.test.ts; modify packages/text/src/index.ts.

**Interfaces:** Consumes no DOM APIs. Produces ScreenPoint, ScreenRect, ImeBridgeEvent, ImeSessionState, initialImeSessionState, and reduceImeSession(state, event).

- [ ] Step 1: Write failing reducer tests covering composition-start, composition-update('zhong') leaving committed text unchanged, composition-end clearing transient text, text-input('中') appending once, delete-backward removing one Unicode code point from A中, and two cycles producing exactly 中文.
- [ ] Step 2: Run pnpm exec vitest run packages/text/src/ime/ime-session.test.ts; expect failure because the module is absent.
- [ ] Step 3: Implement an exhaustive pure reducer. Composition events never mutate committed text; only text-input commits. Use readonly ScreenPoint x/y, ScreenRect x/y/width/height, and a discriminated event union.
- [ ] Step 4: Run the focused test; expect all tests to pass with no DOM environment. Export the contract from packages/text/src/index.ts.
- [ ] Step 5: Commit with git add packages/text/src && git commit -m feat(text):-define-IME-session-contract.

---
### Task 3: Implement the Hidden Contenteditable Bridge

**Files:** Create packages/text/src/ime/create-ime-input-bridge.ts and its test; modify packages/text/src/index.ts and root package.json.

**Interfaces:** Consumes ScreenRect, an HTMLElement host, and callback `(event: ImeBridgeEvent) => void`. Produces ImeInputBridge with `focus()`, `setCaretRect(rect)`, `getCaretClientRect()`, and `destroy()`.

- [ ] Step 1: Add exact dev dependency happy-dom 20.8.3 and configure the DOM unit test with `// @vitest-environment happy-dom`. Use happy-dom only for styles, listeners, and cleanup; never use it to claim native composition support.
- [ ] Step 2: Write failing tests for anchor placement, hidden styles, listener mapping, viewport clamping, idempotent destroy, and two bridge instances leaving no leaked `[data-ppt4ai-ime-input]` elements.
- [ ] Step 3: Run `pnpm exec vitest run packages/text/src/ime/create-ime-input-bridge.test.ts`; expect failure because the bridge module is absent.
- [ ] Step 4: Implement one `contenteditable="plaintext-only"` element with `position: fixed`, `width: 1px`, minimum `height: 1px`, `opacity: 0`, `overflow: hidden`, `white-space: pre`, `caret-color: transparent`, `z-index: -1`, `aria-hidden: true`, and `data-ppt4ai-ime-input`. Clamp x/y to the viewport. Register compositionstart/update/end and beforeinput; map insertText and insertCompositionText only when data is non-empty, map deleteContentBackward to delete-backward, and suppress text-input while composing. Clear textContent and restore a collapsed selection after committed input.
- [ ] Step 5: Assert exact event order, empty data behavior, deletion, clamping, repeated destroy, and cleanup. Run the focused bridge tests; expect all pass.
- [ ] Step 6: Export the bridge and commit `git add package.json pnpm-lock.yaml packages/text/src && git commit -m "feat(text): add hidden IME input bridge"`.

### Task 4: Draw Composition Text and the Canvas Caret

**Files:** Create apps/ime-lab/src/canvas-painter.ts, canvas-painter.test.ts, ime-lab-controller.ts, and ime-lab-controller.test.ts; modify main.ts, style.css, and apps/ime-lab/package.json.

**Interfaces:** Consumes ImeSessionState and CanvasRenderingContext2D. Produces `paintImeFrame(context, state, metrics): PaintResult` and `createImeLabController(options)`, with `PaintResult.caretRect` passed to `ImeInputBridge.setCaretRect`.

- [ ] Step 1: Write failing painter tests using a fake Canvas context. Assert fillText runs once for committed text and once for composition text, an underline is drawn only for composition text, and a 1 CSS-pixel caret follows the combined visible text. Use deterministic measureText widths: 中 => 24 and zhong => 60.
- [ ] Step 2: Run `pnpm exec vitest run apps/ime-lab/src/canvas-painter.test.ts`; expect failure because the painter is absent.
- [ ] Step 3: Implement deterministic painting. Use devicePixelRatio for backing-store size while public metrics remain CSS pixels. Paint a white background, committed text in #111827, composition text in #2563eb, a 2px composition underline, and a 1px caret. Return `{ caretRect: ScreenRect, visibleText: string }`; derive caret y/height from the same baseline/font metrics used for text.
- [ ] Step 4: Write failing controller tests with fake bridge and painter. Verify composition-update('zhong') repaints immediately and calls setCaretRect; verify text-input('中') clears composition and paints exactly 中.
- [ ] Step 5: Implement a controller owning one reducer state, subscribing to bridge events, repainting, moving the hidden input to the painter caret rect, and exposing `getSnapshot()`. Clicking Canvas focuses the hidden input. Expose only a serializable `window.__IME_LAB__` probe with `getSnapshot()`, `getInputRect()`, and `setCaretOrigin(point)`.
- [ ] Step 6: Run `pnpm exec vitest run apps/ime-lab/src/*.test.ts packages/text/src/ime/*.test.ts` and `pnpm typecheck`; expect all pass and no public `any`.
- [ ] Step 7: Commit `git add apps/ime-lab packages/text && git commit -m "feat: render IME composition on canvas"`.

### Task 5: Prove Native Composition Through Chromium CDP

**Files:** Delete apps/ime-lab/e2e/smoke.spec.ts; create apps/ime-lab/e2e/ime.spec.ts; modify playwright.config.ts.

**Interfaces:** Consumes `window.__IME_LAB__`, `[data-ppt4ai-ime-input]`, and a Playwright CDPSession. Produces automated evidence for focus, composition lifecycle, transient Canvas state, committed text, and caret-anchor movement.

- [ ] Step 1: Add a CDP helper using `Input.imeSetComposition({ text: 'zhong', selectionStart: 5, selectionEnd: 5 })`; use `Input.insertText({ text: '中' })` for commit. Never synthesize CompositionEvent in page JavaScript.
- [ ] Step 2: Focus the hidden input, start composition, and assert snapshot `{ committedText: '', compositionText: 'zhong', isComposing: true, visibleText: 'zhong' }`. Assert the Canvas is nonblank with a bounded pixel check or a screenshot baseline generated in the installed Chromium.
- [ ] Step 3: Commit with CDP and assert `{ committedText: '中', compositionText: '', isComposing: false, visibleText: '中' }`. Repeat `wen` => `文` and assert exactly `中文`, never duplicated composition or committed text.
- [ ] Step 4: Set caret origin to `(50,80)`, focus, compose, and compare `getInputRect()` with the DOM range caret rect within 1-2 CSS pixels. Move origin to `(320,240)` during composition and assert both move by the same delta without ending composition.
- [ ] Step 5: Run `pnpm test:e2e --project=chromium` and `pnpm exec playwright test apps/ime-lab/e2e/ime.spec.ts --project=chromium --headed`; expect both pass and headed mode visibly shows zhong before 中 after commit.
- [ ] Step 6: Commit `git add apps/ime-lab/e2e playwright.config.ts && git commit -m "test: prove Chromium IME canvas bridge"`.

### Task 6: Complete the Windows Chinese IME Go/No-Go Gate

**Files:** Create apps/ime-lab/e2e/manual-ime-checklist.md and docs/verification/2026-08-22-ime-spike-result.md; modify 进度.md.

**Interfaces:** Consumes `pnpm dev:ime`, headed Chrome/Edge, and a named Windows Chinese IME. Produces an explicit GO or NO-GO with OS, browser, input-method, scale, and zoom metadata.

- [ ] Step 1: Write the checklist before running it. Require typing zhongwen at three Canvas positions; visible and updating composition text; native candidate window adjacent to the Canvas caret; candidate movement while composition remains active; exactly-once 中文 commit; Escape cancellation; Unicode Backspace; browser zoom 80%, 100%, 125%; display scale 100% and 150% when available; latest Chrome and latest Edge.
- [ ] Step 2: Run `pnpm dev:ime` and record Windows build, browser versions, IME name/version, display scale, zoom, every checklist result, and local screenshot/recording paths in the verification document.
- [ ] Step 3: Mark GO only if candidate placement passes in both Chrome and Edge and committed text never duplicates. Mark NO-GO if the candidate cannot follow the caret, composition is not visible before commit, or text is lost/duplicated. NO-GO blocks Tasks 7-9 and requires architecture review.
- [ ] Step 4: For GO, update 进度.md with the passed gate and verification path; for NO-GO, record failed conditions and stop. Commit with `git add apps/ime-lab/e2e/manual-ime-checklist.md docs/verification/2026-08-22-ime-spike-result.md 进度.md && git commit -m "docs: record IME spike decision"`.

---
### Task 7: Expand the Approved Spike into the Full Workspace Skeleton

**Files:** Create tsconfig.json, vitest.workspace.ts, packages/model, geometry, layout, render, charts, animate, pptx-import, pptx-export, engine, editor, and player manifests/tsconfigs/indexes; modify packages/text; create scripts/check-package-boundaries.mjs and its test; modify package.json.

**Interfaces:** Consumes the package map in architecture spec section 1.2. Produces twelve named @ppt4ai/* packages with exports, types, build, typecheck, test scripts and enforced dependency directions.

- [ ] Step 1: Write the boundary test before package creation. Assert all twelve package names exist, no core package lists Vue, editor may depend on engine but engine cannot depend on editor, and player builds without editor.
- [ ] Step 2: Run `pnpm exec vitest run scripts/check-package-boundaries.test.ts`; expect failure listing missing manifests.
- [ ] Step 3: Create manifests and focused entry points. Every package uses `type: module`, publishes dist/index.js and dist/index.d.ts, and builds with `tsc -p tsconfig.json`. Entry files contain only public type shells needed to prove dependency direction; do not add fake behavior.
- [ ] Step 4: Add root project references and a boundary checker. The checker fails on forbidden internal edges and imports of Vue or DOM globals from headless source, except the documented text IME submodule.
- [ ] Step 5: Run `pnpm check:boundaries`, `pnpm typecheck`, and `pnpm build`; expect exit 0, twelve packages built, and declarations with no unresolved workspace imports.
- [ ] Step 6: Commit `git add package.json pnpm-lock.yaml tsconfig.json vitest.workspace.ts packages scripts && git commit -m "chore: scaffold ppt4ai workspace packages"`.

### Task 8: Add the Minimal Vue Editor Shell and Semantic i18n

**Files:** Modify packages/editor/package.json and index.ts; create packages/editor/vite.config.ts, uno.config.ts, src/PptEditor.vue, src/i18n.ts, src/locales/zh-CN.ts, src/locales/en-US.ts; create apps/playground manifests, Vite entry, App.vue, and locale test; modify root package.json and THIRD-PARTY.md.

**Interfaces:** Consumes Vue 3, UnoCSS, and semantic locale keys. Produces `PptEditor`, `createPpt4aiI18n(locale)`, and a runnable `pnpm dev` playground.

- [ ] Step 1: Write a failing locale parity test. Flatten zh-CN and en-US keys, assert exact equality and presence of editor.canvas.ariaLabel and toolbar.insert.shape, and reject keys matching a hash-like hexadecimal pattern.
- [ ] Step 2: Run `pnpm exec vitest run apps/playground/src/editor-shell.test.ts`; expect failure because locale modules are absent.
- [ ] Step 3: Add exact dependencies vue 3.5.41, vue-i18n 11.2.8, vue-tsc 3.3.11, @vitejs/plugin-vue 6.0.8, and unocss 66.8.1. Configure UnoCSS in Vite and import its generated stylesheet. PptEditor renders one accessible editor region and a toolbar label from i18n. UnoCSS is the only UI styling framework; do not add Element Plus or any replacement component framework.
- [ ] Step 4: Create the playground mount. Install createPpt4aiI18n('zh-CN') and mount App.vue; add root dev script.
- [ ] Step 5: Run `pnpm exec vitest run apps/playground/src/editor-shell.test.ts`, `pnpm --filter @ppt4ai/playground build`, and `pnpm typecheck`; expect locale parity, Vite build, and vue-tsc with TypeScript 6.0.3 to pass.
- [ ] Step 6: Record Vue and tooling licenses in THIRD-PARTY.md and commit `git add package.json pnpm-lock.yaml packages/editor apps/playground THIRD-PARTY.md && git commit -m "feat(editor): add minimal localized shell"`.

### Task 9: Close Phase 0 with a Clean-Clone Verification

**Files:** Modify README.md and 进度.md; create docs/verification/2026-08-22-stage-0-verification.md.

**Interfaces:** Consumes all root scripts and the GO result from Task 6. Produces reproducible setup instructions and a phase 0 completion record.

- [ ] Step 1: Document prerequisites and exact commands in README.md: corepack enable, pnpm install --frozen-lockfile, pnpm test, pnpm test:e2e, pnpm typecheck, pnpm build, pnpm dev, and pnpm dev:ime. Link the architecture spec, IME result, and manual checklist.
- [ ] Step 2: Use a new temporary git worktree at a sibling path; never delete or reset the current worktree. Run `pnpm install --frozen-lockfile`, then `pnpm check:boundaries && pnpm test && pnpm test:e2e && pnpm typecheck && pnpm build`; expect every command exit 0 and no untracked generated files beyond ignored output.
- [ ] Step 3: Record exact Node, pnpm, TypeScript, Chromium, and OS versions plus every command result in docs/verification/2026-08-22-stage-0-verification.md. Keep environment warnings distinct from passes.
- [ ] Step 4: Mark phase 0 complete in 进度.md, link both verification documents, list the nine task headings and commit hashes, and set next target to phase 1 model + geometry + render.
- [ ] Step 5: Commit `git add README.md 进度.md docs/verification/2026-08-22-stage-0-verification.md && git commit -m "docs: close phase 0 verification"`.

## Final Acceptance

Phase 0 is complete only when:

- `pnpm install --frozen-lockfile` succeeds from a fresh worktree on Node >=20.19.0.
- `pnpm check:boundaries`, `pnpm test`, `pnpm test:e2e`, `pnpm typecheck`, and `pnpm build` all exit 0.
- CDP tests prove transient composition text is rendered before commit, Chinese text appears exactly once, and the DOM caret anchor follows two Canvas caret positions.
- The Windows manual checklist records native candidate-window following in current Chrome and Edge at required zoom and scale combinations.
- All twelve @ppt4ai/* packages and both apps exist, with headless/UI dependency boundaries enforced.
- TypeScript remains pinned to 6.0.3 and the Vue shell typechecks successfully.
- THIRD-PARTY.md, README.md, the IME result, stage verification, and 进度.md agree on versions and outcome.
## Required Code Contracts

The task steps above are normative. The following snippets remove implementation ambiguity and must be copied or matched exactly unless a test proves a required browser-specific adjustment.

### Root Manifest and Compiler Baseline

```json
{
  "name": "ppt4ai",
  "private": true,
  "version": "0.0.0",
  "license": "Apache-2.0",
  "packageManager": "pnpm@10.33.2",
  "engines": { "node": ">=20.19.0" },
  "scripts": {
    "build": "pnpm --recursive --if-present build",
    "typecheck": "pnpm --recursive --if-present typecheck",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "dev:ime": "pnpm --filter @ppt4ai/ime-lab dev"
  },
  "devDependencies": {
    "@playwright/test": "1.62.1",
    "typescript": "6.0.3",
    "vite": "8.2.2",
    "vitest": "4.1.11"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

### IME Types and Reducer

```ts
export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

export interface ScreenRect extends ScreenPoint {
  readonly width: number
  readonly height: number
}

export type ImeBridgeEvent =
  | { readonly type: 'composition-start' }
  | { readonly type: 'composition-update'; readonly text: string }
  | { readonly type: 'composition-end'; readonly text: string }
  | { readonly type: 'text-input'; readonly text: string }
  | { readonly type: 'delete-backward' }

export interface ImeSessionState {
  readonly committedText: string
  readonly compositionText: string
  readonly isComposing: boolean
}
```

```ts
export const initialImeSessionState: ImeSessionState = {
  committedText: '',
  compositionText: '',
  isComposing: false,
}

export function reduceImeSession(
  state: ImeSessionState,
  event: ImeBridgeEvent,
): ImeSessionState {
  switch (event.type) {
    case 'composition-start':
      return { ...state, compositionText: '', isComposing: true }
    case 'composition-update':
      return { ...state, compositionText: event.text, isComposing: true }
    case 'composition-end':
      return { ...state, compositionText: '', isComposing: false }
    case 'text-input':
      return { ...state, committedText: state.committedText + event.text }
    case 'delete-backward':
      return { ...state, committedText: [...state.committedText].slice(0, -1).join('') }
  }
}
```

Required reducer test core:

```ts
it('renders composition without committing it', () => {
  const started = reduceImeSession(initialImeSessionState, { type: 'composition-start' })
  const updated = reduceImeSession(started, { type: 'composition-update', text: 'zhong' })
  expect(updated).toEqual({ committedText: '', compositionText: 'zhong', isComposing: true })
})

it('commits once after composition ends', () => {
  const composing = { committedText: '', compositionText: 'zhong', isComposing: true }
  const ended = reduceImeSession(composing, { type: 'composition-end', text: '' })
  expect(reduceImeSession(ended, { type: 'text-input', text: '中' })).toEqual({
    committedText: '中',
    compositionText: '',
    isComposing: false,
  })
})
```

### Hidden Input Bridge Contract

```ts
export interface ImeInputBridgeOptions {
  readonly host: HTMLElement
  readonly onEvent: (event: ImeBridgeEvent) => void
}

export interface ImeInputBridge {
  focus(): void
  setCaretRect(rect: ScreenRect): void
  getCaretClientRect(): DOMRectReadOnly
  destroy(): void
}

export function createImeInputBridge(options: ImeInputBridgeOptions): ImeInputBridge
```

Required bridge positioning assertion:

```ts
const bridge = createImeInputBridge({ host, onEvent: vi.fn() })
bridge.setCaretRect({ x: 50, y: 80, width: 1, height: 24 })
const input = host.querySelector<HTMLElement>('[data-ppt4ai-ime-input]')!
expect(input.style.left).toBe('50px')
expect(input.style.top).toBe('80px')
expect(input.style.height).toBe('24px')
expect(input.style.opacity).toBe('0')
```

### Canvas and Browser Probe Contract

```ts
export interface PaintResult {
  readonly caretRect: ScreenRect
  readonly visibleText: string
}

export interface ImeLabSnapshot extends ImeSessionState {
  readonly visibleText: string
}

export interface ImeLabProbe {
  getSnapshot(): ImeLabSnapshot
  getInputRect(): DOMRectReadOnly
  setCaretOrigin(point: ScreenPoint): void
}

declare global {
  interface Window {
    __IME_LAB__: ImeLabProbe
  }
}
```

### Native Chromium IME Test Core

```ts
const cdp = await page.context().newCDPSession(page)
await page.locator('[data-ppt4ai-ime-input]').focus()
await cdp.send('Input.imeSetComposition', {
  text: 'zhong',
  selectionStart: 5,
  selectionEnd: 5,
})
expect(await page.evaluate(() => window.__IME_LAB__.getSnapshot())).toEqual({
  committedText: '',
  compositionText: 'zhong',
  isComposing: true,
  visibleText: 'zhong',
})
await cdp.send('Input.insertText', { text: '中' })
expect(await page.evaluate(() => window.__IME_LAB__.getSnapshot())).toEqual({
  committedText: '中',
  compositionText: '',
  isComposing: false,
  visibleText: '中',
})
```

### Workspace Package Matrix

Create these exact package names and directories:

```text
packages/model         @ppt4ai/model
packages/geometry      @ppt4ai/geometry
packages/layout        @ppt4ai/layout
packages/text          @ppt4ai/text
packages/render        @ppt4ai/render
packages/charts        @ppt4ai/charts
packages/animate       @ppt4ai/animate
packages/pptx-import   @ppt4ai/pptx-import
packages/pptx-export   @ppt4ai/pptx-export
packages/engine        @ppt4ai/engine
packages/editor        @ppt4ai/editor
packages/player        @ppt4ai/player
```

Each new headless package starts with `src/index.ts` containing exactly `export {}` until its phase introduces a real public contract. Each package manifest uses `type: module`, `files: ["dist"]`, exports `./dist/index.js` and `./dist/index.d.ts`, and scripts `build: tsc -p tsconfig.json`, `typecheck: tsc -p tsconfig.json --noEmit`, and `test: vitest run`.
