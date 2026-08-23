# Stage 7 Theme Color and Table Style Inheritance Design

## Context

Stage 7 now imports DrawingML table geometry, resolves table style regions, supports structural editing, and exposes table cell text editing. The current color model still preserves only a color source and optional alpha, while the importer does not follow slide master theme relationships or interpret DrawingML color transforms. As a result, table styles that use `schemeClr`, nested `tcStyle`, or `tcTxStyle` cannot produce the colors and text emphasis used by PowerPoint.

This slice adds reusable theme-color semantics to the headless model and importer, then proves the behavior through table-style inheritance and SceneGraph output. The same resolver is available to shape and text renderers without coupling `@ppt4ai/model`, `@ppt4ai/pptx-import`, or `@ppt4ai/render` to Vue, DOM, Canvas, browser globals, Element Plus, or UnoCSS runtime state.

## Goal

Preserve DrawingML colors and ordered transforms as structured source data, import presentation themes and color-map inheritance, resolve deterministic concrete colors at the render boundary, and extend table styles with nested cell and text formatting.

## Scope

- Extend structured colors with ordered DrawingML color transforms.
- Preserve `srgbClr`, `schemeClr`, `prstClr`, `sysClr`, and `scrgbClr` sources.
- Add clone-safe themes, theme color slots, and color maps to the document model.
- Connect slide masters to theme parts during PPTX import.
- Parse theme color schemes, master color maps, and layout/slide color-map overrides.
- Export a pure headless `resolveColor` function from `@ppt4ai/model`.
- Extend table style regions with text color, bold, and italic properties.
- Parse PowerPoint's nested `tcStyle` and `tcTxStyle` table-style structures while retaining the existing direct-region fixture format.
- Resolve concrete colors for shape, text, and table SceneGraph consumers, with table styles as the acceptance focus.
- Degrade deterministically when theme relationships or supported XML fragments are missing or malformed.

## Non-goals

- `fontScheme` family inheritance or theme font substitution.
- `fmtScheme`, `effectScheme`, gradients, images, or arbitrary DrawingML effects.
- A theme editor or other new Vue/UnoCSS user interface.
- Diagonal table borders.
- PPTX table-style or theme export XML.
- Byte-for-byte OOXML round trips.

## Structured Color Contract

Replace the single optional `alpha` field with an ordered transform list while accepting the existing source variants:

```ts
export type ColorTransformType =
  | 'tint'
  | 'shade'
  | 'lumMod'
  | 'lumOff'
  | 'alpha'
  | 'alphaMod'
  | 'alphaOff'

export interface ColorTransform {
  type: ColorTransformType
  value: number
}

export interface Color {
  type: 'srgb' | 'scheme' | 'preset' | 'system' | 'scrgb'
  v: string
  transforms?: ColorTransform[]
}

export interface ResolvedColor {
  rgb: string
  alpha: number
}
```

Transform order is significant and must match XML child order. Transform values are normalized to the inclusive range `0..100000`; invalid values are omitted during import and rejected by explicit document validation. `ResolvedColor.rgb` is an uppercase six-digit hexadecimal string without `#`, and `alpha` is an integer in `0..100000`.

The legacy JSON shape `{ alpha: number }` is not retained as a second representation. Existing internal fixtures and call sites migrate to `transforms: [{ type: 'alpha', value }]`, preventing ambiguous transform order.

Source values use these canonical forms:

- `srgb`: uppercase six-digit hexadecimal RGB.
- `scheme`: the original DrawingML scheme token such as `accent1`, `tx1`, or `phClr`.
- `preset`: the original preset token; known tokens resolve through a deterministic internal preset map.
- `system`: `lastClr` when valid, otherwise the system token remains unresolved.
- `scrgb`: a comma-separated canonical triple of integer percentages in `0..100000`, such as `100000,50000,0`.

## Theme and Color-Map Contract

Add JSON-safe theme structures:

```ts
export type ThemeColorSlot =
  | 'dk1'
  | 'lt1'
  | 'dk2'
  | 'lt2'
  | 'accent1'
  | 'accent2'
  | 'accent3'
  | 'accent4'
  | 'accent5'
  | 'accent6'
  | 'hlink'
  | 'folHlink'

export interface Theme {
  id: string
  colors: Partial<Record<ThemeColorSlot, Color>>
}

export type ColorMapKey =
  | 'bg1'
  | 'tx1'
  | 'bg2'
  | 'tx2'
  | 'accent1'
  | 'accent2'
  | 'accent3'
  | 'accent4'
  | 'accent5'
  | 'accent6'
  | 'hlink'
  | 'folHlink'

export type ColorMap = Record<ColorMapKey, ThemeColorSlot>
```

