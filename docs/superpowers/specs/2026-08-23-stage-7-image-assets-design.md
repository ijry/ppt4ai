# Stage 7 Image Asset Foundation Design

> **状态**：已确认（2026-08-23）
> **范围**：普通位图图片的模型、资源 adapter、PPTX 导入与 SceneGraph 输出

## Goal

Add a headless, JSON-safe image foundation for ordinary bitmap images without
inlining binary data into the document model.

## Decisions

### 1. Image model uses asset references

Add `ImageElement` with `kind: 'image'`, `bounds`, and `assetId`. Add a top-level
`assets` map containing only JSON metadata: id, MIME type, pixel dimensions when
known, and original filename when known. Image bytes remain outside the document.

### 2. Asset access is adapter-based

Add a headless `AssetAdapter` contract with async `get` and `put` methods. The
PPTX importer accepts an optional adapter and stores ordinary media bytes in it.
When no adapter is provided, the importer still produces image metadata and a
stable asset reference but does not expose binary bytes through the document.

### 3. Import only ordinary bitmap picture parts

Parse `p:pic` elements in importer element order. Resolve `a:blip` `r:embed`
through the slide relationship part to the media entry. Accept PNG, JPEG, GIF,
BMP, and WebP media types. Unsupported media, malformed relationships, and
missing bounds cause that picture to be skipped without dropping neighboring
elements.

### 4. Keep rendering headless

`documentToSceneGraph` emits `SceneImageNode` with the element bounds, asset ID,
and metadata. It does not decode images, access DOM, use Canvas, or require a
browser global.

### 5. Explicitly defer advanced image work

This slice does not implement `srcRect` cropping, filters/effects, image editing
UI, image resource replacement, EMF/WMF decoding, OLE previews, or new-document
PPTX generation. Existing source-package writeback preserves untouched image
parts and relationships.

## Acceptance Criteria

- A valid picture imports as an image element with a stable asset reference.
- The optional adapter receives the exact original media bytes.
- Missing/unsupported media does not corrupt neighboring slide elements.
- Image metadata and SceneGraph nodes are `structuredClone`-safe.
- Existing shape, text, table, ZIP, and package writeback behavior remains green.
- No Vue, DOM, Canvas, Element Plus, or new runtime dependency enters headless packages.
