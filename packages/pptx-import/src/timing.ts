import type { AnimationBuild, AnimationClass, AnimationItem, AnimationTrigger, SlideTimeline } from '@ppt4ai/model'
import { attribute, child, localName, type XmlNode } from './xml'

/**
 * Parse a slide's `p:timing` tree into the model's animation timeline. This is a deliberately shallow
 * read of a deep OOXML structure: we recover, per animated element, the class/preset/timing that the
 * playback kernel needs, and keep `presetID`/`presetSubtype` verbatim for a future write-back. What we
 * do NOT reconstruct is the exact `p:cTn` nesting — each effect becomes its own one-item build with a
 * trigger, and simultaneity is expressed through `withPrev` rather than by grouping items into a build.
 */

/** Every descendant (pre-order, so document order) whose local name matches. */
function descendants(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = []
  for (const current of node.children) {
    if (localName(current.name) === name) out.push(current)
    out.push(...descendants(current, name))
  }
  return out
}

function intAttribute(node: XmlNode, name: string): number | undefined {
  const raw = attribute(node, name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

const ANIMATION_CLASSES = new Set<AnimationClass>(['entrance', 'exit', 'emphasis', 'motion'])

function isAnimationClass(value: string | undefined): value is AnimationClass {
  return value !== undefined && ANIMATION_CLASSES.has(value as AnimationClass)
}

/**
 * OOXML `presetID` → stable preset name, for the presets the playback kernel renders distinctly. The
 * numeric ids are PowerPoint's application-defined values (the OOXML spec leaves `presetID` open); these
 * are taken from LibreOffice's OOXML export mapping (`oox/source/ppt/commontimenodecontext.cxx`, its
 * `ooo-<class>-<name>` ↔ id table), which reverse-engineers PowerPoint. An id we do not name falls back
 * to `preset<id>` (the kernel then renders a plain fade); write-back always emits the verbatim `presetId`,
 * never the name, so a name is only ever a playback concern.
 */
const PRESET_NAMES: Partial<Record<AnimationClass, Record<number, string>>> = {
  entrance: { 1: 'appear', 2: 'fly', 10: 'fade', 23: 'zoom' },
  exit: { 1: 'disappear', 2: 'fly', 10: 'fade', 23: 'zoom' },
  emphasis: { 6: 'grow', 8: 'spin', 32: 'teeter' },
}

function presetName(cls: AnimationClass, presetId: number | undefined): string {
  if (presetId === undefined) return 'unknown'
  return PRESET_NAMES[cls]?.[presetId] ?? `preset${presetId}`
}

/** An effect node is a `p:cTn` carrying `presetClass` — the one that wraps `p:anim`/`p:set`/`p:animEffect`. */
function isEffect(node: XmlNode): boolean {
  return localName(node.name) === 'cTn' && attribute(node, 'presetClass') !== undefined
}

/** The effect's own start-condition delay in ms, or undefined for an indefinite (on-click) / absent start. */
function startDelayMs(effect: XmlNode): number | undefined {
  const cond = child(child(effect, 'stCondLst') ?? effect, 'cond')
  const raw = cond && attribute(cond, 'delay')
  if (raw === undefined || raw === 'indefinite') return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** Trigger from `nodeType` first (what real files carry), falling back to the start-condition delay. */
function effectTrigger(effect: XmlNode): AnimationTrigger {
  const nodeType = attribute(effect, 'nodeType')
  if (nodeType === 'clickEffect' || nodeType === 'clickPar') return 'onClick'
  if (nodeType === 'withEffect' || nodeType === 'withGroup') return 'withPrev'
  if (nodeType === 'afterEffect' || nodeType === 'afterGroup') return 'afterPrev'
  const cond = child(child(effect, 'stCondLst') ?? effect, 'cond')
  const delay = cond && attribute(cond, 'delay')
  if (delay === undefined || delay === 'indefinite') return 'onClick'
  return Number(delay) > 0 ? 'afterPrev' : 'withPrev'
}

/** The first finite behavior duration (`p:cBhvr/p:cTn/@dur`) under the effect, in ms. */
function effectDurationMs(effect: XmlNode): number | undefined {
  for (const behavior of descendants(effect, 'cBhvr')) {
    const timing = child(behavior, 'cTn')
    const dur = timing && attribute(timing, 'dur')
    if (dur !== undefined && dur !== 'indefinite') {
      const value = Number(dur)
      if (Number.isFinite(value)) return value
    }
  }
  return undefined
}

/** The shape this effect targets, as a raw drawingML spid (`p:cBhvr/p:tgtEl/p:spTgt/@spid`). */
function effectSpid(effect: XmlNode): string | undefined {
  const spTgt = descendants(effect, 'spTgt')[0]
  return spTgt ? attribute(spTgt, 'spid') : undefined
}

/** The shape whose click drives an interactive sequence, from the seq's condition lists. */
function sequenceTriggerSpid(seq: XmlNode): string | undefined {
  for (const listName of ['prevCondLst', 'nextCondLst', 'stCondLst']) {
    const list = child(seq, listName)
    const spTgt = list && descendants(list, 'spTgt')[0]
    const spid = spTgt && attribute(spTgt, 'spid')
    if (spid) return spid
  }
  return undefined
}

/** Resolve a raw spid to a model element id, or undefined if it does not map to an emitted element. */
type Resolve = (spid: string) => string | undefined

function buildFromEffect(effect: XmlNode, resolve: Resolve, triggerId: string | undefined): AnimationBuild | undefined {
  const cls = attribute(effect, 'presetClass')
  if (!isAnimationClass(cls)) return undefined
  const spid = effectSpid(effect)
  const targetId = spid ? resolve(spid) : undefined
  if (!targetId) return undefined
  const presetId = intAttribute(effect, 'presetID')
  const presetSubtype = intAttribute(effect, 'presetSubtype')
  const duration = effectDurationMs(effect)
  const delay = startDelayMs(effect)
  const item: AnimationItem = {
    targetId,
    class: cls,
    // Keep the authoritative numeric id verbatim; derive a best-effort stable name for playback.
    preset: presetName(cls, presetId),
    ...(presetId !== undefined ? { presetId } : {}),
    ...(presetSubtype !== undefined ? { presetSubtype } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(delay !== undefined ? { delay } : {}),
  }
  return {
    trigger: effectTrigger(effect),
    items: [item],
    ...(triggerId ? { triggerId } : {}),
  }
}

export function parseSlideTiming(slideXml: XmlNode, resolve: Resolve): SlideTimeline | undefined {
  const timing = descendants(slideXml, 'timing')[0]
  if (!timing) return undefined
  const mainSeq: AnimationBuild[] = []
  const interactiveSeq: AnimationBuild[] = []
  for (const seq of descendants(timing, 'seq')) {
    const nodeType = attribute(child(seq, 'cTn') ?? seq, 'nodeType')
    const interactive = nodeType === 'interactiveSeq'
    const triggerSpid = interactive ? sequenceTriggerSpid(seq) : undefined
    const triggerId = triggerSpid ? resolve(triggerSpid) : undefined
    for (const effect of descendants(seq, 'cTn')) {
      if (!isEffect(effect)) continue
      const build = buildFromEffect(effect, resolve, triggerId)
      if (build) (interactive ? interactiveSeq : mainSeq).push(build)
    }
  }
  if (mainSeq.length === 0 && interactiveSeq.length === 0) return undefined
  return { mainSeq, ...(interactiveSeq.length > 0 ? { interactiveSeq } : {}) }
}
