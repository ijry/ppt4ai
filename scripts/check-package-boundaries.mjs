import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const packageNames = ['model', 'geometry', 'layout', 'text', 'render', 'charts', 'animate', 'pptx-import', 'pptx-export', 'engine', 'editor', 'player']
const headlessPackages = packageNames.filter((name) => name !== 'editor')
const readJson = (path) => readFile(path, 'utf8').then(JSON.parse)
const dependenciesOf = (manifest) => ({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies })
const failures = []
const manifests = new Map()

for (const name of packageNames) {
  try {
    const manifest = await readJson(resolve(root, 'packages', name, 'package.json'))
    manifests.set(name, manifest)
    if (manifest.name !== `@ppt4ai/${name}`) failures.push(`${name}: manifest name must be @ppt4ai/${name}`)
  } catch {
    failures.push(`${name}: missing package.json`)
  }
}

for (const name of headlessPackages) {
  const dependencies = manifests.has(name) ? dependenciesOf(manifests.get(name)) : {}
  for (const dependency of ['vue', '@vue/runtime-dom']) {
    if (dependency in dependencies) failures.push(`${name}: headless package cannot depend on ${dependency}`)
  }
}

const internalDependencies = (name) => Object.keys(dependenciesOf(manifests.get(name) ?? {})).filter((dependency) => dependency.startsWith('@ppt4ai/'))
if (internalDependencies('engine').includes('@ppt4ai/editor')) failures.push('engine -> editor is forbidden')
if (internalDependencies('player').includes('@ppt4ai/editor')) failures.push('player -> editor is forbidden')
if (!internalDependencies('editor').includes('@ppt4ai/engine')) failures.push('editor must depend on engine')

for (const name of headlessPackages) {
  let files = []
  try { files = await readdir(resolve(root, 'packages', name, 'src'), { recursive: true }) } catch { continue }
  for (const relativePath of files.filter((file) => file.endsWith('.ts'))) {
    if (name === 'text' && relativePath.replaceAll('\\', '/').startsWith('ime/')) continue
    const source = await readFile(resolve(root, 'packages', name, 'src', relativePath), 'utf8')
    if (/from\s+['"]vue['"]|from\s+['"]@vue\/runtime-dom['"]/.test(source)) failures.push(`${name}/${relativePath}: Vue import in headless source`)
    if (/\b(document|window|HTMLElement|HTMLCanvasElement)\b/.test(source)) failures.push(`${name}/${relativePath}: DOM global in headless source`)
  }
}

if (failures.length) {
  console.error(['Package boundary violations:', ...failures.map((failure) => `- ${failure}`)].join('\n'))
  process.exitCode = 1
} else {
  console.log(`Package boundaries OK (${packageNames.length} packages)`)
}
