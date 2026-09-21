import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageNames = [
  'model',
  'geometry',
  'layout',
  'text',
  'render',
  'charts',
  'animate',
  'pptx-import',
  'pptx-export',
  'engine',
  'editor',
  'player',
] as const

type PackageManifest = {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const manifestPath = (packageName: string) =>
  resolve(process.cwd(), 'packages', packageName, 'package.json')

const readManifest = async (packageName: string) =>
  JSON.parse(await readFile(manifestPath(packageName), 'utf8')) as PackageManifest

const allDependencies = (manifest: PackageManifest) => ({
  ...manifest.dependencies,
  ...manifest.devDependencies,
  ...manifest.peerDependencies,
})

describe('workspace package boundaries', () => {
  it('defines all planned package manifests', async () => {
    const manifests = await Promise.all(
      packageNames.map(async (packageName) => [packageName, await readManifest(packageName)] as const),
    )

    expect(manifests.map(([, manifest]) => manifest.name)).toEqual(
      packageNames.map((packageName) => `@ppt4ai/${packageName}`),
    )
  })

  it('keeps headless packages free of Vue and DOM dependencies', async () => {
    const headlessPackages = packageNames.filter((packageName) => packageName !== 'editor')
    const manifests = await Promise.all(headlessPackages.map(readManifest))

    for (const manifest of manifests) {
      const dependencies = Object.keys(allDependencies(manifest))
      expect(dependencies).not.toContain('vue')
      expect(dependencies).not.toContain('@vue/runtime-dom')
    }
  })

  it('allows editor to consume engine but never the reverse', async () => {
    const engine = await readManifest('engine')
    const editor = await readManifest('editor')

    expect(Object.keys(allDependencies(editor))).toContain('@ppt4ai/engine')
    expect(Object.keys(allDependencies(engine))).not.toContain('@ppt4ai/editor')
  })

  it('keeps player independent from editor', async () => {
    const player = await readManifest('player')

    expect(Object.keys(allDependencies(player))).not.toContain('@ppt4ai/editor')
  })
})
