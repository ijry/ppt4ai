# Stage 7 Asset Library UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable Vue asset library that lists image metadata, renders existing thumbnails, and emits host-owned insert/replace intents.

**Architecture:** Keep asset sorting and display derivation in a browser-independent pure model. `AssetLibrary.vue` owns only presentation, local selection normalization, and event forwarding; `ThumbnailCanvas` remains the sole thumbnail renderer. The component never calls the engine or writes adapter bytes.

**Tech Stack:** TypeScript, Vue 3, Vue-I18n, UnoCSS, Vitest, happy-dom.

## Global Constraints

- Runtime dependencies are limited to existing Vue, Vue-I18n, and UnoCSS usage; do not add Element Plus or an icon package.
- Asset bytes remain behind `AssetAdapter`; `Ppt4aiDocument` stores metadata and references only.
- Shape, text, table, chart, and group thumbnail painting remains deferred.
- New behavior follows TDD: write a failing test, observe the expected failure, implement the smallest passing change, then refactor.
- Each completed task ends with focused verification and its own git commit.

---

### Task 1: Add the Pure Asset Library View Model

**Files:**
- Create: `packages/editor/src/asset-library.ts`
- Create: `packages/editor/src/asset-library.test.ts`

**Interfaces:**
- Consumes: `AssetMetadata` and optional asset maps from `@ppt4ai/model`.
- Produces: `AssetLibraryItem`, `AssetLibraryModel`, and
  `createAssetLibraryModel(assets, selectedAssetId)`.

- [ ] **Step 1: Write failing model tests**

```ts
it('sorts assets by filename and then id without mutating input', () => {
  const assets = {
    z: { id: 'z', mimeType: 'image/png', originalFilename: 'Zoo.png' },
    a: { id: 'a', mimeType: 'image/jpeg', originalFilename: 'alpha.jpg' },
  } as const
  const model = createAssetLibraryModel(assets, 'z')
  expect(model.items.map((item) => item.id)).toEqual(['a', 'z'])
  expect(model.selectedAssetId).toBe('z')
  expect(assets).toEqual({
    z: { id: 'z', mimeType: 'image/png', originalFilename: 'Zoo.png' },
    a: { id: 'a', mimeType: 'image/jpeg', originalFilename: 'alpha.jpg' },
  })
})

it('derives stable format, dimensions, and fallback labels', () => {
  const model = createAssetLibraryModel({
    asset: { id: 'asset', mimeType: 'image/webp', pixelWidth: 320, pixelHeight: 180 },
    unknown: { id: 'unknown', mimeType: 'image/gif' },
  })
  expect(model.items[0]).toMatchObject({ formatLabel: 'WEBP', dimensionsLabel: '320 × 180', displayName: 'asset' })
  expect(model.items[1]).toMatchObject({ formatLabel: 'GIF', dimensionsLabel: 'unknown', displayName: 'unknown' })
})

it('clears a selected id that is absent from the asset map', () => {
  expect(createAssetLibraryModel({}, 'missing').selectedAssetId).toBeUndefined()
})
```

- [ ] **Step 2: Run focused tests and verify the expected failure**

Run: `pnpm exec vitest run packages/editor/src/asset-library.test.ts`

