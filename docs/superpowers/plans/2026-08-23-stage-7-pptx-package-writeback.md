# Stage 7 PPTX Package Write-back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write edited imported table models back into an existing PPTX package while preserving all other source entry contents.

**Architecture:** Keep `@ppt4ai/pptx-export` headless and independent of DOM and Vue. Parse the source ZIP into uncompressed entry bytes, replace only matched slide `a:tbl` byte ranges, and emit a deterministic stored-entry ZIP. Reuse the existing pure table serializer; reject ambiguous source/model mappings instead of silently dropping edits.

**Tech Stack:** TypeScript 6, Vitest 4, browser-compatible `Uint8Array`, `DecompressionStream`, pure tag scanner.

## Global Constraints

- Keep `@ppt4ai/model`, `@ppt4ai/pptx-import`, and `@ppt4ai/render` headless.
- Do not add Vue, DOM, Canvas, browser globals beyond the existing `DecompressionStream` ZIP primitive, Element Plus, or CSS runtime dependencies.
- Accept original PPTX bytes explicitly because `document.source.entries` contains XML snapshots only and cannot preserve binary resources.
- Preserve unmodified entry content, source order, unknown XML, relationships, and binary resources.
- Replace only table `a:tbl` payloads matched by slide element order.
- Do not generate new-document packages or modify non-table elements in this slice.
- Every independently completed task ends with focused tests and its own commit.

---

### Task 1: Add ZIP writer and source-entry materialization

**Files:**
- Create: `packages/pptx-export/src/zip.ts`
- Create: `packages/pptx-export/src/zip.test.ts`
- Modify: `packages/pptx-export/src/index.ts`

**Interfaces:**
- Produces internal `readZipEntries(bytes: Uint8Array): Promise<Array<{ name: string; data: Uint8Array }>>` and `writeStoredZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array`.

- [ ] **Step 1: Write failing ZIP tests**

  Add a hand-built source fixture containing stored XML, stored binary bytes, and a deflated text entry. Assert the reader returns source order and exact uncompressed bytes. Assert the writer output can be read back and preserves every entry.

- [ ] **Step 2: Run focused tests to verify RED**

  Run `pnpm exec vitest run packages/pptx-export/src/zip.test.ts`; expect failure because the export ZIP helpers do not exist.

- [ ] **Step 3: Implement minimal ZIP reader/writer**

  Parse EOCD, central directory, local headers, methods 0/8, reject encrypted/unsupported entries, calculate CRC-32, and emit fresh method-0 local/central records with UTF-8 names and no comments.

- [ ] **Step 4: Verify ZIP task**

  Run `pnpm exec vitest run packages/pptx-export/src/zip.test.ts; pnpm --filter @ppt4ai/pptx-export typecheck; pnpm --filter @ppt4ai/pptx-export build; git diff --check`.

- [ ] **Step 5: Commit ZIP task**

  ```bash
  git add packages/pptx-export/src/zip.ts packages/pptx-export/src/zip.test.ts packages/pptx-export/src/index.ts
  git commit -m "feat: add browser-compatible pptx zip writer"
  ```

### Task 2: Add slide table replacement export

**Files:**
- Create: `packages/pptx-export/src/writeback.ts`
- Create: `packages/pptx-export/src/writeback.test.ts`
- Modify: `packages/pptx-export/src/index.ts`

**Interfaces:**
- Consumes `Ppt4aiDocument`, original PPTX `Uint8Array`, and `serializeTableXml`.
- Produces `exportPptx(document: Ppt4aiDocument, source: Uint8Array): Promise<Uint8Array>`.

- [ ] **Step 1: Write failing write-back tests**

  Build a source package with one slide, one table graphic frame, one neighboring text shape, one relationship chain, and one binary entry. Import it, change only the table model, export it, re-read the package, and assert the table XML changed, neighbor XML and binary bytes are unchanged, source order is retained, repeated export bytes are equal, and the document clone is unchanged.

- [ ] **Step 2: Run focused tests to verify RED**

  Run `pnpm exec vitest run packages/pptx-export/src/writeback.test.ts`; expect failure because `exportPptx` is not exported yet.

- [ ] **Step 3: Implement slide path resolution and offset replacement**

  Parse presentation slide relationships, map `document.slideOrder` to slide paths, scan each slide's direct `p:spTree` children in order, match table elements by `elementIds`, find each matching `a:tbl` range, and replace ranges from right to left. Throw stable errors for missing source parts, unsupported edits, or count mismatches.

- [ ] **Step 4: Verify write-back task**

  Run `pnpm exec vitest run packages/pptx-export/src/writeback.test.ts; pnpm --filter @ppt4ai/pptx-export typecheck; pnpm --filter @ppt4ai/pptx-export build; git diff --check`.

- [ ] **Step 5: Commit write-back task**

  ```bash
  git add packages/pptx-export/src/writeback.ts packages/pptx-export/src/writeback.test.ts packages/pptx-export/src/index.ts
  git commit -m "feat: write pptx table edits back to source package"
  ```

### Task 3: Record and verify package write-back slice

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes `exportPptx` and focused write-back results.
- Produces a progress record that table package write-back is complete while new-document export remains pending.

- [ ] **Step 1: Update progress record**

  Mark source-based table package write-back complete and retain full package generation as pending.

- [ ] **Step 2: Run repository verification**

  Run `pnpm test; pnpm check:boundaries; pnpm typecheck; pnpm build; git diff --check`.

- [ ] **Step 3: Commit progress record**

  ```bash
  git add 进度.md
  git commit -m "docs: record pptx package writeback slice"
  ```
