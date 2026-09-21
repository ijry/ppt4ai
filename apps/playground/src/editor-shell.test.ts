import { describe, expect, it } from 'vitest'
import { locales } from '@ppt4ai/editor'

interface LocaleTree {
  [key: string]: string | LocaleTree
}

const flattenKeys = (tree: LocaleTree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string' ? [path] : flattenKeys(value, path)
  })

describe('localized editor shell', () => {
  it('keeps locale keys in exact parity', () => {
    expect(flattenKeys(locales['zh-CN'])).toEqual(flattenKeys(locales['en-US']))
  })

  it('exposes semantic editor labels without hash-like keys', () => {
    const keys = flattenKeys(locales['zh-CN'])

    expect(keys).toContain('editor.canvas.ariaLabel')
    expect(keys).toContain('toolbar.insert.shape')
    expect(keys.some((key) => /(^|\.)[a-f0-9]{8,}$/i.test(key))).toBe(false)
  })
})
