# Stage 7 Table Formatting Toolbar Design

## Goal

Add an accessible UnoCSS table formatting toolbar for selected table cells and extend the existing table editor controller so fill and border actions reach the current headless engine commands.

## Scope and boundaries

- `@ppt4ai/editor` owns the Vue toolbar, typed props/emits, and controller command adapter.
- `@ppt4ai/engine` remains the owner of selected-cell enumeration, validation, history, and document mutation.
- The toolbar depends only on Vue, vue-i18n, native form controls, and UnoCSS utilities.
- The slice does not add Element Plus, another UI framework, an icon package, a composed Vue host, table text editing, row/column operations, merge/split, or style inheritance changes.
- Deriving mixed fill and border values from an arbitrary multi-cell selection is deferred; the host supplies the current display state.

## Toolbar contract

`TableFormattingToolbar.vue` consumes typed props from `table-formatting-toolbar.ts`:

```ts
interface TableFormattingToolbarProps {
  active: boolean
  fillColor?: string
  borderColor?: string
  borderWidth: number
  borderStyle: 'solid' | 'dash' | 'dot'
  borderSides: readonly ('left' | 'right' | 'top' | 'bottom')[]
}
```

It emits model-safe payloads:

```ts
(event: 'set-fill', fill: Fill | null): void
(event: 'set-borders', borders: Partial<Record<TableBorderSide, TableBorder | null>>): void
```

The component normalizes HTML color values by removing `#` and uppercasing the six-digit sRGB value before emission.

## Controls and interaction

The toolbar renders one compact horizontal group consistent with the existing text formatting toolbar:

- a native color input for cell fill;
- a clear-fill button;
- four independent border-side toggle buttons;
- native selects for border width and `solid`, `dash`, or `dot` style;
- a native color input for border color;
- apply-border and clear-selected-borders buttons.

All interactive controls are disabled when `active` is false. Buttons expose descriptive localized `aria-label` values, side toggles expose `aria-pressed`, and keyboard focus receives a visible blue ring. Hover and focus styles use UnoCSS utilities without layout-changing transforms.

Applying borders emits one `TableBorder` for every currently enabled side. Clearing borders emits `null` for every enabled side. If no side is enabled, apply and clear emit nothing. The toolbar maintains no engine state and does not infer selection state.

## Controller extension

`TableEditorController` gains:

```ts
setFill(fill: Fill | null): EngineState
setBorders(borders: Partial<Record<TableBorderSide, TableBorder | null>>): EngineState
```

Both methods directly dispatch the existing `setTableCellFill` or `setTableCellBorders` command. The engine clones accepted model values, validates them, applies changes atomically to selected source cells, and owns undo/redo behavior. Engine errors propagate unchanged.

## Localization

English and Simplified Chinese locale files add semantic labels for fill color, clear fill, each border side, border color, width, style, apply, clear, and style names. Visible control text stays concise while screen-reader labels remain descriptive.

## Testing

Controller tests cover fill and border command mapping, multi-cell atomic history behavior, clearing explicit values, and propagated validation errors.

Vue tests cover disabled inactive state, semantic controls, side toggle state, normalized fill emission, selected-side border emission, clear emissions, and no emission when no border side is selected. Tests assert observable props, DOM, and emits rather than component internals.

All editor tests, package boundaries, full workspace tests, typecheck, build, and `git diff --check` remain required gates.

## Deferred work

- deriving mixed toolbar state from selected cells and resolved styles;
- a Vue host that composes overlay, controller, and toolbar;
- presets such as all/inside/outside borders and diagonal borders;
- theme-color palettes, transparency, advanced line styles, and custom width entry;
- table text editing, row/column operations, merge/split, and PPTX export.
