# Stage 7 Theme Color and Table Style Inheritance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import DrawingML themes and table-style inheritance, resolve structured colors deterministically at the render boundary, and preserve source colors for future editing and export.

**Architecture:** `@ppt4ai/model` owns JSON-safe color transforms, theme/color-map data, pure resolution, validation, and table-style merging. `@ppt4ai/pptx-import` follows existing relationship graphs and tolerantly parses theme, color-map, and nested table-style XML. `@ppt4ai/render` chooses the effective slide context once and exposes resolved paints/text separately from structured source values.

**Tech Stack:** TypeScript 6, Vitest 4, pnpm workspaces, existing pure XML tokenizer, existing stored/deflate ZIP reader, existing Vue-free model/layout/text/render packages.

## Global Constraints

- Keep the UI as Vue 3 plus UnoCSS; do not add Element Plus or another component framework.
- Keep `@ppt4ai/model`, `@ppt4ai/pptx-import`, and `@ppt4ai/render` free of Vue, DOM, Canvas, browser globals, and CSS runtime dependencies.
- Preserve source colors as structured JSON-safe data; resolve concrete RGB and alpha only at the render boundary.
- Use ordered transform values normalized to `0..100000`; invalid imported fragments are omitted without aborting an otherwise readable presentation.
- Keep table-style region precedence: `wholeTable`, enabled horizontal band, enabled vertical band, `firstRow`, `lastRow`, `firstCol`, `lastCol`, explicit cell values.
- Support only `srgbClr`, `schemeClr`, `prstClr`, `sysClr`, `scrgbClr`, basic color transforms, four outer table borders, fill, text color, bold, and italic.
- Exclude `fontScheme`, `effectScheme`, `fmtScheme`, theme editor UI, diagonal borders, and PPTX export XML.
- Every independently completed task ends with focused tests and its own commit.

---

### Task 1: Add model theme and color resolution

**Files:**
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/src/model.test.ts`

**Interfaces:**
- Consumes: existing `Color`, `Fill`, `TableStyleRegion`, `Slide`, `SlideLayout`, `SlideMaster`, and `Ppt4aiDocument` types.
- Produces: `ColorTransform`, `ThemeColorSlot`, `Theme`, `ColorMap`, `DEFAULT_COLOR_MAP`, `ResolvedColor`, `resolveColor`, `mergeColorMaps`, `TableStyleText`, and extended `ResolvedTableCellStyle` exports.

- [ ] **Step 1: Write failing model tests for color and theme contracts**

Append tests to `packages/model/src/model.test.ts` that import the new exports and assert the exact public shapes:

```ts
it('resolves structured colors, scheme mapping, and ordered transforms', () => {
  const theme = {
    id: 'theme-1',
    colors: {
      accent1: { type: 'srgb', v: '336699' },
      dk1: { type: 'srgb', v: '202020' },
    },
  } satisfies Theme
  expect(resolveColor({ type: 'scheme', v: 'accent1' }, theme)).toEqual({ rgb: '336699', alpha: 100000 })
  expect(resolveColor({ type: 'srgb', v: '000000', transforms: [{ type: 'tint', value: 50000 }] })).toEqual({ rgb: '808080', alpha: 100000 })
  expect(resolveColor({ type: 'srgb', v: '336699', transforms: [{ type: 'alpha', value: 50000 }, { type: 'alphaOff', value: 10000 }] })).toEqual({ rgb: '336699', alpha: 60000 })
  expect(resolveColor({ type: 'preset', v: 'red' })).toEqual({ rgb: 'FF0000', alpha: 100000 })
  expect(resolveColor({ type: 'system', v: '112233' })).toEqual({ rgb: '112233', alpha: 100000 })
  expect(resolveColor({ type: 'scrgb', v: '100000,50000,0' })).toEqual({ rgb: 'FF8000', alpha: 100000 })
  expect(resolveColor({ type: 'preset', v: 'not-a-preset' })).toBeUndefined()
})

it('applies master, layout, and slide color-map overlays in order', () => {
  expect(mergeColorMaps({ accent1: 'accent1' }, { accent1: 'accent2' }, { accent1: 'accent3' }).accent1).toBe('accent3')
})

