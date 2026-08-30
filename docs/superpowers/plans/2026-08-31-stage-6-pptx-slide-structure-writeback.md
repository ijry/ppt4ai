# PPTX Slide Structure Write-back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export imported PPTX documents after page reorder, deletion, insertion, and duplication while preserving unrelated package content.

**Architecture:** Add source provenance to each imported `Slide`, then make `@ppt4ai/pptx-export` build a deterministic page plan before applying existing element-level write-back. Reused pages keep their original parts, duplicated pages clone source parts, blank pages use a minimal slide with a source layout relationship, and presentation/content-type XML is synchronized by range-preserving edits.

**Tech Stack:** TypeScript 6, Vitest 4, browser-compatible `Uint8Array`, existing ZIP reader/writer, namespace-agnostic XML range scanner.

**Spec:** `docs/superpowers/specs/2026-08-31-stage-6-pptx-slide-structure-writeback-design.md`

## Global Constraints

- Keep `@ppt4ai/model`, `@ppt4ai/pptx-import`, and `@ppt4ai/render` headless.
- Do not add Vue, DOM, Canvas, Element Plus, or runtime CSS dependencies.
- Preserve unmodified entry contents, unknown XML, relationship targets, binary resources, and source ZIP order.
- Use `Slide.source.originId`, `partPath`, `relationshipId`, and `presentationId` for source-backed page identity.
- New page IDs, relationship IDs, and slide part names are deterministic and collision-free.
- Existing table and image element write-back continues to run for reusable and cloned source pages.
- Every independently completed task ends with focused verification and its own commit; the progress document is a separate documentation commit.
- Follow strict TDD: every production behavior starts with a failing test that is observed before implementation.

---

### Task 1: Add slide source provenance

**Files:**
- Modify: `packages/model/src/index.ts`
- Modify: `packages/pptx-import/src/importer.ts`
- Test: `packages/model/src/model.test.ts`
- Test: `packages/pptx-import/src/importer.test.ts`

**Interfaces:**
- `SlideSource` is exported from `@ppt4ai/model` with `originId`, `partPath`, `relationshipId`, and `presentationId` string fields.
- `Slide.source?: SlideSource` is optional, so existing hand-built documents remain valid.
- `importPptx()` sets the four fields from each original `p:sldId` and presentation relationship.

- [ ] **Step 1: Write the failing provenance tests**

  Add a model validation test that accepts a well-formed `Slide.source` and rejects an empty source path or relationship ID. Add an importer test that asserts a two-slide fixture records each slide's original part path, relationship ID, presentation ID, and `originId`.

- [ ] **Step 2: Run focused tests to verify RED**

  Run `pnpm exec vitest run packages/model/src/model.test.ts packages/pptx-import/src/importer.test.ts`. Expect a type/test failure because `SlideSource` and importer population do not exist yet.

- [ ] **Step 3: Implement the smallest provenance contract**

  Add the optional type and validation branches. While iterating `slideRefs` in `importPptx`, read the source `p:sldId/@id` and its slide relationship ID, resolve the slide path, and attach:

  ```ts
  source: {
    originId: slideId,
    partPath: slidePath,
    relationshipId,
    presentationId: reference.attributes.id ?? '',
  }
  ```

  Skip malformed references exactly as the current importer does; valid imported slides always receive a complete binding.

- [ ] **Step 4: Verify provenance behavior**

  Run `pnpm exec vitest run packages/model/src/model.test.ts packages/pptx-import/src/importer.test.ts`; then run `pnpm --filter @ppt4ai/model typecheck` and `pnpm --filter @ppt4ai/pptx-import typecheck`.

- [ ] **Step 5: Commit provenance**

  ```bash
  git add packages/model/src/index.ts packages/model/src/model.test.ts packages/pptx-import/src/importer.ts packages/pptx-import/src/importer.test.ts
  git commit -m "feat: retain pptx slide source provenance"
  ```

### Task 2: Plan and export reused/reordered/deleted pages

**Files:**
- Modify: `packages/pptx-export/src/writeback.ts`
- Test: `packages/pptx-export/src/writeback.test.ts`

**Interfaces:**
- Keep `exportPptx(document: Ppt4aiDocument, source: Uint8Array, options?: ExportPptxOptions): Promise<Uint8Array>` unchanged.
- Add internal `SlidePlan` records with `mode: 'reuse'`, `sourcePath`, `presentationId`, `relationshipId`, and the current `slideId`.

- [ ] **Step 1: Write failing reorder/delete tests**

  Build a two-slide stored package with distinct slide XML and a binary entry. Import it, reverse `slideOrder`, export, and assert re-imported order and entry content follow the reversed pages. Remove one slide, export, and assert the presentation list, slide relationship, slide part, and slide content-type override are removed while the unrelated binary and layout entries remain.

- [ ] **Step 2: Run focused tests to verify RED**

  Run `pnpm exec vitest run packages/pptx-export/src/writeback.test.ts`. Expect failure because current export resolves paths by source index and does not synchronize presentation structure.

