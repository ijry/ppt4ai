# Stage 7 Multi-page Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add host-level multi-page navigation, thumbnail list rendering, and per-page selection/history isolation to the Playground.

**Architecture:** Keep `EditorEngine` single-document and single-page. Add a presentation host that owns one existing asset host per page, routes current-page commands, shares one asset adapter, and returns clone-safe snapshots. Update `App.vue` to render current-page data and native UnoCSS thumbnail buttons.

**Tech Stack:** TypeScript, Vue 3, Vue Test Utils, Vitest, existing `@ppt4ai/engine`, `@ppt4ai/editor`, `@ppt4ai/model`, `@ppt4ai/render`, and UnoCSS.

**Spec:** `docs/superpowers/specs/2026-08-30-stage-7-multipage-navigation-design.md`

## Global Constraints

- Do not add Element Plus or another runtime UI framework.
- Do not change the public Engine or editor package contracts.
- Preserve `createPlaygroundAssetHost()` compatibility for existing tests and callers.
- Use clone-safe snapshots; Vue must not mutate an Engine directly.
- Follow strict TDD: write a failing test, observe RED, implement the smallest change, then observe GREEN.
- Commit each independently completed stage; keep the progress document as its own documentation commit.

### Task 1: Make the asset host configurable for page instances

**Files:**
- Modify: `apps/playground/src/asset-host.ts`
- Test: `apps/playground/src/asset-host.test.ts`

**Interfaces:**
- `createPlaygroundAssetHost(options?: { adapter?: AssetAdapter; document?: Ppt4aiDocument }): PlaygroundAssetHost`
- Existing no-argument behavior remains unchanged.

- [ ] Write a failing test proving an injected adapter and document are used by an isolated host.
- [ ] Run the focused test and verify it fails for the missing options contract.
- [ ] Add the optional factory input and keep default adapter/document creation intact.
- [ ] Run focused asset-host tests and verify they pass.
- [ ] Commit `feat: make playground asset host configurable`.

### Task 2: Add the presentation host and page snapshots

**Files:**
- Create: `apps/playground/src/presentation-host.ts`
- Test: `apps/playground/src/presentation-host.test.ts`

**Interfaces:**
- `PlaygroundSlideSnapshot` includes `id`, localized-ready `title`, `thumbnailScene`, and `engineState`.
- `PlaygroundPresentationSnapshot` includes `slideOrder`, `activeSlideId`, `slides`, optional `selectedAssetId`, and status.
- `createPlaygroundPresentationHost(): PlaygroundPresentationHost`.
- Current-page editing methods mirror the existing asset host methods.

- [ ] Write failing tests for initial page order, page-specific thumbnail nodes, and active page selection.
- [ ] Write failing tests for no-op switching, invalid page preservation, selection isolation, and edit/history persistence after a round trip.
- [ ] Run the focused tests and verify the expected missing-module/API failures.
- [ ] Implement shared adapter storage and two independent page hosts using valid page documents with distinct element IDs.
- [ ] Implement snapshot assembly and current-page command forwarding without cross-page history.
- [ ] Run presentation-host tests and verify they pass.
- [ ] Commit `feat: add playground presentation host`.

### Task 3: Replace the demo thumbnail with navigable page thumbnails

**Files:**
- Modify: `apps/playground/src/App.vue`
- Modify: `packages/editor/src/locales/zh-CN.ts`
- Modify: `packages/editor/src/locales/en-US.ts`
- Test: `apps/playground/src/App.test.ts`

**Interfaces:**
- App uses presentation snapshot active-page selectors and forwards existing editor events to the presentation host.
- Thumbnail buttons expose `data-testid="slide-thumbnail-<id>"`, `data-slide-id`, and `aria-current="page"` only for the active page.

- [ ] Add failing integration tests for two thumbnails, active state, blue-page switching, and current-page status/undo display.
- [ ] Run the focused App tests and verify they fail because the old smoke demo exposes one unrelated thumbnail.
- [ ] Replace `thumbnail-smoke` usage with `ThumbnailCanvas` instances built from presentation slide snapshots and the shared adapter.
- [ ] Add localized page-list labels and invalid-page status text while maintaining exact locale key parity.
- [ ] Wire selection, asset, upload, and edit callbacks through the presentation host.
- [ ] Run App and editor-shell tests and verify they pass.
- [ ] Commit `feat: add playground slide navigation UI`.

### Task 4: Verify the multipage slice and record progress

**Files:**
- Modify: `进度.md`

- [ ] Run focused Playground source tests.
- [ ] Run all source tests, boundary checks, recursive typecheck, production build, and `git diff --check`.
- [ ] Scan for Element Plus imports or dependencies.
- [ ] Update `进度.md` with the completed navigation capability, test counts, commits, and deferred next slices.
- [ ] Commit `docs: record multipage navigation milestone`.
- [ ] Report the commits and verification results; next independent slice remains page CRUD/reordering only if later approved.