it('merges table text defaults field by field', () => {
  const table: TableElement = {
    id: 'tbl-1',
    kind: 'table',
    bounds: { x: 0, y: 0, w: 1000, h: 1000 },
    columns: [1000],
    rows: [{ height: 1000, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Header' }] }] } }] }],
    style: { styleId: 'style-1', firstRow: true },
  }
  const style = { id: 'style-1', regions: {
    wholeTable: { text: { color: { type: 'srgb', v: '111111' }, bold: false } },
    firstRow: { text: { color: { type: 'srgb', v: 'FFFFFF' }, bold: true, italic: true } },
  } } satisfies TableStyle
  expect(resolveTableCellStyle(table, table.rows[0]!.cells[0]!, 0, 0, { 'style-1': style })).toMatchObject({ text: { color: { type: 'srgb', v: 'FFFFFF' }, bold: true, italic: true } })
})
```

Also add validation assertions for an unknown transform type, a transform value below zero, an invalid theme slot, an invalid color-map target, and a non-boolean table text flag. Assert each error contains its complete nested path; assert `structuredClone` preserves a theme and transform order; and assert recursive scheme colors resolve while a two-slot cycle, `phClr`, and a missing theme return `undefined`.

- [ ] **Step 2: Run the model tests to verify failure**

Run: `pnpm --filter @ppt4ai/model test -- src/model.test.ts`

Expected: FAIL because the new interfaces, resolver, theme fields, and text-style merge do not exist.

- [ ] **Step 3: Extend JSON-safe model interfaces and validators**

In `packages/model/src/index.ts`:

1. Replace `Color.alpha` with optional ordered `transforms`, define the seven transform types, and add `ThemeColorSlot`, `Theme`, `ColorMap`, `ResolvedColor`, and `DEFAULT_COLOR_MAP` exactly as specified in `docs/superpowers/specs/2026-08-23-stage-7-theme-table-style-inheritance-design.md`.
2. Add `themeId` and `colorMap` to `SlideMaster`, `colorMapOverride` to `SlideLayout` and `Slide`, and `themes?: Record<string, Theme>` to `Ppt4aiDocument`.
3. Add `TableStyleText.color`, `.bold`, and `.italic`; add optional `text` to `TableStyleRegion` and `ResolvedTableCellStyle`.
4. Implement `mergeColorMaps(...overlays: Array<Partial<ColorMap> | undefined>): ColorMap` by cloning the default map and applying overlays left-to-right.
5. Implement `resolveColor` with uppercase six-digit RGB parsing, preset/system/scRGB source conversion, scheme-to-map lookup, recursive theme lookup with a 16-level/cycle guard, HSL tint/shade/luminance transforms, and clamped alpha transforms. Return `undefined` for unresolved sources.
6. Refactor the existing table region merge helper so fill, border sides, and text fields merge independently while retaining the existing eight-layer order and explicit cell fill/borders last.
7. Extend validation without changing existing error ordering: validate transform arrays and numeric ranges, theme records and slot keys, color-map keys/targets, master/layout/slide override objects, table text color, and boolean flags.

Do not introduce browser APIs or a color library. Keep all resolver outputs clone-safe.

- [ ] **Step 4: Run focused model tests, typecheck, and build**

Run: `pnpm --filter @ppt4ai/model test -- src/model.test.ts; pnpm --filter @ppt4ai/model typecheck; pnpm --filter @ppt4ai/model build`

Expected: PASS with existing table-style tests unchanged and new color/theme/text-style tests green.

- [ ] **Step 5: Commit the model slice**

```bash
git add packages/model/src/index.ts packages/model/src/model.test.ts
git commit -m "feat: add theme color resolution to model"
```

---

### Task 2: Import themes and effective color-map relationships

**Files:**
- Modify: `packages/pptx-import/src/importer.ts`
- Test: `packages/pptx-import/src/importer.test.ts`

**Interfaces:**
- Consumes: `Theme`, `ColorMap`, `ColorTransform`, `SlideMaster.themeId`, `SlideMaster.colorMap`, `SlideLayout.colorMapOverride`, and `Slide.colorMapOverride` from `@ppt4ai/model`.
- Produces: `importPptx` documents containing `themes`, master theme links, parsed color maps, and ordered color transforms while preserving all existing `source.entries`.

- [ ] **Step 1: Write failing relationship and XML fixture tests**

Add a fixture with a non-default theme part and these relationships:

```xml
<Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/custom.xml"/>
```

Use theme XML containing `dk1`, `lt1`, `accent1`, `hlink`, `folHlink`, `sysClr lastClr`, `scrgbClr r="100000" g="50000" b="0"`, and ordered `lumMod`, `lumOff`, `alphaMod`, and `alphaOff` children. Add master `p:clrMap`, layout `p:clrMapOvr` with `a:overrideClrMapping`, and slide override with a different accent target. Assert the imported master points at the normalized theme ID, the theme has all valid slots and ordered transforms, and source XML includes the custom theme.

Add malformed variants with a missing theme relationship, invalid transform value, missing `clrScheme`, unknown map target, and `a:masterClrMapping`. Assert import still returns the slide, layout, master, and sibling elements, with only invalid optional fields omitted.

- [ ] **Step 2: Run focused importer tests to verify failure**

Run: `pnpm --filter @ppt4ai/pptx-import test -- src/importer.test.ts`

Expected: FAIL because themes, color maps, and transform children are currently not parsed or attached.

- [ ] **Step 3: Implement source color and theme parsers**

In `packages/pptx-import/src/importer.ts`:

1. Extend `parseColor` to select the first supported `srgbClr`, `schemeClr`, `prstClr`, `sysClr`, or `scrgbClr` child, normalize canonical values, and collect recognized transform children in child order. Parse `sysClr` from valid `lastClr` and parse scRGB channels as `0..100000` integers.
2. Add `parseTheme(xml, id): Theme | undefined` for `a:clrScheme` and the twelve named slots. Keep only valid colors and return `undefined` when no valid slot exists.
3. Add `parseColorMap(node): Partial<ColorMap> | undefined` for `p:clrMap` and `a:overrideClrMapping`, accepting only known map keys and theme-slot targets.
4. Cache theme parts by normalized path so multiple masters share one JSON theme object without duplicate parsing work.

- [ ] **Step 4: Attach relationship-derived theme data during import**

Extend the existing presentation/slide/layout/master traversal to resolve the master theme relationship, parse it once, set `themeId`, and attach master, layout, and slide color-map data. Parse slide/layout `clrMapOvr`; omit `masterClrMapping` overrides. Add `themes` only when non-empty, retain all parsed XML in `source.entries`, and catch malformed optional theme parsing at the same tolerant boundary used for other optional parts.

- [ ] **Step 5: Run importer tests, typecheck, and build**

Run: `pnpm --filter @ppt4ai/pptx-import test -- src/importer.test.ts; pnpm --filter @ppt4ai/pptx-import typecheck; pnpm --filter @ppt4ai/pptx-import build`

Expected: PASS for existing import tests and new theme relationship/malformed XML tests.

- [ ] **Step 6: Commit the importer theme slice**

```bash
git add packages/pptx-import/src/importer.ts packages/pptx-import/src/importer.test.ts
git commit -m "feat: import pptx themes and color maps"
```

---

### Task 3: Import nested table-style text and cell-style inheritance

**Files:**
- Modify: `packages/pptx-import/src/importer.ts`
- Test: `packages/pptx-import/src/importer.test.ts`

**Interfaces:**
- Consumes: the model's `TableStyleText`, extended `TableStyleRegion`, and existing `parseTableStyles` direct-fixture behavior.
- Produces: table-style regions containing `fill`, four outer borders, and `text` from nested `tcStyle`/`tcTxStyle` or legacy direct children.

- [ ] **Step 1: Write failing nested table-style tests**

Replace the style fixture's first-row region with real nested content:

```xml
<a:firstRow>
  <a:tcStyle>
    <a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="50000"/></a:schemeClr></a:solidFill></a:fill>
    <a:tcBdr><a:lnL w="12700"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:lnL></a:tcBdr>
  </a:tcStyle>
  <a:tcTxStyle b="1" i="0"><a:schemeClr val="tx1"/></a:tcTxStyle>
</a:firstRow>
```

Assert nested fill, left border, text color, bold, and italic import. Add a fixture containing both direct and nested values and assert nested values win field-by-field. Keep the existing direct-format assertion so compatibility remains explicit.

- [ ] **Step 2: Run focused importer tests to verify failure**

Run: `pnpm --filter @ppt4ai/pptx-import test -- src/importer.test.ts`

Expected: FAIL because the current parser reads only direct region `solidFill` and line children and does not read `tcStyle` or `tcTxStyle`.

- [ ] **Step 3: Implement nested region parsing**

Refactor the existing style-region helper to parse direct children first, then parse `tcStyle/tcBdr` line children and `tcStyle/fill` solid fill. Parse `tcTxStyle` color through the shared color parser and accept only `b="0|1"` and `i="0|1"`. Overlay nested values field-by-field over direct values; omit a region only when it has no fill, borders, or text fields. Leave unsupported XML children ignored.

- [ ] **Step 4: Run importer tests and package checks**

Run: `pnpm --filter @ppt4ai/pptx-import test -- src/importer.test.ts; pnpm --filter @ppt4ai/pptx-import typecheck; pnpm --filter @ppt4ai/pptx-import build`

Expected: PASS, including first-definition-wins, source preservation, malformed style tolerance, and nested style assertions.

- [ ] **Step 5: Commit the table-style importer slice**

```bash
git add packages/pptx-import/src/importer.ts packages/pptx-import/src/importer.test.ts
git commit -m "feat: import nested pptx table styles"
```

---

### Task 4: Resolve theme colors in SceneGraph

**Files:**
- Modify: `packages/render/src/scenegraph.ts`
- Test: `packages/render/src/scene.test.ts`

**Interfaces:**
- Consumes: `resolveColor`, `mergeColorMaps`, `Theme`, document `themes`, master/layout/slide map fields, and `ResolvedTableCellStyle`.
- Produces: `SceneShapeNode.resolvedFillColor`, `SceneShapeNode.resolvedStrokeColor`, `SceneTextNode.resolvedFillColor`, `SceneTextNode.resolvedStrokeColor`, `SceneTextLayoutRun.resolvedColor`, and table-cell `resolvedFillColor`, `resolvedBorderColors`, and `resolvedTextStyle` fields. Existing source `fill`, `stroke`, and structured `resolvedStyle` remain unchanged.

- [ ] **Step 1: Write failing SceneGraph tests**

Extend the existing scene fixture with one theme, master accent mapping, layout override, slide override, a scheme-colored shape, scheme-colored text run, and table style regions using scheme colors. Assert:

```ts
expect(shapeNode.resolvedFillColor).toEqual({ rgb: '336699', alpha: 100000 })
expect(textNode.layout.lines[0]?.runs[0]?.resolvedColor).toEqual({ rgb: '336699', alpha: 100000 })
expect(tableNode.layout.cells[0]?.resolvedFillColor).toEqual({ rgb: '336699', alpha: 100000 })
expect(tableNode.layout.cells[0]?.resolvedTextStyle).toEqual({ color: { rgb: '202020', alpha: 100000 }, bold: true })
expect(structuredClone(graph)).toEqual(graph)
```

Include a case where a run's explicit color wins over table text defaults and a case where slide mapping wins over layout/master mapping.

- [ ] **Step 2: Run focused render tests to verify failure**

Run: `pnpm --filter @ppt4ai/render test -- src/scene.test.ts`

Expected: FAIL because SceneGraph currently passes only structured source colors and does not expose resolved paint/text values or effective theme context.

- [ ] **Step 3: Implement effective slide context and resolved fields**

In `scenegraph.ts`, define clone-safe `SceneTextLayoutRun extends TextLayoutRun` with optional `resolvedColor`, matching scene line/layout wrappers, and a resolved-color record for the four table border sides. Compute `theme` from `slide.masterId ?? layout.masterId`, then compute `colorMap = mergeColorMaps(master.colorMap, layout.colorMapOverride, slide.colorMapOverride)`. Pass this context through node creation. Resolve shape and text element fills/strokes using `resolveColor`; map each `TextLayout` line/run into its scene wrapper and derive `resolvedColor` from `run.marks?.color?.color`.

For each table cell, keep `resolvedStyle` as the structured merged style, resolve its fill and each present border side with the same theme/context, and expose concrete table defaults in `resolvedTextStyle`. Clone the cell body and merge table defaults into each run's marks before `layoutText`; explicit run `color`, `bold`, and `italic` fields overwrite defaults. Convert that layout to the scene wrapper so every run also receives `resolvedColor`. Do not mutate source model objects.

- [ ] **Step 4: Run render tests, typecheck, and build**

Run: `pnpm --filter @ppt4ai/render test -- src/scene.test.ts; pnpm --filter @ppt4ai/render typecheck; pnpm --filter @ppt4ai/render build`

Expected: PASS with old structured fields and new resolved fields present, including clone safety.

- [ ] **Step 5: Commit the SceneGraph slice**

```bash
git add packages/render/src/scenegraph.ts packages/render/src/scene.test.ts
git commit -m "feat: resolve theme colors in scene graph"
```

---

### Task 5: Record and verify the complete inheritance slice

**Files:**
- Modify: `进度.md`

- [ ] **Step 1: Update the progress record**

Change the Stage 7 pending line for complete theme/style inheritance to checked, and change the next pending item to mention only PPTX table export XML. Do not mark export complete.

- [ ] **Step 2: Run focused and repository verification**

Run: `pnpm --filter @ppt4ai/model test; pnpm --filter @ppt4ai/pptx-import test; pnpm --filter @ppt4ai/render test; pnpm check:boundaries; pnpm test; pnpm typecheck; pnpm build; git diff --check`

Expected: all commands pass, with no boundary violations, no type errors, and no whitespace errors.

- [ ] **Step 3: Commit the progress record**

```bash
git add 进度.md
git commit -m "docs: record theme table inheritance slice"
```

---

## Self-Review Checklist

- [x] Every requirement in `docs/superpowers/specs/2026-08-23-stage-7-theme-table-style-inheritance-design.md` maps to Tasks 1 through 5.
- [x] No step relies on placeholder prose, omitted implementation detail, or unspecified error handling.
- [x] `resolveColor`, `mergeColorMaps`, `ColorMap`, `Theme`, `TableStyleText`, and every SceneGraph field use the same names throughout the plan.
- [x] Theme/font/effect/export exclusions remain explicit and are not accidentally assigned to an implementation task.
- [x] Each task has a focused test command and an independent commit.