- [ ] **Step 3: Implement provenance-aware source planning**

  Parse presentation references into source records keyed by `Slide.source.partPath` and retain each raw `p:sldId` and relationship XML range. Resolve each current slide through its binding, reject missing or ambiguous bindings, and build the current plan in `document.slideOrder`. For legacy imported documents, accept only the exact `sld_N` ID-to-source-index fallback.

- [ ] **Step 4: Implement range-preserving structure updates**

  Replace the `p:sldIdLst` child content in current order, remove unreferenced source slide relationship nodes and parts, and preserve every non-slide relationship and non-slide ZIP entry. Keep existing table/image replacement for each reused part. Allocate no new IDs in this task.

- [ ] **Step 5: Verify reorder/delete behavior**

  Run `pnpm exec vitest run packages/pptx-export/src/writeback.test.ts`; then run `pnpm --filter @ppt4ai/pptx-export typecheck` and `pnpm --filter @ppt4ai/pptx-export build`.

- [ ] **Step 6: Commit reused-page write-back**

  ```bash
  git add packages/pptx-export/src/writeback.ts packages/pptx-export/src/writeback.test.ts
  git commit -m "feat: write back pptx slide order and deletion"
  ```

### Task 3: Add blank and duplicated slide parts

**Files:**
- Modify: `packages/pptx-export/src/writeback.ts`
- Test: `packages/pptx-export/src/writeback.test.ts`

**Interfaces:**
- Internal `SlidePlan` additionally supports `mode: 'clone' | 'blank'`, `outputPath`, and optional `sourcePath`.
- No new public exporter argument is required; cloned `Slide.source` is the source marker.

- [ ] **Step 1: Write failing insertion/duplication tests**

  Insert a blank `Slide` with no `source` between two imported pages and assert a valid new slide part, a slide-layout relationship, a new presentation relationship, a new `p:sldId`, and a new content-type override. Clone an imported `Slide` under a new ID while retaining its `source`, export, and assert the cloned slide XML and relationship XML are present at a fresh path, both pages survive re-import, and original unknown XML is retained.

- [ ] **Step 2: Run focused tests to verify RED**

  Run `pnpm exec vitest run packages/pptx-export/src/writeback.test.ts`. Expect failure because the current exporter rejects unbound pages and cannot allocate structural parts.

- [ ] **Step 3: Implement deterministic ID and part allocation**

  Scan existing numeric slide suffixes, presentation IDs, and relationship IDs. Allocate the first collision-free `slideN.xml`, `slideN.xml.rels`, `p:sldId/@id`, and `rIdN` in deterministic order. Treat an `originId` equal to the current slide ID as reuse; a repeated origin binding becomes a clone.

- [ ] **Step 4: Implement clone and blank serialization**

  Clone source slide bytes and its relationship part for `mode: 'clone'`. For `mode: 'blank'`, emit a minimal `<p:sld>` with `p:cSld`, `p:spTree`, group properties, and a relationship to the first source slide's layout. Add new presentation relationships and content-type overrides using the source package's existing namespace conventions.

- [ ] **Step 5: Integrate cloned-page element write-back**

  Run the existing table/image replacement against cloned source XML using positional element-kind matching when the cloned model IDs differ from original IDs. Keep strict identity matching for reused pages so accidental z-order changes remain rejected.

- [ ] **Step 6: Verify insertion and duplication**

  Run the focused exporter tests, re-import the output with `importPptx`, assert `slideOrder` length and order, assert repeated exports are equal, and assert `structuredClone(document)` and the source bytes are unchanged.

- [ ] **Step 7: Commit structural additions**

  ```bash
  git add packages/pptx-export/src/writeback.ts packages/pptx-export/src/writeback.test.ts
  git commit -m "feat: write back pptx inserted and duplicated slides"
  ```

### Task 4: Full verification and progress record

**Files:**
- Modify: `进度.md`

- [ ] **Step 1: Run focused package verification**

  Run `pnpm exec vitest run packages/pptx-export/src packages/pptx-import/src/importer.test.ts packages/model/src/model.test.ts` and confirm all structural write-back cases pass.

- [ ] **Step 2: Run repository verification**

  Run `pnpm test -- --pool=threads --maxWorkers=1`, `pnpm check:boundaries`, `pnpm typecheck`, `pnpm --workspace-concurrency=1 build`, `rg -n "element-plus|Element Plus" packages apps package.json pnpm-lock.yaml`, and `git diff --check`. The Element Plus search must return no runtime dependency or import.

- [ ] **Step 3: Update the progress record**

  Add a dated entry stating that imported PPTX page reorder, deletion, blank insertion, and source-slide duplication now write back deterministically; retain full no-source package generation, dependent-part cloning, and PowerPoint manual-open validation as pending. Record focused/full test counts and the implementation commits, and update the next-work section to the next highest-value export or asset workflow.

- [ ] **Step 4: Commit the progress record**

  ```bash
  git add 进度.md
  git commit -m "docs: record pptx slide structure writeback milestone"
  ```

