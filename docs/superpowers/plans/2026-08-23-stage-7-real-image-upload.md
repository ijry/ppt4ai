# Stage 7 Real Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Playground read a local bitmap and atomically upload plus insert or replace it through the existing asset controller.

**Architecture:** A pure browser file reader converts `File` objects to copied upload inputs. The Playground asset host owns deterministic IDs and delegates storage and engine mutation to `createImageAssetController`; `App.vue` only coordinates picker intent, busy state, snapshots, and localized status.

**Tech Stack:** TypeScript, Vue 3, Vue-I18n, UnoCSS, Vitest, happy-dom, existing `@ppt4ai/editor` and `@ppt4ai/engine` APIs.

## Global Constraints

- Keep runtime UI dependencies limited to Vue, Vue-I18n, and UnoCSS; do not add Element Plus.
- Keep image bytes behind `AssetAdapter`; document and snapshots remain clone-safe.
- Keep upload insertion/replacement atomic from the document-history perspective.
- Do not automatically delete orphaned adapter bytes.
- Accept only PNG, JPEG, GIF, BMP, and WebP supported by `parseBitmapMetadata`.
- Use test-driven development and commit each independently verified task.

## File Structure

- `apps/playground/src/image-file-upload.ts`: browser `File` to clone-safe upload input conversion only.
- `apps/playground/src/image-file-upload.test.ts`: reader success, copying, MIME normalization, and failure tests.
- `apps/playground/src/asset-host.ts`: deterministic upload transaction orchestration.
- `apps/playground/src/asset-host.test.ts`: host transaction, history, asset metadata, and adapter-byte tests.
- `apps/playground/src/App.vue`: hidden file picker, upload controls, busy state, and snapshot wiring.
- `apps/playground/src/App.test.ts`: user interaction and localization tests.
- `packages/editor/src/locales/zh-CN.ts`: Chinese upload labels and statuses.
- `packages/editor/src/locales/en-US.ts`: English locale parity.
- `进度.md`: milestone and next-slice handoff.

---

### Task 1: Add the browser image file reader

**Files:**
- Create: `apps/playground/src/image-file-upload.ts`
- Create: `apps/playground/src/image-file-upload.test.ts`

**Interfaces:**
- Consumes: browser `File.arrayBuffer()` and `ImageMimeType` from `@ppt4ai/model`.
- Produces: `readImageUploadFile(file: File): Promise<PlaygroundImageUploadInput>` and `ImageFileReadError`.

- [ ] **Step 1: Write failing reader tests**

Add tests asserting that a PNG `File` becomes `{ data: Uint8Array, mimeType: 'image/png', originalFilename }`, returned bytes do not alias the source buffer, an empty MIME declaration becomes `undefined`, unsupported declared MIME becomes `undefined` so byte sniffing remains authoritative, and a rejected `arrayBuffer()` throws `ImageFileReadError`.

- [ ] **Step 2: Run the reader tests and verify RED**

Run: `pnpm exec vitest run apps/playground/src/image-file-upload.test.ts`

Expected: FAIL because `image-file-upload.ts` does not exist.

- [ ] **Step 3: Implement the minimal reader**

Define:

```ts
export interface PlaygroundImageUploadInput {
  data: Uint8Array
  mimeType?: ImageMimeType
  originalFilename?: string
}

export class ImageFileReadError extends Error {}

export async function readImageUploadFile(file: File): Promise<PlaygroundImageUploadInput>
```

Catch browser read failures, copy `new Uint8Array(await file.arrayBuffer())`, preserve non-empty `file.name`, and keep `file.type` only when it is one of the five `ImageMimeType` values.

- [ ] **Step 4: Run reader tests and Playground typecheck**

Run:

