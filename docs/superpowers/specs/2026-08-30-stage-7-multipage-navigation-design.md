# Stage 7 Multi-page Navigation Design

> **Status**: design approved for implementation
>
> **Date**: 2026-08-30

## 1. Goal

Add the smallest useful multi-page editing workspace to the Playground. Users can inspect existing pages in a thumbnail list, switch the page shown by the main editor, and keep element edits, selection, and history isolated per page.

This slice is host-level page orchestration only. It does not change the single-document editing protocol in `@ppt4ai/engine` and does not add Element Plus or another runtime UI framework.

## 2. Existing boundary

`PlaygroundAssetHost` currently owns one `EditorEngine`; `App.vue` reads one `engineState` and converts its document to a SceneGraph. `Ppt4aiDocument` already contains `slides`, `slideOrder`, and per-slide `elementIds`, but the Playground creates and edits only one page. The red/blue pages in `thumbnail-smoke.ts` are an independent thumbnail protocol demo, not editor navigation.

The design preserves these facts:

- Engine remains responsible for one page's commands, selection, and undo/redo.
- A presentation host owns page order, active page, and routing across page engines.
- Asset adapter bytes are shared across pages; each page keeps metadata for the assets it references.
- Thumbnails continue using `ThumbnailCanvas` and the existing SceneGraph/worker protocol.

## 3. Architecture

Add `PlaygroundPresentationHost`, composed of page hosts and an active slide ID:

```text
App.vue
  `-- PlaygroundPresentationHost
       |-- slideOrder: string[]
       |-- activeSlideId: string
       |-- pages: Map<string, PlaygroundAssetHost>
       `-- shared AssetAdapter
```

Each page host keeps the existing asset-host operations. The presentation host forwards editing commands to the active page and returns a clone-safe snapshot containing the active page, page list, and each page snapshot. Pages do not share selection, history, or local preview state, so selection never migrates when moving from page A to page B.

`createPlaygroundAssetHost()` remains unchanged for existing tests and callers. The new multi-page entry point is an additional factory and interface. A shared adapter is injectable; the default still creates the existing in-memory adapter.

## 4. Data contract

```ts
export interface PlaygroundSlideSnapshot {
  id: string
  title: string
  thumbnailScene: SceneGraph
  engineState: EngineState
}

export interface PlaygroundPresentationSnapshot {
  slideOrder: string[]
  activeSlideId: string
  slides: Record<string, PlaygroundSlideSnapshot>
  selectedAssetId?: string
  status: PlaygroundAssetHostSnapshot['status']
}

export interface PlaygroundPresentationHost {
  adapter: AssetAdapter
  readonly snapOptions: SnapOptions
  getSnapshot(): PlaygroundPresentationSnapshot
  selectSlide(slideId: string): PlaygroundPresentationSnapshot
  selectElements(elementIds: string[]): PlaygroundPresentationSnapshot
  // Existing current-page editing commands are forwarded here.
}
```

`thumbnailScene` is generated from that page's document and contains only nodes reachable from that page's `slide.elementIds`. Clicking a thumbnail calls `selectSlide` only and never creates Engine history. An invalid page ID returns an error status while preserving the active page.

## 5. UI data flow

`App.vue` will:

1. Derive the active page snapshot, active page SceneGraph, and active page text bodies.
2. Render a left thumbnail list in exact `slideOrder` order.
3. Mark the active thumbnail with an active style and `aria-current="page"`; each button has stable `data-slide-id` and `data-testid` attributes.
4. Pass only the active page SceneGraph, active page selection, and forwarded edit callbacks to `PptEditor`.
5. Read the asset library and status panel from the active page, so assets, selection, and undo depth update immediately after switching.

Thumbnails use fixed aspect ratio and native focusable `button` elements styled only with existing UnoCSS utility classes. Thumbnail render failures use the existing result event and do not block page switching.

## 6. Initial pages

The Playground starts with two editable pages:

- `sld_playground`: the current demo page and red image remain available.
- `sld_playground_blue`: independent element IDs and blue image content provide coverage for page selection, editing, and history isolation.

The initial document data must keep valid `slideOrder`, `slides`, and `elements` relationships. Shared image resources may be referenced by both pages, while insert/replace commands still modify only the active page engine document and history.

## 7. Interaction rules

- The initial page is `slideOrder[0]`.
- Clicking the already active thumbnail is a no-op and does not increase undo depth.
- Switching pages does not migrate selection; the target page restores its own selection, initially empty.
- Edits affect only the active page; switching back shows the previous page's edits.
- Existing move, resize, rotate, flip, text, asset insert, and asset replace commands continue through the current host.
- Invalid page IDs preserve the active page and expose a localizable error message.

## 8. Testing strategy

Write failing tests before implementation:

- `presentation-host.test.ts`: initial page and order; switching does not create history; invalid IDs preserve the active page; selection/history are isolated; edits survive a round trip; thumbnail scenes contain only page nodes.
- `App.test.ts`: two thumbnails render; clicking the blue page updates active state and `aria-current`; the editor and status panel switch to the blue page; a red-page edit and selection survive switching away and back.
- Run focused Playground source tests, then the full source test suite, boundaries, typecheck, and production build.

## 9. Non-goals

This slice does not include:

- Adding, deleting, duplicating, reordering, or dragging pages.
- A merged multi-page undo/redo stack or cross-page transaction.
- Cross-page copy/paste or element dragging.
- Page background/theme editing.
- Chart thumbnails or a new thumbnail worker protocol.
- PPTX package page insertion/deletion/reordering writeback.

## 10. Risks and mitigations

- **Reference leakage**: clone snapshots before exposing presentation state to Vue; Vue never mutates an Engine.
- **Thumbnail mismatch**: derive each thumbnail from the same page engine state used by the editor instead of maintaining a separate red/blue demo state.
- **Asset scope mismatch**: share adapter bytes but source AssetLibrary metadata from the active page document.
- **Compatibility regression**: preserve `createPlaygroundAssetHost` and its public methods; do not change Engine or editor package APIs.
