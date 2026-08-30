# PPTX Exact No-op Byte Round-trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return exact source ZIP bytes for unchanged imported documents while preserving the existing write-back fallback for every edit.

**Architecture:** Add canonical, browser-safe fingerprint helpers to `@ppt4ai/model`; the importer records the exact source-byte and model fingerprints in optional source metadata. `exportPptx` performs a conservative equality check before ZIP parsing and returns a copied source buffer only when both fingerprints match. All structural, element, dependency, and asset changes continue through the current exporter.

**Tech Stack:** TypeScript 6, Vitest 4, `Uint8Array`, fixed 64-bit FNV-1a, existing importer/exporter APIs.

**Spec:** `docs/superpowers/specs/2026-08-31-pptx-byte-roundtrip-design.md`

## Global Constraints

- Keep `exportPptx(document, source, options?)` and `importPptx(input, options?)` public signatures unchanged.
- Keep fingerprints JSON-safe, deterministic, and optional for backward compatibility.
- Exclude only top-level `source` metadata from the model fingerprint; preserve model array order and recursively canonicalize object keys.
- Never mutate the document, source bytes, or adapter-owned bytes.
- Do not change standalone generation or add runtime dependencies, Vue, DOM, Canvas, Element Plus, or CSS frameworks.
- Every production behavior starts with a failing test observed before implementation; each independently completed task ends with focused verification and its own commit.

---

### Task 1: Add fingerprint primitives and source metadata

**Files:**
- Modify: `packages/model/src/index.ts`
- Modify: `packages/model/src/model.test.ts`

**Interfaces:**
- `fingerprintBytes(bytes: Uint8Array): string` returns a deterministic non-empty string.
- `fingerprintDocument(document: Ppt4aiDocument): string` ignores only the top-level `source` property.
- `Ppt4aiDocument.source` optionally accepts `packageFingerprint` and `modelFingerprint`.

- [ ] **Step 1: Write the failing fingerprint tests**

  Assert equal byte arrays produce equal fingerprints, different bytes differ, object key insertion order does not change a document fingerprint, changing an element does change it, changing only `document.source` does not change it, and neither helper mutates its input. Add validation cases accepting non-empty fingerprints and rejecting empty values.

- [ ] **Step 2: Run the model tests to verify RED**

  Run `pnpm exec vitest run packages/model/src/model.test.ts`. Expect failure because the helpers and source fields do not exist yet.

- [ ] **Step 3: Implement canonical serialization and FNV-1a**

  Add a recursive canonical JSON serializer that sorts object keys, preserves arrays, omits only the root `source`, and uses a fixed `TextEncoder`. Hash bytes with a fixed 64-bit FNV-1a offset basis and prime, returning a padded hexadecimal string. Add optional source field validation without rejecting old metadata.

- [ ] **Step 4: Verify model primitives**

  Run `pnpm exec vitest run packages/model/src/model.test.ts` and `pnpm --filter @ppt4ai/model typecheck`.

- [ ] **Step 5: Commit fingerprint primitives**

  ```bash
  git add packages/model/src/index.ts packages/model/src/model.test.ts
  git commit -m "feat: add deterministic pptx source fingerprints"
  ```

### Task 2: Record fingerprints during import

**Files:**
- Modify: `packages/pptx-import/src/importer.ts`
- Modify: `packages/pptx-import/src/importer.test.ts`

**Interfaces:**
- Every newly imported document records `source.packageFingerprint` from the exact input bytes and `source.modelFingerprint` from the completed model.
- Existing slide source provenance and XML entry snapshots remain unchanged.

- [ ] **Step 1: Write the failing importer assertions**

  Import the existing fixture, assert both source fingerprints are non-empty, assert they match `fingerprintBytes(input)` and `fingerprintDocument(imported)`, and assert the values survive `structuredClone`.

- [ ] **Step 2: Run importer tests to verify RED**

  Run `pnpm exec vitest run packages/pptx-import/src/importer.test.ts`. Expect failure because importer source metadata currently contains only XML entries.

- [ ] **Step 3: Attach package and model fingerprints**

  Build the result document in a local variable, attach `packageFingerprint` before return, calculate `modelFingerprint` after the full model is assembled, and update source metadata without changing parsed elements or adapter behavior.

- [ ] **Step 4: Verify importer behavior**

  Run `pnpm exec vitest run packages/pptx-import/src/importer.test.ts packages/model/src/model.test.ts`, then typecheck `@ppt4ai/pptx-import`.

- [ ] **Step 5: Commit importer metadata**

  ```bash
  git add packages/pptx-import/src/importer.ts packages/pptx-import/src/importer.test.ts
  git commit -m "feat: record pptx import fingerprints"
  ```

### Task 3: Add the exact no-op exporter path

**Files:**
- Modify: `packages/pptx-export/src/writeback.ts`
- Modify: `packages/pptx-export/src/writeback.test.ts`

**Interfaces:**
- `exportPptx` keeps its current signature and returns a copied source buffer when both optional fingerprints match.

- [ ] **Step 1: Write the failing exact-roundtrip tests**

  Append non-package trailing bytes to a valid imported source, export the unchanged document, and assert the output equals the exact input and an adapter records no reads. Add a changed-source case by altering one relationship byte and assert export rejects or follows the existing validation path rather than returning the altered bytes. Add a model-edit case and assert the output is not the original buffer.

- [ ] **Step 2: Run exporter tests to verify RED**

  Run `pnpm exec vitest run packages/pptx-export/src/writeback.test.ts -t "exact source bytes|fingerprint"`. Expect failure because the current exporter always parses and rewrites the ZIP.

- [ ] **Step 3: Implement the conservative fast path**

  Import `fingerprintBytes` and `fingerprintDocument`, check that both optional metadata fields are present and equal before `readZipEntries`, and return `new Uint8Array(source)` on success. Leave all existing code as the fallback.

- [ ] **Step 4: Verify exact and fallback behavior**

  Run the focused exporter suite, the full exporter/importer/model suites, and `pnpm --filter @ppt4ai/pptx-export typecheck`.

- [ ] **Step 5: Commit exporter fast path**

  ```bash
  git add packages/pptx-export/src/writeback.ts packages/pptx-export/src/writeback.test.ts
  git commit -m "feat: preserve exact bytes for unchanged pptx" 
  ```

### Task 4: Full verification and progress record

**Files:**
- Modify: `进度.md`

- [ ] **Step 1: Run focused verification**

  Run `pnpm exec vitest run packages/model/src/model.test.ts packages/pptx-import/src/importer.test.ts packages/pptx-export/src/writeback.test.ts`, then package typechecks and build.

- [ ] **Step 2: Run repository verification**

  Run `pnpm test -- --pool=threads --maxWorkers=1`, `pnpm check:boundaries`, `pnpm typecheck`, `pnpm --workspace-concurrency=1 build`, `rg -n "element-plus|Element Plus" packages apps package.json pnpm-lock.yaml`, and `git diff --check`.

- [ ] **Step 3: Update the progress record**

  Record exact no-op source-byte preservation, backward-compatible fingerprints, test counts, implementation commits, and the remaining manual reader/custom layout work.

- [ ] **Step 4: Commit the progress record**

  ```bash
  git add 进度.md
  git commit -m "docs: record pptx exact byte roundtrip milestone"
  ```