The default color map is:

```ts
export const DEFAULT_COLOR_MAP: ColorMap = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink',
}
```

Extend document relationships as follows:

```ts
export interface SlideMaster {
  id: string
  defaults?: ElementDefaults
  themeId?: string
  colorMap?: Partial<ColorMap>
}

export interface SlideLayout {
  // existing fields remain unchanged
  colorMapOverride?: Partial<ColorMap>
}

export interface Slide {
  // existing fields remain unchanged
  colorMapOverride?: Partial<ColorMap>
}

export interface Ppt4aiDocument {
  // existing fields remain unchanged
  themes?: Record<string, Theme>
}
```

The effective map starts from `DEFAULT_COLOR_MAP`, overlays the master map, then the layout override, then the slide override. Unknown or invalid entries are ignored during tolerant import. Explicit validation rejects unknown map keys, invalid target slots, empty theme IDs, and theme colors that fail color validation.

## Color Resolution Contract

`@ppt4ai/model` exports a pure function:

```ts
export function resolveColor(
  color: Color | undefined,
  theme?: Theme,
  colorMap: ColorMap = DEFAULT_COLOR_MAP,
): ResolvedColor | undefined
```

Resolution follows these rules:

1. Resolve the source color to a base RGB value.
2. For `scheme` colors, map `bg1`, `tx1`, `bg2`, `tx2`, accents, and hyperlinks through the effective color map before looking up the theme slot. Direct theme slot names such as `dk1` and `lt1` bypass the map.
3. Resolve a theme slot's own structured color recursively, with a fixed maximum depth of 16 and cycle detection. `phClr` has no independent value and resolves only when a caller supplies a concrete placeholder color in a future API; this slice returns `undefined`.
4. Apply transforms in stored order.
5. Return `undefined` rather than inventing black when the source cannot be resolved.

RGB transforms use deterministic HSL calculations with hue in degrees and saturation/lightness in `0..1`. Conversion clamps each channel and rounds the final channel value to the nearest integer. Transform math is:

```text
tint:     L = L + (1 - L) * value / 100000
shade:    L = L * value / 100000
lumMod:   L = L * value / 100000
lumOff:   L = L + value / 100000
alpha:    A = value
alphaMod: A = A * value / 100000
alphaOff: A = A + value
```

Lightness and alpha are clamped after every operation. Alpha starts at `100000`. `tint` and `shade` intentionally use HSL lightness so every package obtains identical results.

The preset map covers the standard DrawingML preset color names encountered by current fixtures. Unknown preset or system colors resolve to `undefined`; a valid `sysClr lastClr` resolves from `lastClr` and does not depend on host operating-system colors.

## Table Style Contract

Extend style regions without changing table region precedence:

```ts
export interface TableStyleText {
  color?: Color
  bold?: boolean
  italic?: boolean
}

export interface TableStyleRegion {
  fill?: Fill
  borders?: TableCellBorders
  text?: TableStyleText
}

export interface ResolvedTableCellStyle {
  fill?: Fill
  borders: TableCellBorders
  text?: TableStyleText
}
```

`resolveTableCellStyle` merges region fields in this order:

1. `wholeTable`
2. enabled horizontal band
3. enabled vertical band
4. `firstRow`
5. `lastRow`
6. `firstCol`
7. `lastCol`
8. explicit cell fill and four explicit outer borders

Text properties merge field-by-field just like border sides. This slice has no explicit cell-level text-style override field; existing rich-text run properties remain the final authority when text layout resolves a run. First/last row and column regions therefore override band and whole-table text defaults, while missing fields inherit from earlier regions.

## PPTX Import Contract

The importer follows relationships rather than assuming theme filenames:

1. Resolve each slide's layout and master using the existing relationship traversal.
2. Resolve each master's `officeDocument/relationships/theme` target.
3. Parse each unique theme part once and use its normalized ZIP path as `Theme.id`.
4. Store `SlideMaster.themeId` and add the parsed theme to `Ppt4aiDocument.themes` only when a valid color scheme exists.
5. Parse the master's `p:clrMap`.
6. Parse layout and slide `p:clrMapOvr/a:overrideClrMapping`; `a:masterClrMapping` produces no override.

Theme parsing reads `a:theme/a:themeElements/a:clrScheme` and the twelve supported theme slots. Each slot uses the first supported color child. Missing theme parts, malformed XML, absent `clrScheme`, unsupported colors, or broken relationships do not fail presentation import.