```powershell
pnpm exec vitest run apps/playground/src/image-file-upload.test.ts
pnpm --filter @ppt4ai/playground typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the reader**

```powershell
git add apps/playground/src/image-file-upload.ts apps/playground/src/image-file-upload.test.ts
git commit -m "feat: read local image uploads"
```

### Task 2: Add upload transactions to the Playground host

**Files:**
- Modify: `apps/playground/src/asset-host.ts`
- Modify: `apps/playground/src/asset-host.test.ts`

**Interfaces:**
- Consumes: `PlaygroundImageUploadInput`, `createImageAssetController`, `ImageAssetControllerError`.
- Produces: `uploadAndInsert(input)` and `uploadAndReplace(input)` asynchronous host methods.

- [ ] **Step 1: Write failing host upload tests**

Add tests asserting:

- a valid PNG upload inserts `image_1` with `asset_upload_1`, stores exact copied bytes, selects the new image/asset, records one undo entry, and exposes parsed dimensions plus filename;
- the next valid upload replaces the selected image with `asset_upload_2`, removes the unreferenced previous uploaded metadata through the engine, keeps both adapter byte blobs host-owned, and records a second undo entry;
- invalid bytes return `image-upload-invalid`, do not write the adapter, do not advance IDs, and do not change history;
- replacement without a selected image returns `image-target-required` without adapter writes;
- adapter or controller failures return `image-upload-failed` without leaking exception text.

- [ ] **Step 2: Run host tests and verify RED**

Run: `pnpm exec vitest run apps/playground/src/asset-host.test.ts`

Expected: FAIL because the asynchronous upload methods are missing.

- [ ] **Step 3: Implement host upload methods**

Extend `PlaygroundAssetHost` with:

```ts
uploadAndInsert(input: PlaygroundImageUploadInput): Promise<PlaygroundAssetHostSnapshot>
uploadAndReplace(input: PlaygroundImageUploadInput): Promise<PlaygroundAssetHostSnapshot>
```

Create one `ImageAssetController` using the existing engine/adapter and an `asset_upload_${assetSequence}` factory. Allocate `image_${imageSequence}` only for insert. Increment counters after success, set selected asset from the resulting image, and map controller validation errors to `image-upload-invalid`; map all other transaction errors to `image-upload-failed`.

- [ ] **Step 4: Run focused host verification**

Run:

```powershell
pnpm exec vitest run apps/playground/src/asset-host.test.ts packages/editor/src/image-asset-controller.test.ts
pnpm --filter @ppt4ai/playground typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit host transactions**

```powershell
git add apps/playground/src/asset-host.ts apps/playground/src/asset-host.test.ts
git commit -m "feat: upload images through playground host"
```

### Task 3: Wire the local file picker into the Playground

**Files:**
- Modify: `apps/playground/src/App.vue`
- Modify: `apps/playground/src/App.test.ts`
- Modify: `packages/editor/src/locales/zh-CN.ts`
- Modify: `packages/editor/src/locales/en-US.ts`

**Interfaces:**
- Consumes: `readImageUploadFile`, `uploadAndInsert`, and `uploadAndReplace`.
- Produces: accessible UnoCSS upload controls and localized status feedback.

- [ ] **Step 1: Write failing App upload interactions**

Add happy-dom tests that click `data-testid="upload-insert"`, assign a real PNG `File` to `data-testid="image-file-input"`, dispatch `change`, and assert that `asset_upload_1` appears in the asset list, `image_1` is selected, undo depth is one, and Chinese status says the image was uploaded and inserted. Add a replacement test and a missing-target test. Assert the input value resets and raw `Error:` text is absent.

- [ ] **Step 2: Run App tests and verify RED**

Run: `pnpm exec vitest run apps/playground/src/App.test.ts`

Expected: FAIL because upload controls and file handling are missing.

- [ ] **Step 3: Implement Vue picker wiring and locale parity**

Add one hidden file input with:

```html
accept="image/png,image/jpeg,image/gif,image/bmp,image/webp"
```

Add insert-upload and replace-upload buttons, a `pendingUploadIntent` ref, an `uploadBusy` ref, and one async change handler. Reset the input in `finally`, disable buttons while busy, map file-reader failures to `image-file-read-failed`, and pass host-returned statuses through the existing localized status renderer. Add all labels and six stable status translations in both locales.

- [ ] **Step 4: Run focused UI verification**

Run:

```powershell
pnpm exec vitest run apps/playground/src/App.test.ts apps/playground/src/asset-host.test.ts apps/playground/src/image-file-upload.test.ts
pnpm --filter @ppt4ai/playground typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the UI wiring**

```powershell
git add apps/playground/src/App.vue apps/playground/src/App.test.ts packages/editor/src/locales/zh-CN.ts packages/editor/src/locales/en-US.ts
git commit -m "feat: upload local images in playground"
```

### Task 4: Record and verify the upload milestone

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: completed reader, host, and Vue upload behavior.
- Produces: accurate cross-session handoff and a clean verified branch.

- [ ] **Step 1: Update the milestone record**

Record supported formats, deterministic IDs, insert/replace behavior, localized errors, host-owned adapter bytes, and the explicit deferral of drag/drop, clipboard, persistence, and orphan deletion. Set the next slice to main editor canvas integration or group thumbnails.

- [ ] **Step 2: Run repository gates**

Run:

```powershell
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
rg -n "element-plus|ElementPlus|@element-plus" package.json pnpm-lock.yaml packages apps
```

Expected: all checks pass and the Element Plus scan returns no matches.

- [ ] **Step 3: Commit the milestone**

```powershell
git add 进度.md
git commit -m "docs: record real image upload"
```

## Plan Self-Review

- The design requirements map to one of four independently testable tasks.
- File reading, engine transactions, Vue UI, and progress documentation have separate ownership.
- The same `PlaygroundImageUploadInput`, method names, ID formats, and status codes are used throughout.
- No placeholders, unbounded refactors, dependency additions, or automatic adapter deletion are included.