Expected: FAIL because `asset-library.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal pure model**

Implement immutable item creation, case-insensitive filename sorting, MIME
labels for PNG/JPEG/GIF/BMP/WebP, the `unknown` dimensions marker, and
selection normalization. Use `structuredClone` for metadata copied into items.

- [ ] **Step 4: Run model tests and editor typecheck**

Run: `pnpm exec vitest run packages/editor/src/asset-library.test.ts && pnpm --filter @ppt4ai/editor typecheck`

Expected: all model tests pass and editor typecheck succeeds.

- [ ] **Step 5: Commit the pure model**

```powershell
git add packages/editor/src/asset-library.ts packages/editor/src/asset-library.test.ts
git commit -m "feat: add asset library view model"
```

### Task 2: Build the UnoCSS Asset Library Component

**Files:**
- Create: `packages/editor/src/AssetLibrary.vue`
- Create: `packages/editor/src/AssetLibrary.test.ts`
- Modify: `packages/editor/src/index.ts`
- Modify: `packages/editor/src/locales/zh-CN.ts`
- Modify: `packages/editor/src/locales/en-US.ts`

**Interfaces:**
- Consumes: `createAssetLibraryModel`, `AssetAdapter`, and
  `ThumbnailCanvas`.
- Produces: `AssetLibrary` plus typed props and emits for selection, insert,
  and replace intents.

- [ ] **Step 1: Write failing component tests**

Cover these behaviors:

```ts
it('renders an empty state when no assets exist', () => {
  // mount AssetLibrary with an adapter and assert role=status + localized copy
})

it('renders sorted metadata and emits select, insert, and replace intents', async () => {
  // mount two assets with a test ThumbnailCanvas worker factory
  // click the first selector, then its insert and replace buttons
  // assert emitted payloads are stable asset ids
})

it('keeps selected styling and supports keyboard selection', async () => {
  // dispatch Enter on an asset selector and assert select + selected class
})

it('shows a local thumbnail failure without hiding sibling assets', async () => {
  // emit a failed render result from the injected worker and assert one tile
  // reports status while both asset selectors remain in the DOM
})
```

- [ ] **Step 2: Run focused component tests and verify failure**

Run: `pnpm exec vitest run packages/editor/src/AssetLibrary.test.ts`

Expected: FAIL because `AssetLibrary.vue` and its export do not exist yet.

- [ ] **Step 3: Implement the component and locale keys**

Use a responsive UnoCSS grid, visible focus styles, stable dimensions for
thumbnail canvases, `aria-pressed` selection, `aria-label` action buttons,
`role="status"` for empty and local failure states, and `@dblclick` selection
followed by `insert`. Forward `ThumbnailCanvas`'s render result into a local
set of failed asset IDs. Add parity keys under `assetLibrary` for title,
empty, insert, replace, selected, filename fallback, unknown dimensions, and
thumbnail failure.

- [ ] **Step 4: Export and verify component behavior**

Run: `pnpm exec vitest run packages/editor/src/AssetLibrary.test.ts apps/playground/src/editor-shell.test.ts && pnpm --filter @ppt4ai/editor typecheck`

Expected: component behavior and locale parity pass.

- [ ] **Step 5: Commit the component slice**

```powershell
git add packages/editor/src/AssetLibrary.vue packages/editor/src/AssetLibrary.test.ts packages/editor/src/index.ts packages/editor/src/locales/zh-CN.ts packages/editor/src/locales/en-US.ts
git commit -m "feat: add unocss asset library"
```

### Task 3: Record and Verify the Asset UI Milestone

**Files:**
- Modify: `进度.md`

- [ ] **Step 1: Record the completed UI boundary**

State that the reusable asset library is available, only emits host intents,
reuses the image thumbnail worker, and leaves upload/storage, engine wiring,
and non-image thumbnail painting outside this slice.

- [ ] **Step 2: Run repository verification**

Run:

```powershell
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
rg -n "element-plus|ElementPlus|@element-plus" package.json pnpm-lock.yaml packages apps
```

Expected: boundaries, tests, typechecks, builds, and diff checks pass; the
Element Plus scan returns no matches.

- [ ] **Step 3: Commit the milestone record**

```powershell
git add 进度.md
git commit -m "docs: record asset library ui"
```

## Plan Self-Review

- Pure sorting and formatting behavior is covered before Vue rendering.
- Component tests cover empty, metadata, selection, keyboard, actions, and
  isolated failure states.
- The plan contains no upload, storage deletion, engine, or deferred thumbnail
  scope that would require a second subsystem spec.
- All public names and event payloads are consistent between tasks.