`parseColor` accepts the five supported source elements and records supported transform children in XML order. It ignores unknown transforms. `sysClr` prefers a valid `lastClr`; `scrgbClr` requires valid `r`, `g`, and `b` values.

Table-style parsing supports both representations:

- Real PowerPoint nesting: region `tcStyle` supplies `fill` and `tcBdr/lnL|lnR|lnT|lnB`; `tcTxStyle` supplies a color child plus `b` and `i` attributes.
- Existing direct fixtures: region-level `solidFill` and `lnL|lnR|lnT|lnB` remain accepted.

When both are present, nested PowerPoint structures take precedence field-by-field. Invalid text booleans or colors omit only those fields. Duplicate style IDs remain first-definition-wins.

## SceneGraph Contract

Structured source colors remain available for editing and future export. SceneGraph adds concrete render-boundary fields instead of replacing source fields:

```ts
export interface SceneResolvedPaint {
  color?: ResolvedColor
}

export interface SceneResolvedTextStyle {
  color?: ResolvedColor
  bold?: boolean
  italic?: boolean
}
```

Shape fills and strokes, text run colors, table cell fills and borders, and table-style text defaults use the same `resolveColor` implementation. A SceneGraph build determines the slide's master, layout, theme, and effective color map once, then passes that context to element conversion. Unresolved colors remain `undefined`; source `Color`, `Fill`, and border objects are unchanged.

For table cells, the existing `resolvedStyle` remains the structured merged style. The scene cell also exposes resolved fill, four resolved border colors, and resolved table text defaults separately. Text-run formatting overrides table-style text defaults field-by-field before its color is resolved.

## Validation and Cloning

- Every new structure is plain JSON-safe data and survives `structuredClone`.
- Color transform arrays preserve order during cloning and document serialization.
- Validation reports exact nested paths for transform type/value errors, theme IDs, theme slots, color-map entries, and table text-style fields.
- Optional records and overrides may be absent or partial.
- Importer tolerance does not weaken explicit `validateDocument`; malformed imported fragments are omitted before model construction.

## Package Boundaries

- `@ppt4ai/model` owns structured color, theme, color-map, validation, table-style merging, and pure color resolution.
- `@ppt4ai/pptx-import` owns relationship traversal and tolerant OOXML parsing.
- `@ppt4ai/render` owns selection of effective slide theme context and concrete SceneGraph render values.
- No headless package imports Vue, DOM, Canvas, browser globals, Element Plus, or UnoCSS.
- The editor package receives SceneGraph values but gains no theme-editing UI in this slice.

## Testing

### Model

- Validate every supported source color and transform type.
- Reject out-of-range transform values and unknown theme/map/style fields with stable paths.
- Resolve direct RGB, preset, system fallback, scRGB, scheme/map, recursive theme colors, ordered luminance transforms, and ordered alpha transforms.
- Return `undefined` for missing themes, cycles, `phClr`, and unknown presets.
- Verify master/layout/slide color-map overlay helpers and clone safety.
- Verify table text style field-level precedence alongside fill and borders.

### PPTX Import

- Import a master-related theme whose filename is not `theme1.xml`.
- Import all supported color sources and ordered transforms.
- Import master `clrMap`, layout override, slide override, and `masterClrMapping` fallback.
- Import nested `tcStyle` fill/borders and `tcTxStyle` color/bold/italic.
- Preserve compatibility with direct table-style fixtures.
- Verify missing relationships, malformed theme XML, invalid map targets, and malformed style fragments do not remove readable slides or tables.

### Render

- Resolve the same scheme color consistently for a shape, text run, table fill, border, and table text style.
- Verify slide override wins over layout and master mappings.
- Verify explicit rich-text run formatting wins over table-style text defaults.
- Verify unresolved source colors remain structured while resolved values are absent.
- Verify the complete SceneGraph survives `structuredClone`.

## Acceptance Criteria

- A PPTX using a custom theme path imports a structured theme and links it to its master.
- Master, layout, and slide color mappings produce deterministic effective scheme colors.
- Supported DrawingML transforms resolve in XML order to stable RGB and alpha values.
- Real nested PowerPoint table styles import cell fill, four outer borders, text color, bold, and italic.
- Existing direct table-style fixtures continue to import.
- Table style region precedence remains unchanged and text properties merge field-by-field.
- SceneGraph exposes concrete resolved colors separately from structured source colors.
- Missing or malformed theme/style XML never prevents import of otherwise readable content.
- Focused package tests, boundary checks, repository tests, typechecking, builds, and `git diff --check` pass.
