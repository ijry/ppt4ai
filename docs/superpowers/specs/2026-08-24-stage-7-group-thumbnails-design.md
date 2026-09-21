# Stage 7 Group Thumbnail Semantics Design

> **Status:** Approved for implementation
> **Date:** 2026-08-24

## Goal

Verify that nested groups render correctly in the existing Worker/OffscreenCanvas thumbnail pipeline without introducing a dedicated group painter, changing thumbnail pixels, or expanding the worker protocol.

## Context

`@ppt4ai/render` represents drawable slide content in the flat `SceneGraph.nodes` array. Optional `SceneGraph.groups` entries contain clone-safe interaction metadata only: group bounds, direct child IDs, ancestor IDs, and paint order. Group descendants are already emitted as transformed drawable leaf nodes in the same deterministic order used by the main canvas.

The thumbnail worker currently paints `scene.nodes` once in array order. A recursive group painter would traverse the same descendants again, duplicate pixels, complicate failure isolation, and risk diverging from the main canvas stacking order. Group outlines are editor chrome and must not appear in exported or thumbnail slide visuals.

## Rendering Contract

1. `scene.groups` remains non-drawable metadata and never produces Canvas operations.
2. Shape, text, table, and image descendants of any group are painted exactly once from `scene.nodes`.
3. Nested group membership does not reorder leaves; `SceneGraph.nodes` remains the only thumbnail paint-order source.
4. `drawnNodeIds`, `skippedNodeIds`, and issue `nodeId` values contain drawable leaf IDs only. Group IDs are not reported as drawn, skipped, or failed.
5. A malformed grouped leaf produces the existing node-scoped `draw-failed`, `missing-asset`, `resource-failed`, or `decode-failed` result without affecting later grouped or ungrouped leaves.
6. Group metadata never creates image resource requests. Grouped image leaves continue using the existing resource bridge, cache, cancellation, and decode paths.
7. The request, response, cancellation, and resource message schemas remain unchanged and continue to accept structured-clone-safe scenes.

## Implementation Scope

This slice adds focused worker and protocol tests around scenes containing outer and nested group metadata. The tests verify mixed drawable leaf ordering, leaf-only result IDs, grouped image resource behavior, failure isolation, and `structuredClone` compatibility.

No production code should change when the current worker already satisfies the contract. If a focused test exposes a real mismatch, the implementation must make the smallest leaf-oriented correction and must not add a group-specific Canvas painter or a new protocol field.

## Testing

Focused coverage will verify:

- nested group metadata with shape, text, table, and image leaves preserves `scene.nodes` paint order;
- group IDs do not appear in render results or issues;
- group metadata alone emits no Canvas operations or resource requests;
- a failing grouped leaf is isolated and later leaves still render;
- grouped image leaves request and reuse assets exactly like ungrouped image leaves;
- requests and results remain compatible with `structuredClone`;
- existing thumbnail worker, renderer, protocol, Vue host, typecheck, build, package boundaries, Element Plus scan, and diff checks remain green.

## Non-Goals

- Drawing group bounds, selection borders, breadcrumbs, labels, or editor chrome in thumbnails.
- Adding `drawnGroupIds`, group issues, or other thumbnail protocol fields.
- Replacing the flat SceneGraph paint order with recursive group traversal.
- Implementing chart thumbnails, group toolbar actions, rotation, snapping, proportional resize, or group-local persistence.

## Completion

The slice is complete when focused tests prove that grouped descendants already render with the same leaf ordering and failure semantics as ordinary nodes, all repository verification gates pass, and progress documentation no longer lists a dedicated group thumbnail painter as missing work.
