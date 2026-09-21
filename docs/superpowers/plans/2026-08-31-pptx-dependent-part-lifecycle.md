# PPTX Dependent Part Lifecycle Implementation Plan

> **状态：已实现（2026-09-01 核实）。** 下方复选框未回填，勿据此判断为待办 —— `packages/pptx-export/src/dependency-graph.ts` 已落地并有独立测试，里程碑见 `进度.md`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clone slide-owned OPC dependencies for duplicated PPTX pages and prune orphaned source dependencies after page deletion.

**Architecture:** Add a small browser-safe package-graph module beside the existing source write-back code. It parses relationship sidecars with the existing range scanner, builds deterministic path maps, clones only non-global internal dependencies, and computes protected reachability before `exportPptx` filters entries. Presentation and element write-back stay in `writeback.ts`; the graph module owns path/relationship/content-type mechanics.

**Tech Stack:** TypeScript 6, Vitest 4, `Uint8Array`, existing ZIP reader/writer, existing namespace-agnostic XML range scanner.

**Spec:** `docs/superpowers/specs/2026-08-31-pptx-dependent-part-lifecycle-design.md`

## Global Constraints

- Keep the public `exportPptx(document, source, options?)` signature unchanged.
- Keep `@ppt4ai/model`, `@ppt4ai/pptx-import`, and `@ppt4ai/render` headless.
- Do not add Vue, DOM, Canvas, Element Plus, or runtime CSS dependencies.
- Preserve source entry bytes, relationship IDs/order, unknown XML, external relationships, and unrelated ZIP entries.
- Clone only non-global internal dependency targets; keep layout/master/theme and listed package-global parts shared.
- Allocate paths deterministically and never mutate the document, source bytes, or adapter-owned bytes.
- Every behavior starts with a failing test observed before production code; each independently completed task ends with focused verification and its own commit.

---

### Task 1: Add dependency graph primitives

**Files:**
- Create: `packages/pptx-export/src/dependency-graph.ts`
- Create: `packages/pptx-export/src/dependency-graph.test.ts`
- Modify: `packages/pptx-export/src/writeback.ts:32-84`

**Interfaces:**
- `clonePartDependencies(entries, sourcePath, outputPath, reservedPaths): DependencyCloneResult` returns cloned `ZipEntry[]`, a source-to-output `Map<string, string>`, and the cloned root path.
- `collectPartClosure(entries, rootPath): Set<string>` returns the root, its relationship sidecar when present, and recursively resolved internal targets.
- `rewriteRelationshipTargets(xml, ownerPath, pathMap): string` preserves the relationship XML while rewriting mapped internal targets relative to `ownerPath`.
- `isSharedDependency(relationshipType, targetPath): boolean` identifies package-global targets without inspecting model state.

- [ ] **Step 1: Write the failing graph tests**

  Add a fixture with a slide relationship part that points to a shared layout, a nested notes-like XML part, a binary media part, an external hyperlink, and a repeated target. Assert the wished-for clone result has fresh same-directory paths, copied bytes, rewritten relative targets, preserved relationship IDs/order and external target text. Add a cycle fixture and assert cloning terminates with one output per source part. Add a closure assertion for the root and sidecars.

- [ ] **Step 2: Run the graph tests to verify RED**

  Run `pnpm exec vitest run packages/pptx-export/src/dependency-graph.test.ts`. Expect failure because the module and functions do not exist yet.

- [ ] **Step 3: Implement relationship parsing and path resolution**

  Reuse the write-back scanner shape in the new module or move only the shared scanner helpers into the module. Parse `Relationship` nodes, retain `Id`, `Type`, `Target`, optional `TargetMode`, and source ranges. Resolve relative targets against the owner part, preserve URI fragments, and reject malformed internal targets with `PPTX export dependency ...` errors.

- [ ] **Step 4: Implement deterministic closure cloning**

  Map `sourcePath` to `outputPath` before visiting relationships. For each internal non-global target, allocate a same-directory path by incrementing a numeric suffix or adding `-copyN`, copy its bytes, clone its sidecar if present, and recurse once. Keep shared targets mapped to themselves and leave external relationships unmapped.

- [ ] **Step 5: Verify graph primitives green**

  Run `pnpm exec vitest run packages/pptx-export/src/dependency-graph.test.ts` and `pnpm --filter @ppt4ai/pptx-export typecheck`.

- [ ] **Step 6: Commit graph primitives**

  ```bash
  git add packages/pptx-export/src/dependency-graph.ts packages/pptx-export/src/dependency-graph.test.ts packages/pptx-export/src/writeback.ts
  git commit -m "feat: add pptx dependency graph cloning"
  ```

### Task 2: Materialize dependencies for cloned slides

**Files:**
- Modify: `packages/pptx-export/src/writeback.ts`
- Modify: `packages/pptx-export/src/writeback.test.ts`
- Modify: `packages/pptx-export/src/dependency-graph.ts`

**Interfaces:**
- `SlidePlan` keeps `mode`, `source`, and `outputPath`; clone materialization returns entries and a path map per clone.
- Existing `exportPptx` remains the only public entry point.

