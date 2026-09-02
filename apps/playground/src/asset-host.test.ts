import { describe, expect, it } from 'vitest'
import type { AssetAdapter } from '@ppt4ai/model'
import { documentToSceneGraph } from '@ppt4ai/render'
import { createPlaygroundAssetHost } from './asset-host'

const uploadPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 3, 0, 0, 0, 4, 8, 6, 0, 0, 0, 0, 0, 0, 0,
])

describe('createPlaygroundAssetHost', () => {
  it('accepts an injected adapter and document for isolated page hosts', async () => {
    const sourceDocument = createPlaygroundAssetHost().getSnapshot().engineState.document
    const document = structuredClone(sourceDocument)
    document.id = 'dck_injected'
    document.slides.sld_playground!.elementIds = []
    const stored = new Uint8Array([1, 2, 3])
    const adapter: AssetAdapter = {
      async get(assetId) {
        return assetId === 'asset_injected' ? stored.slice() : undefined
      },
      async put() {},
    }

    const host = createPlaygroundAssetHost({ document, adapter })

    expect(host.getSnapshot().engineState.document.id).toBe('dck_injected')
    expect(host.getSnapshot().engineState.document.slides.sld_playground?.elementIds).toEqual([])
    expect(await host.adapter.get('asset_injected')).toEqual(stored)
  })

  it('seeds clone-isolated assets and returns clone-safe snapshots', async () => {
    const host = createPlaygroundAssetHost()
    const snapshot = host.getSnapshot()
    const firstBytes = await host.adapter.get('asset_red')

    expect(Object.keys(snapshot.engineState.document.assets ?? {})).toEqual(['asset_red', 'asset_blue'])
    expect(snapshot.engineState.document.slides.sld_playground?.elementIds).toEqual(['group_demo', 'table_demo'])
    expect(Object.keys(snapshot.engineState.document.elements)).toEqual(['shape_demo', 'text_demo', 'group_demo', 'table_demo'])
    expect(firstBytes).toBeInstanceOf(Uint8Array)

    snapshot.engineState.document.assets!.asset_red!.originalFilename = 'mutated.png'
    firstBytes![0] = 0
    expect(host.getSnapshot().engineState.document.assets!.asset_red!.originalFilename).toBe('red.png')
    expect((await host.adapter.get('asset_red'))![0]).toBe(0x89)
  })

  it('selects a seeded element without adding an undo entry', () => {
    const host = createPlaygroundAssetHost()

    const selected = host.selectElement('text_demo')

    expect(selected.engineState.selection).toEqual(['text_demo'])
    expect(selected.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
  })

  it('moves the full controlled selection without collapsing it to the dragged member', () => {
    const host = createPlaygroundAssetHost()
    const selected = host.selectElements(['group_demo', 'table_demo'])

    expect(selected.engineState.selection).toEqual(['group_demo', 'table_demo'])
    expect(selected.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })

    const moved = host.moveSelected('group_demo', 914400, 0)
    expect(moved.engineState.selection).toEqual(['group_demo', 'table_demo'])
    expect(moved.engineState.document.elements.group_demo?.bounds.x).toBe(1828800)
    expect(moved.engineState.document.elements.table_demo?.bounds.x).toBe(1828800)
    expect(moved.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })
  })

  it('replaces selection only when dragging an unselected element', () => {
    const host = createPlaygroundAssetHost()
    host.selectElements(['group_demo'])

    const moved = host.moveSelected('table_demo', 914400, 0)

    expect(moved.engineState.selection).toEqual(['table_demo'])
    expect(moved.engineState.document.elements.group_demo?.bounds.x).toBe(914400)
    expect(moved.engineState.document.elements.table_demo?.bounds.x).toBe(1828800)
    expect(moved.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })
  })

  it('groups and ungroups the current top-level selection as atomic commands', () => {
    const host = createPlaygroundAssetHost()
    host.selectElements(['group_demo', 'table_demo'])

    const grouped = host.groupSelected()
    expect(grouped.engineState.selection).toHaveLength(1)
    const groupId = grouped.engineState.selection[0]!
    expect(grouped.engineState.document.elements[groupId]).toMatchObject({
      kind: 'group',
      childIds: ['group_demo', 'table_demo'],
    })
    expect(grouped.engineState.document.slides.sld_playground?.elementIds).toEqual([groupId])
    expect(grouped.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })

    const ungrouped = host.ungroupSelected(groupId)
    expect(ungrouped.engineState.selection).toEqual(['group_demo', 'table_demo'])
    expect(ungrouped.engineState.document.elements[groupId]).toBeUndefined()
    expect(ungrouped.engineState.document.slides.sld_playground?.elementIds).toEqual(['group_demo', 'table_demo'])
    expect(ungrouped.engineState.history).toEqual({ undoDepth: 2, redoDepth: 0 })
  })

  it('resizes selected roots atomically and preserves selection order', () => {
    const host = createPlaygroundAssetHost()
    const result = host.resizeSelected(
      ['group_demo', 'table_demo'],
      { x: 914400, y: 685800, w: 5486400, h: 5943600 },
    )

    expect(result.engineState.selection).toEqual(['group_demo', 'table_demo'])
    expect(result.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })
    expect(result.engineState.document.elements.group_demo?.bounds.w).toBe(5486400)
    expect(result.engineState.document.elements.table_demo?.bounds.w).toBe(5486400)
    expect(result.engineState.document.elements.shape_demo?.bounds.w).toBe(5486400)
    expect(structuredClone(result)).toEqual(result)
  })

  it('moves and resizes the selected seeded element as undoable commands', () => {
    const host = createPlaygroundAssetHost()
    host.selectElement('text_demo')

    const moved = host.moveSelected('text_demo', 914400, 0)
    expect(moved.engineState.document.elements.text_demo?.bounds.x).toBe(1828800)
    expect(moved.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })

    const resized = host.resizeElement('text_demo', { x: 1828800, y: 914400, w: 3657600, h: 914400 })
    expect(resized.engineState.document.elements.text_demo?.bounds).toEqual({ x: 1828800, y: 914400, w: 3657600, h: 914400 })
    expect(resized.engineState.history).toEqual({ undoDepth: 2, redoDepth: 0 })
  })

  it('moves and resizes the seeded demo group with all descendants', () => {
    const host = createPlaygroundAssetHost()
    const selected = host.selectElement('group_demo')

    expect(selected.engineState.selection).toEqual(['group_demo'])
    const moved = host.moveSelected('group_demo', 914400, 0)
    expect(moved.engineState.document.elements.group_demo?.bounds.x).toBe(1828800)
    expect(moved.engineState.document.elements.shape_demo?.bounds.x).toBe(1828800)
    expect(moved.engineState.document.elements.text_demo?.bounds.x).toBe(1828800)
    expect(moved.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })

    const resized = host.resizeElement('group_demo', { x: 1828800, y: 914400, w: 5486400, h: 1828800 })
    expect(resized.engineState.document.elements.group_demo?.bounds).toEqual({ x: 1828800, y: 914400, w: 5486400, h: 1828800 })
    expect(resized.engineState.history).toEqual({ undoDepth: 2, redoDepth: 0 })
  })

  it('updates a text element in one clone-safe undoable command', () => {
    const host = createPlaygroundAssetHost()
    const body = { paragraphs: [{ runs: [{ text: 'Edited in place', marks: { bold: true } }] }] }

    const updated = host.updateTextElement('text_demo', body)

    expect(updated.engineState.document.elements.text_demo).toMatchObject({ kind: 'text', body })
    expect(updated.engineState.selection).toEqual(['text_demo'])
    expect(updated.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })
    expect(structuredClone(updated)).toEqual(updated)
  })

  it('inserts and replaces existing asset references without writing adapter bytes', () => {
    const host = createPlaygroundAssetHost()
    let putCalls = 0
    const adapter = host.adapter
    const originalPut = adapter.put
    adapter.put = async (...args) => {
      putCalls += 1
      await originalPut(...args)
    }

    const inserted = host.insertAsset('asset_red')
    expect(inserted.engineState.selection).toEqual(['image_1'])
    expect(inserted.engineState.document.elements.image_1).toMatchObject({ kind: 'image', assetId: 'asset_red' })
    expect(inserted.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })

    host.selectAsset('asset_blue')
    const replaced = host.replaceSelectedImage('asset_blue')
    expect(replaced.engineState.document.elements.image_1).toMatchObject({ kind: 'image', assetId: 'asset_blue' })
    expect(replaced.engineState.history).toEqual({ undoDepth: 2, redoDepth: 0 })
    expect(putCalls).toBe(0)
  })

  it('rotates and flips an inserted image through one engine command each', () => {
    const host = createPlaygroundAssetHost()
    const inserted = host.insertAsset('asset_red')
    const imageId = inserted.engineState.selection[0]!

    const rotated = host.rotateSelectedImage(imageId, 5400000)
    expect(rotated.engineState.document.elements[imageId]).toMatchObject({ transform: { rotation: 5400000 } })
    expect(rotated.engineState.history.undoDepth).toBe(inserted.engineState.history.undoDepth + 1)
    expect(rotated.engineState.selection).toEqual([imageId])

    const flipped = host.toggleSelectedImageFlip(imageId, 'horizontal')
    expect(flipped.engineState.document.elements[imageId]).toMatchObject({ transform: { rotation: 5400000, flipH: true } })
    expect(flipped.engineState.history.undoDepth).toBe(rotated.engineState.history.undoDepth + 1)
    expect(flipped.status).toEqual({ kind: 'success', message: 'image-flipped' })
  })

  it('reports image transform failures without changing document or history', () => {
    const host = createPlaygroundAssetHost()
    const beforeMissing = host.getSnapshot()
    const missing = host.rotateSelectedImage('missing', 5400000)
    expect(missing.status).toEqual({ kind: 'error', message: 'element-operation-failed' })
    expect(missing.engineState.document).toEqual(beforeMissing.engineState.document)
    expect(missing.engineState.history).toEqual(beforeMissing.engineState.history)

    const beforeShape = host.getSnapshot()
    const shape = host.rotateSelectedImage('group_demo', 5400000)
    expect(shape.status).toEqual({ kind: 'error', message: 'element-operation-failed' })
    expect(shape.engineState.document).toEqual(beforeShape.engineState.document)
    expect(shape.engineState.history).toEqual(beforeShape.engineState.history)

    const inserted = host.insertAsset('asset_red')
    const imageId = inserted.engineState.selection[0]!
    const beforeInvalid = host.getSnapshot()
    const invalid = host.rotateSelectedImage(imageId, 1.5)
    expect(invalid.status).toEqual({ kind: 'error', message: 'element-operation-failed' })
    expect(invalid.engineState.document).toEqual(beforeInvalid.engineState.document)
    expect(invalid.engineState.history).toEqual(beforeInvalid.engineState.history)
  })

  it('rotates a shape and a text element through one engine command each', () => {
    const host = createPlaygroundAssetHost()
    const before = host.getSnapshot()

    const shape = host.rotateSelectedElement('shape_demo', 2700000)
    expect(shape.status).toEqual({ kind: 'success', message: 'element-rotated' })
    expect(shape.engineState.document.elements.shape_demo).toMatchObject({ rotation: 2700000 })
    expect(shape.engineState.history.undoDepth).toBe(before.engineState.history.undoDepth + 1)

    const text = host.rotateSelectedElement('text_demo', 900000)
    expect(text.engineState.document.elements.text_demo).toMatchObject({ rotation: 900000 })
    expect(text.engineState.history.undoDepth).toBe(shape.engineState.history.undoDepth + 1)

    const cleared = host.rotateSelectedElement('shape_demo', 0)
    expect(cleared.engineState.document.elements.shape_demo).not.toHaveProperty('rotation')
  })

  it('rotates a table through the same command, so the host does not gate the new kind', () => {
    const host = createPlaygroundAssetHost()
    const before = host.getSnapshot()

    const table = host.rotateSelectedElement('table_demo', 1800000)

    expect(table.status).toEqual({ kind: 'success', message: 'element-rotated' })
    expect(table.engineState.document.elements.table_demo).toMatchObject({ rotation: 1800000 })
    expect(table.engineState.history.undoDepth).toBe(before.engineState.history.undoDepth + 1)
  })

  it('rotates a group through the same command, cascading to descendants at render time', () => {
    const host = createPlaygroundAssetHost()
    const before = host.getSnapshot()

    const group = host.rotateSelectedElement('group_demo', 900000)

    expect(group.status).toEqual({ kind: 'success', message: 'element-rotated' })
    expect(group.engineState.document.elements.group_demo).toMatchObject({ rotation: 900000 })
    expect(group.engineState.history.undoDepth).toBe(before.engineState.history.undoDepth + 1)
    expect(group.engineState.document.elements.shape_demo).toEqual(before.engineState.document.elements.shape_demo)
  })

  it('rotates a whole selection about its union centre in one history entry', () => {
    const host = createPlaygroundAssetHost()
    host.selectElements(['group_demo', 'table_demo'])
    const before = host.getSnapshot()

    const rotated = host.rotateSelection(5400000)

    expect(rotated.status).toEqual({ kind: 'success', message: 'element-rotated' })
    expect(rotated.engineState.history.undoDepth).toBe(before.engineState.history.undoDepth + 1)
    expect(rotated.engineState.document.elements.group_demo).toMatchObject({ rotation: 5400000 })
    expect(rotated.engineState.document.elements.table_demo).toMatchObject({ rotation: 5400000 })
    // Both centres moved, so neither element kept its original box.
    expect(rotated.engineState.document.elements.group_demo?.bounds).not.toEqual(before.engineState.document.elements.group_demo?.bounds)
  })

  it('reports a selection rotation failure without changing document or history', () => {
    const host = createPlaygroundAssetHost()
    host.selectElements(['group_demo'])
    const before = host.getSnapshot()

    const result = host.rotateSelection(1.5)

    expect(result.status).toEqual({ kind: 'error', message: 'element-operation-failed' })
    expect(result.engineState.document).toEqual(before.engineState.document)
    expect(result.engineState.history).toEqual(before.engineState.history)
  })

  it('flips a shape, text, table and group through one engine command each', () => {
    const host = createPlaygroundAssetHost()
    const before = host.getSnapshot()

    const shape = host.toggleSelectedElementFlip('shape_demo', 'horizontal')
    expect(shape.status).toEqual({ kind: 'success', message: 'element-flipped' })
    expect(shape.engineState.document.elements.shape_demo).toMatchObject({ flipH: true })
    expect(shape.engineState.history.undoDepth).toBe(before.engineState.history.undoDepth + 1)

    expect(host.toggleSelectedElementFlip('text_demo', 'vertical').engineState.document.elements.text_demo).toMatchObject({ flipV: true })
    expect(host.toggleSelectedElementFlip('table_demo', 'horizontal').engineState.document.elements.table_demo).toMatchObject({ flipH: true })
    expect(host.toggleSelectedElementFlip('group_demo', 'vertical').engineState.document.elements.group_demo).toMatchObject({ flipV: true })

    const cleared = host.toggleSelectedElementFlip('shape_demo', 'horizontal')
    expect(cleared.engineState.document.elements.shape_demo).not.toHaveProperty('flipH')
  })

  it('reports a flip failure without changing document or history', () => {
    const host = createPlaygroundAssetHost()
    const before = host.getSnapshot()

    const missing = host.toggleSelectedElementFlip('missing', 'horizontal')
    expect(missing.status).toEqual({ kind: 'error', message: 'element-operation-failed' })
    expect(missing.engineState.document).toEqual(before.engineState.document)
    expect(missing.engineState.history).toEqual(before.engineState.history)

    // Images go through toggleSelectedImageFlip, so the element path rejects them.
    const inserted = host.insertAsset('asset_red')
    const imageId = inserted.engineState.selection[0]!
    const beforeImage = host.getSnapshot()
    const image = host.toggleSelectedElementFlip(imageId, 'horizontal')
    expect(image.status).toEqual({ kind: 'error', message: 'element-operation-failed' })
    expect(image.engineState.document).toEqual(beforeImage.engineState.document)
  })

  it('flips a whole selection in one history entry, each element about its own centre', () => {
    const host = createPlaygroundAssetHost()
    host.selectElements(['group_demo', 'table_demo'])
    const before = host.getSnapshot()

    const flipped = host.flipSelection('horizontal')

    expect(flipped.status).toEqual({ kind: 'success', message: 'element-flipped' })
    expect(flipped.engineState.history.undoDepth).toBe(before.engineState.history.undoDepth + 1)
    expect(flipped.engineState.document.elements.group_demo).toMatchObject({ flipH: true })
    expect(flipped.engineState.document.elements.table_demo).toMatchObject({ flipH: true })
    // Unlike rotateSelection, no bounds move: a flip is not a rearrangement.
    expect(flipped.engineState.document.elements.table_demo?.bounds).toEqual(before.engineState.document.elements.table_demo?.bounds)
  })

  it('reports a selection flip failure without changing document or history', () => {
    const host = createPlaygroundAssetHost()
    host.selectElements(['group_demo'])
    const before = host.getSnapshot()

    const result = host.flipSelection('diagonal' as never)

    expect(result.status).toEqual({ kind: 'error', message: 'element-operation-failed' })
    expect(result.engineState.document).toEqual(before.engineState.document)
    expect(result.engineState.history).toEqual(before.engineState.history)
  })

  it('reports element rotation failures without changing document or history', () => {
    const host = createPlaygroundAssetHost()
    const imageId = host.insertAsset('asset_red').engineState.selection[0]!

    for (const elementId of ['missing', imageId]) {
      const before = host.getSnapshot()
      const result = host.rotateSelectedElement(elementId, 900000)
      expect(result.status).toEqual({ kind: 'error', message: 'element-operation-failed' })
      expect(result.engineState.document).toEqual(before.engineState.document)
      expect(result.engineState.history).toEqual(before.engineState.history)
    }

    const beforeInvalid = host.getSnapshot()
    const invalid = host.rotateSelectedElement('shape_demo', 1.5)
    expect(invalid.status).toEqual({ kind: 'error', message: 'element-operation-failed' })
    expect(invalid.engineState.document).toEqual(beforeInvalid.engineState.document)
    expect(invalid.engineState.history).toEqual(beforeInvalid.engineState.history)
  })

  it('reports missing assets and missing image targets without changing history', () => {
    const host = createPlaygroundAssetHost()
    const missingAsset = host.insertAsset('asset_missing')
    expect(missingAsset.status.kind).toBe('error')
    expect(missingAsset.status.message).toBe('asset-missing')
    expect(missingAsset.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })

    const missingTarget = host.replaceSelectedImage('asset_blue')
    expect(missingTarget.status.kind).toBe('error')
    expect(missingTarget.status.message).toBe('image-target-required')
    expect(missingTarget.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
  })

  it('uploads a valid bitmap, stores exact bytes, and inserts a deterministic image reference', async () => {
    const host = createPlaygroundAssetHost()

    const result = await host.uploadAndInsert({
      data: uploadPng,
      mimeType: 'image/png',
      originalFilename: 'uploaded.png',
    })

    expect(result.status).toEqual({ kind: 'success', message: 'asset-uploaded' })
    expect(result.selectedAssetId).toBe('asset_upload_1')
    expect(result.engineState.selection).toEqual(['image_1'])
    expect(result.engineState.document.elements.image_1).toMatchObject({
      kind: 'image',
      assetId: 'asset_upload_1',
    })
    expect(result.engineState.document.assets?.asset_upload_1).toMatchObject({
      id: 'asset_upload_1',
      mimeType: 'image/png',
      pixelWidth: 3,
      pixelHeight: 4,
      originalFilename: 'uploaded.png',
    })
    expect(await host.adapter.get('asset_upload_1')).toEqual(uploadPng)
    expect(result.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })
  })

  it('uploads a second bitmap to replace the selected image and preserves old adapter bytes', async () => {
    const host = createPlaygroundAssetHost()
    await host.uploadAndInsert({ data: uploadPng, mimeType: 'image/png', originalFilename: 'one.png' })
    const replacement = new Uint8Array(uploadPng)
    replacement[35] = 7

    const result = await host.uploadAndReplace({ data: replacement, mimeType: 'image/png', originalFilename: 'two.png' })

    expect(result.status.message).toBe('asset-upload-replaced')
    expect(result.selectedAssetId).toBe('asset_upload_2')
    expect(result.engineState.document.elements.image_1).toMatchObject({ assetId: 'asset_upload_2' })
    expect(result.engineState.document.assets?.asset_upload_1).toBeUndefined()
    expect(await host.adapter.get('asset_upload_1')).toEqual(uploadPng)
    expect(await host.adapter.get('asset_upload_2')).toEqual(replacement)
    expect(result.engineState.history).toEqual({ undoDepth: 2, redoDepth: 0 })
  })

  it('rejects invalid upload bytes without writing, advancing IDs, or changing history', async () => {
    const host = createPlaygroundAssetHost()

    const invalid = await host.uploadAndInsert({ data: new Uint8Array([1, 2, 3]), originalFilename: 'bad.png' })

    expect(invalid.status).toEqual({ kind: 'error', message: 'image-upload-invalid' })
    expect(invalid.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(invalid.engineState.document.assets?.asset_upload_1).toBeUndefined()
    const valid = await host.uploadAndInsert({ data: uploadPng, mimeType: 'image/png', originalFilename: 'good.png' })
    expect(valid.selectedAssetId).toBe('asset_upload_1')
  })

  it('rejects upload replacement without an image target', async () => {
    const host = createPlaygroundAssetHost()

    const result = await host.uploadAndReplace({ data: uploadPng, mimeType: 'image/png', originalFilename: 'replacement.png' })

    expect(result.status).toEqual({ kind: 'error', message: 'image-target-required' })
    expect(result.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(result.engineState.document.assets?.asset_upload_1).toBeUndefined()
  })

  it('hides adapter and engine failures behind a stable upload status', async () => {
    const host = createPlaygroundAssetHost()
    host.adapter.put = async () => { throw new Error('secret adapter failure') }

    const result = await host.uploadAndInsert({ data: uploadPng, mimeType: 'image/png', originalFilename: 'failed.png' })

    expect(result.status).toEqual({ kind: 'error', message: 'image-upload-failed' })
    expect(result.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(result.status.message).not.toContain('secret')
  })

  it('seeds a master, layout, and theme with scheme-coloured demo elements', () => {
    const document = createPlaygroundAssetHost().getSnapshot().engineState.document

    expect(document.themes?.thm_playground).toEqual({ id: 'thm_playground', colors: {} })
    expect(document.masters?.mst_playground).toMatchObject({ id: 'mst_playground', themeId: 'thm_playground' })
    expect(document.layouts?.lay_playground).toMatchObject({ id: 'lay_playground', masterId: 'mst_playground' })
    expect(document.slides.sld_playground?.layoutId).toBe('lay_playground')

    const shape = document.elements.shape_demo
    expect(shape?.kind === 'shape' && shape.fill?.color).toEqual({ type: 'scheme', v: 'accent1' })
  })

  it('resolves seeded scheme colors through the theme so edits are visible', () => {
    const host = createPlaygroundAssetHost()

    const before = documentToSceneGraph(host.getSnapshot().engineState.document)
    const after = documentToSceneGraph(host.setThemeColor('thm_playground', 'accent1', { type: 'srgb', v: 'FF0000' }).engineState.document)

    expect(JSON.stringify(before)).not.toEqual(JSON.stringify(after))
    expect(JSON.stringify(after)).toContain('FF0000')
  })

  it('writes and resets theme colors through engine history', () => {
    const host = createPlaygroundAssetHost()

    const edited = host.setThemeColor('thm_playground', 'accent1', { type: 'srgb', v: '123456' })
    expect(edited.engineState.document.themes?.thm_playground?.colors.accent1).toEqual({ type: 'srgb', v: '123456' })
    expect(edited.engineState.history.undoDepth).toBe(1)

    const reset = host.setThemeColor('thm_playground', 'accent1', null)
    expect(reset.engineState.document.themes?.thm_playground?.colors.accent1).toBeNull()

    expect(host.undo().engineState.document.themes?.thm_playground?.colors.accent1).toEqual({ type: 'srgb', v: '123456' })
  })

  it('reports a stable error status when the theme is missing', () => {
    const host = createPlaygroundAssetHost()

    const result = host.setThemeColor('thm_absent', 'accent1', null)

    expect(result.status).toEqual({ kind: 'error', message: 'theme-missing' })
    expect(result.engineState.history.undoDepth).toBe(0)
  })
})
