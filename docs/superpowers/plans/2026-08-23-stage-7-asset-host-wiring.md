# Stage 7 Asset Library Host Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing asset library to a deterministic Playground host that inserts and replaces references to assets already stored in the document.

**Architecture:** Add synchronous reference-only commands to `EditorEngine`, then wrap them in a small Playground-specific host model with an in-memory adapter and clone-safe snapshots. `App.vue` renders that host through the existing `AssetLibrary`; binary import remains owned by the separate image asset controller and is not used by this slice.

**Tech Stack:** TypeScript 6, Vue 3, Vue-I18n, UnoCSS, Vitest, happy-dom.

## Global Constraints

- Runtime UI dependencies remain Vue, Vue-I18n, and UnoCSS; do not add Element Plus or an icon package.
- Existing asset references must not call `AssetAdapter.put()` or allocate a new asset ID.
- `ImageAssetController` remains the byte-import boundary for later upload work and is unchanged in this slice.
- Engine operations remain synchronous, headless, clone-safe, validated, atomic, and undoable.
- Shape, text, table, chart, and group thumbnail painting remains deferred.
- Follow TDD for every behavior change and commit each completed task separately.

---

### Task 1: Add Existing-Asset Reference Commands

**Files:**
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/src/engine.test.ts`

**Interfaces:**
- Consumes: existing `Ppt4aiDocument.assets`, `ImageElement`, `EditorEngine.dispatch()`, patch history, and document validation.
- Produces: `insertImageReference` and `replaceImageAssetReference` `EngineCommand` variants.

- [ ] **Step 1: Write failing engine tests**

Add tests with these exact command shapes:

```ts
const inserted = engine.dispatch({
  type: 'insertImageReference',
  slideId: 'sld_1',
  element: imageElement('img_new', 'asset_spare'),
  assetId: 'asset_spare',
})

const replaced = engine.dispatch({
  type: 'replaceImageAssetReference',
  elementId: 'img_1',
  assetId: 'asset_spare',
})
```

Cover all of the following:

- insertion appends and selects the image without changing existing metadata;
- replacement preserves image appearance and uses existing metadata;
- replacement removes old metadata only after its final reference disappears;
- undo and redo restore references and metadata atomically;
- missing asset, duplicate element, missing slide, non-image target, same asset,
  and `element.assetId !== assetId` fail without state/history changes.

- [ ] **Step 2: Run the tests and verify the expected failure**

Run: `pnpm exec vitest run packages/engine/src/engine.test.ts`

Expected: FAIL because the new command discriminants are not assignable and
the engine has no dispatch cases.

- [ ] **Step 3: Implement minimal reference-only commands**

Extend `EngineCommand` with:

```ts
| { type: 'insertImageReference'; slideId: string; element: ImageElement; assetId: string }
| { type: 'replaceImageAssetReference'; elementId: string; assetId: string }
```

`insertImageReference` must validate the slide, element ID, existing asset,
and matching reference, clone and validate the candidate document, commit only
the element and slide order paths, then select the new element.

`replaceImageAssetReference` must validate the target image, different
existing asset, clone and validate the candidate document, change only the
target `assetId`, remove old metadata only when no image still references it,
and commit the element plus assets paths as one history entry.

- [ ] **Step 4: Run focused verification**

Run:

```powershell
pnpm exec vitest run packages/engine/src/engine.test.ts packages/editor/src/image-asset-controller.test.ts
pnpm --filter @ppt4ai/engine typecheck
```

Expected: engine and controller regression tests pass; engine typecheck passes.

- [ ] **Step 5: Commit the engine slice**

```powershell
git add packages/engine/src/index.ts packages/engine/src/engine.test.ts
git commit -m "feat: reuse existing image assets"
```

### Task 2: Add a Deterministic Playground Asset Host

**Files:**
- Create: `apps/playground/src/asset-host.ts`
- Create: `apps/playground/src/asset-host.test.ts`
- Modify: `apps/playground/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `EditorEngine`, the two Task 1 commands, `AssetAdapter`, and seeded PNG metadata/bytes.
- Produces: `createPlaygroundAssetHost()`, `PlaygroundAssetHost`, and clone-safe `PlaygroundAssetHostSnapshot`.

- [ ] **Step 1: Write failing pure host tests**

Define the expected API through tests:

```ts
const host = createPlaygroundAssetHost()
expect(host.getSnapshot().engineState.document.assets).toHaveProperty('asset_red')

host.selectAsset('asset_red')
const inserted = host.insertAsset('asset_red')
expect(inserted.engineState.selection).toEqual(['image_1'])

host.selectAsset('asset_blue')
const replaced = host.replaceSelectedImage('asset_blue')
expect(replaced.engineState.document.elements.image_1).toMatchObject({ assetId: 'asset_blue' })
```

Also test that adapter `get()` returns copies, `put()` stores copies, snapshots
are safe to mutate externally, element IDs are deterministic, missing assets
produce a stable error snapshot, and replace without exactly one selected image
does not change history.

- [ ] **Step 2: Run tests and verify the expected failure**

Run: `pnpm exec vitest run apps/playground/src/asset-host.test.ts`

Expected: FAIL because `asset-host.ts` does not exist.

- [ ] **Step 3: Implement the pure host model**