- [ ] **Step 1: Write the failing cloned-dependency export test**

  Build a source package with one source slide, a shared layout relationship, a slide-owned nested dependency, a binary dependency, and matching content-type overrides. Duplicate the imported slide under a new model ID. Assert the fresh slide relationship part points to fresh dependency paths, the fresh dependency bytes equal the originals, the shared layout path remains original, and the original source relationship XML is unchanged.

- [ ] **Step 2: Run the exporter test to verify RED**

  Run `pnpm exec vitest run packages/pptx-export/src/writeback.test.ts -t "clones slide-owned dependencies"`. Expect failure because current cloning copies only the slide and relationship part.

- [ ] **Step 3: Reserve and append clone entries**

  After slide plans allocate fresh slide paths, call `clonePartDependencies` for each `clone` plan with all source and planned output names reserved. Append cloned parts deterministically, reject collisions, and keep the source slide XML as the root bytes until element write-back runs.

- [ ] **Step 4: Synchronize cloned content types**

  Read the source `Override` content type for each cloned path and add the same override for its mapped output path. Do not add overrides for entries covered by defaults, and do not duplicate existing overrides.

- [ ] **Step 5: Run existing and new exporter tests**

  Run `pnpm exec vitest run packages/pptx-export/src/dependency-graph.test.ts packages/pptx-export/src/writeback.test.ts` and `pnpm --filter @ppt4ai/pptx-export build`.

- [ ] **Step 6: Commit cloned dependency integration**

  ```bash
  git add packages/pptx-export/src/dependency-graph.ts packages/pptx-export/src/writeback.ts packages/pptx-export/src/writeback.test.ts
  git commit -m "feat: clone pptx slide dependencies"
  ```

### Task 3: Prune orphaned dependencies after deletion

**Files:**
- Modify: `packages/pptx-export/src/dependency-graph.ts`
- Modify: `packages/pptx-export/src/writeback.ts`
- Modify: `packages/pptx-export/src/writeback.test.ts`

**Interfaces:**
- `findOrphanedParts(entries, removedRoots, protectedRoots): Set<string>` returns only source-owned paths no longer reachable from protected roots.
- `rewriteContentTypes` accepts exact removed paths and cloned path/content-type pairs while retaining existing slide behavior.

- [ ] **Step 1: Write failing lifecycle tests**

  Add tests that delete the original after duplicating it and assert the original slide, sidecar, nested dependency, binary dependency, and content-type overrides disappear while cloned counterparts remain. Add a shared-media case where a second retained slide references the same dependency and assert the shared bytes and override remain. Assert unrelated unknown entries remain byte-identical.

- [ ] **Step 2: Run lifecycle tests to verify RED**

  Run `pnpm exec vitest run packages/pptx-export/src/writeback.test.ts -t "dependency lifecycle"`. Expect failure because current export removes only source slide parts.

- [ ] **Step 3: Compute protected and removable closures**

  Traverse the presentation part, retained source slides, blank-slide relationship parts, and every newly cloned root. Exclude shared package-global targets from removal. For each removed source slide, collect its closure and filter out protected paths; pass the remaining exact paths to the ZIP filter.

- [ ] **Step 4: Remove matching content-type overrides**

  Extend range-preserving content-type editing to remove orphan dependency overrides and add clone overrides with their original content types. Keep defaults, ordering of untouched nodes, and unrelated XML intact.

- [ ] **Step 5: Verify deletion, sharing, and clone safety**

  Run the focused graph/write-back suites, assert repeated export bytes are equal, and assert `structuredClone(document)` plus the source bytes are unchanged.

- [ ] **Step 6: Commit lifecycle cleanup**

  ```bash
  git add packages/pptx-export/src/dependency-graph.ts packages/pptx-export/src/writeback.ts packages/pptx-export/src/writeback.test.ts
  git commit -m "feat: clean orphaned pptx dependencies"
  ```

### Task 4: Full verification and progress record

**Files:**
- Modify: `进度.md`

- [ ] **Step 1: Run focused verification**

  Run `pnpm exec vitest run packages/pptx-export/src/dependency-graph.test.ts packages/pptx-export/src/writeback.test.ts packages/pptx-import/src/importer.test.ts`, then typecheck and build `@ppt4ai/pptx-export`.

- [ ] **Step 2: Run repository verification**

  Run `pnpm test -- --pool=threads --maxWorkers=1`, `pnpm check:boundaries`, `pnpm typecheck`, `pnpm --workspace-concurrency=1 build`, `rg -n "element-plus|Element Plus" packages apps package.json pnpm-lock.yaml`, and `git diff --check`. Keep the documented temporary `TEMP`/`TMP` override if needed for disk space.

- [ ] **Step 3: Update the progress record**

  Record the dependency clone/cleanup behavior, the unavailable manual-reader validation and exact `officecli` environment failure, focused/full test counts, implementation commits, and the next deferred export/UI work.

- [ ] **Step 4: Commit the progress record**

  ```bash
  git add 进度.md
  git commit -m "docs: record pptx dependency lifecycle milestone"
  ```
