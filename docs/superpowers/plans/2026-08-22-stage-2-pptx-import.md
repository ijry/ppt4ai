# Stage 2 PPTX Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import a minimal real OOXML presentation into the JSON model and SceneGraph, including slide, layout, and master inheritance for renderable shapes and text.

**Architecture:** `@ppt4ai/pptx-import` remains headless and depends only on model and geometry. It reads the PPTX ZIP with a small pure byte reader, tokenizes the required XML subset without DOM globals, preserves source package metadata, and emits a JSON-safe document. Slide properties override layout properties, layout properties override master properties, and unsupported OOXML is skipped deterministically.

**Tech Stack:** TypeScript 6, Vitest, browser-compatible `Uint8Array`, `DecompressionStream`, pure XML tokenizer.

## Global Constraints

- Do not add Element Plus or another component framework; UnoCSS remains the only UI styling framework.
- Headless packages cannot import Vue or use DOM globals.
- Document and import output must remain JSON-safe and `structuredClone`-safe.
- Coordinates remain EMU and colors remain structured color objects; do not convert model data to pixels or hex-only colors.
- Do not add an export dependency or alter unrelated packages.

---

### Task 1: Add ZIP and XML primitives

**Files:**
- Create: `packages/pptx-import/src/zip.ts`
- Create: `packages/pptx-import/src/xml.ts`
- Create: `packages/pptx-import/src/primitives.test.ts`

**Interfaces:**
- `readZipEntries(bytes: Uint8Array): Promise<Record<string, Uint8Array>>`
- `parseXml(source: string): XmlNode`
- `XmlNode` contains `name`, `attributes`, `children`, and `text` only.

- [x] Write tests for stored and deflated ZIP entries and namespace-prefixed XML attributes.
- [x] Run `pnpm exec vitest run packages/pptx-import/src/primitives.test.ts` and observe failure.
- [x] Implement EOCD/central-directory parsing, stored method 0, deflate method 8 through `DecompressionStream`, and XML entity decoding.
- [x] Run the primitive tests and verify deterministic output.

### Task 2: Extend model contracts for source inheritance

**Files:**
- Modify: `packages/model/src/index.ts`
- Modify: `packages/model/src/model.test.ts`

**Interfaces:**
- Add `SlideLayout` with `id`, `masterId`, and optional placeholder defaults.
- Add `SlideMaster` with `id` and optional placeholder defaults.
- Add optional `layoutId`, `masterId`, `layouts`, `masters`, and `source` to `Ppt4aiDocument`.
- Add `resolveInheritedElement(element, layout?, master?): Element` for explicit slide > layout > master property resolution.

- [x] Add tests proving explicit slide fill/text wins over layout and master defaults, while absent values inherit.
- [x] Implement JSON-safe sparse inheritance types and resolver.
- [x] Run model tests and keep existing validation behavior unchanged for documents without source metadata.

### Task 3: Import presentation relationships and renderable elements

**Files:**
- Create: `packages/pptx-import/src/importer.ts`
- Modify: `packages/pptx-import/src/index.ts`
- Create: `packages/pptx-import/src/importer.test.ts`

**Interfaces:**
- `importPptx(input: Uint8Array): Promise<Ppt4aiDocument>`
- Parse `/ppt/presentation.xml`, presentation relationships, slide relationships, slide XML, slideLayout XML, and slideMaster XML.
- Import `p:sp` shape geometry (`a:prstGeom`), `a:xfrm`, solid fills, and text runs.
- Preserve `source: { entries: Record<string, string> }` as decoded XML source snapshots.

- [x] Build a small in-test OOXML ZIP fixture containing one slide, one layout, one master, and one shape/text placeholder.
- [x] Assert page size, slide order, element order, geometry, fill, text, and relationship IDs.
- [x] Implement relationship resolution and XML-to-model conversion; skip unsupported nodes without throwing.
- [x] Run importer tests and inspect the normalized JSON output.

### Task 4: Verify PPTX-to-SceneGraph and inheritance

**Files:**
- Modify: `packages/pptx-import/src/importer.test.ts`
- Modify: `packages/render/src/scene.test.ts`

- [x] Add an integration assertion that imported output feeds `documentToSceneGraph` with ordered shape/text nodes.
- [x] Assert layout/master defaults are inherited only when slide XML omits the property.
- [x] Run focused model, primitive, importer, and render tests.
- [x] Run `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, and `pnpm build`.

### Task 5: Close and commit Stage 2

**Files:**
- Modify: `进度.md`
- Modify: `docs/superpowers/plans/2026-08-22-stage-2-pptx-import.md`

- [x] Mark Stage 2 complete with verification evidence and Stage 3 as the next target.
- [x] Review `git diff --check` and confirm generated `dist` files are ignored.
- [x] Commit exactly once with `git commit -m "feat: add stage 2 pptx import"`.