Add direct workspace dependencies on `@ppt4ai/engine` and `@ppt4ai/model`.
Implement a memory adapter seeded with two deterministic 2×2 PNG byte arrays
and metadata IDs `asset_red` and `asset_blue`. Initialize one empty slide with
both metadata records. Use an incrementing `image_1`, `image_2`, ... factory
and fixed EMU bounds offset by sequence.

Expose:

```ts
export interface PlaygroundAssetHostSnapshot {
  engineState: EngineState
  selectedAssetId?: string
  status: { kind: 'idle' | 'success' | 'error'; message: string }
}

export interface PlaygroundAssetHost {
  adapter: AssetAdapter
  getSnapshot(): PlaygroundAssetHostSnapshot
  selectAsset(assetId: string): PlaygroundAssetHostSnapshot
  insertAsset(assetId: string): PlaygroundAssetHostSnapshot
  replaceSelectedImage(assetId: string): PlaygroundAssetHostSnapshot
}
```

Catch engine errors at this host boundary, preserve the last valid engine
state, and return stable message codes: `asset-selected`, `asset-inserted`,
`asset-replaced`, `asset-missing`, `image-target-required`, or
`asset-operation-failed`.

- [ ] **Step 4: Run focused verification**

Run:

```powershell
pnpm exec vitest run apps/playground/src/asset-host.test.ts packages/engine/src/engine.test.ts
pnpm --filter @ppt4ai/playground typecheck
```

Expected: host and engine tests pass; Playground typecheck passes.

- [ ] **Step 5: Commit the host model**

```powershell
git add apps/playground/src/asset-host.ts apps/playground/src/asset-host.test.ts apps/playground/package.json pnpm-lock.yaml
git commit -m "feat: add playground asset host"
```

### Task 3: Wire AssetLibrary Into the Playground

**Files:**
- Modify: `apps/playground/src/App.vue`
- Create: `apps/playground/src/App.test.ts`
- Modify: `packages/editor/src/locales/zh-CN.ts`
- Modify: `packages/editor/src/locales/en-US.ts`
- Modify: `进度.md`

**Interfaces:**
- Consumes: `createPlaygroundAssetHost()`, `AssetLibrary`, the host snapshot, and existing i18n setup.
- Produces: a working UnoCSS Playground asset panel with selection, insertion, replacement, and local status output.

- [ ] **Step 1: Write failing App interaction tests**

Mount `App.vue` with `createPpt4aiI18n('zh-CN')` and mock
`HTMLCanvasElement.getContext('bitmaprenderer')` plus the thumbnail worker
factory path used by child components. Assert:

- the two seeded assets render in stable order;
- clicking an asset selector updates the selected status;
- inserting creates `image_1`, updates history, and keeps the asset selected;
- selecting the second asset and replacing changes `image_1.assetId`;
- replacing before insertion reports `image-target-required` and leaves
  history at zero;
- all user-visible status copy is localized and the App has no engine or
  adapter error leaking as raw exception text.

- [ ] **Step 2: Run App tests and verify the expected failure**

Run: `pnpm exec vitest run apps/playground/src/App.test.ts`

Expected: FAIL because `App.vue` still renders only the thumbnail smoke demo.

- [ ] **Step 3: Implement the thin Vue wiring**

Instantiate one host in `<script setup>`, hold its snapshot in a `ref`, and
replace the ref after each host method. Render `AssetLibrary` with document
assets, adapter, and selected asset ID. Forward `select`, `insert`, and
`replace` events directly to host methods. Render status fields with stable
`data-testid` markers for selected asset, selected element, undo depth, and
operation status.

Keep the existing standalone thumbnail smoke section. Arrange the editor and
asset library with responsive UnoCSS layout only. Add locale parity keys under
`playground.assetHost` for title, selected asset, selected image, history,
idle, selected, inserted, replaced, missing asset, image target required, and
generic operation failure.

- [ ] **Step 4: Run focused and repository verification**

Run:

```powershell
pnpm exec vitest run apps/playground/src/App.test.ts apps/playground/src/asset-host.test.ts apps/playground/src/editor-shell.test.ts packages/editor/src/AssetLibrary.test.ts
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
rg -n "element-plus|ElementPlus|@element-plus" package.json pnpm-lock.yaml packages apps
```

Expected: focused and full suites pass; Element Plus scan returns no matches.

- [ ] **Step 5: Record and commit the host milestone**

Update `进度.md` to state that existing asset references now insert/replace
atomically through the engine, the Playground owns adapter/engine state, real
file upload remains deferred, and non-image thumbnails remain deferred.

```powershell
git add apps/playground/src/App.vue apps/playground/src/App.test.ts packages/editor/src/locales/zh-CN.ts packages/editor/src/locales/en-US.ts 进度.md
git commit -m "feat: wire asset library host"
```

## Plan Self-Review

- Existing asset reuse is separate from byte import and never calls adapter
  `put()` during insert/replace.
- Every public command and host method has one exact signature across tasks.
- Engine atomicity, host clone isolation, Vue interaction, localization,
  repository boundaries, and Element Plus absence each have explicit gates.
- Upload, persistent storage, adapter deletion, non-image thumbnails, and a
  complete editor shell remain outside this plan.
