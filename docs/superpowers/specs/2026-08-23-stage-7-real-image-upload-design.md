# Stage 7 Real Image Upload Design

## Goal

Allow the Playground host to choose a local bitmap file, store its bytes through the existing `AssetAdapter`, and atomically insert a new image or replace the selected image. This slice makes the current asset library useful with real user files without introducing a component framework or changing document binary ownership.

## Scope

- Accept PNG, JPEG, GIF, BMP, and WebP files supported by `parseBitmapMetadata`.
- Provide separate upload-and-insert and upload-and-replace actions.
- Preserve the existing seeded assets and reference-only insert/replace actions.
- Refresh the asset library from the engine document after a successful upload.
- Localize success and failure status copy in Chinese and English.
- Keep Vue, Vue-I18n, and UnoCSS as the only runtime UI dependencies.

Out of scope: drag-and-drop, clipboard paste, multi-file upload, persistent browser storage, adapter deletion, upload progress, remote URLs, SVG, video, and audio.

## Architecture

### Browser file boundary

`apps/playground/src/image-file-upload.ts` converts a browser `File` into a copied `Uint8Array`, preserves its name, and normalizes a supported MIME declaration. It has no engine or adapter access. Read failures become a stable `ImageFileReadError` so Vue never renders raw browser exceptions.

### Host transaction boundary

`createPlaygroundAssetHost()` continues to own one `EditorEngine` and one in-memory `AssetAdapter`. It also owns one `ImageAssetController` configured with deterministic `asset_upload_N` IDs. Two asynchronous methods are added:

```ts
uploadAndInsert(input: PlaygroundImageUploadInput): Promise<PlaygroundAssetHostSnapshot>
uploadAndReplace(input: PlaygroundImageUploadInput): Promise<PlaygroundAssetHostSnapshot>
```

The insert path allocates the next `image_N` element and uses the existing default image bounds. The replace path requires exactly one selected image. Both paths delegate bitmap validation, byte copying, adapter storage, engine dispatch, asset reference cleanup, and orphan reporting to `createImageAssetController`.

Sequence counters advance only after a successful engine transaction. A failed read, invalid bitmap, adapter failure, missing image target, or engine failure preserves the last valid engine history and returns a stable status code. Adapter bytes remain host-owned and are not deleted automatically.

### Vue wiring

`App.vue` renders two UnoCSS buttons and one visually hidden `input[type=file]` accepting the five supported image families. Clicking a button records the requested intent and opens the picker. On change, Vue reads the first file, calls the matching host method, updates the snapshot, and resets the input value so selecting the same file again still emits a change.

The controls expose busy state and prevent concurrent submissions. User-visible status uses `playground.assetHost.status.*` locale keys. The existing `AssetLibrary` receives the updated document assets and immediately displays the uploaded file.

## Error Handling

Stable status messages:

- `asset-uploaded`: bytes stored and a new image inserted.
- `asset-upload-replaced`: bytes stored and selected image replaced.
- `image-target-required`: replacement requested without one selected image.
- `image-file-read-failed`: browser could not read the selected file.
- `image-upload-invalid`: unsupported, malformed, or MIME-mismatched bitmap.
- `image-upload-failed`: adapter or engine transaction failed.

When the controller reports orphan asset IDs after a post-write engine failure, the host retains the generic failure status and exposes no raw exception text. Automatic orphan deletion remains outside this slice because the adapter lifecycle belongs to the host.

## Testing

- Pure file-reader tests cover byte copying, MIME normalization, unsupported declarations, and read failures.
- Host tests cover successful insert, successful replacement, deterministic IDs, asset-library metadata refresh, invalid files, missing targets, history atomicity, and adapter bytes.
- App interaction tests drive real file input change events, verify localized statuses, busy/reset behavior, and confirm the uploaded asset appears.
- Repository gates remain `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `git diff --check`, plus an Element Plus dependency scan.

## Self-Review

- No placeholders or deferred behavior are required for this slice.
- File reading, asset transactions, and Vue rendering have separate responsibilities.
- All public methods and stable status codes are defined once and used consistently.
- The design preserves host-owned binary lifecycle and existing undo/redo semantics.
