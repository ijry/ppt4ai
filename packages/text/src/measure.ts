import type { TextMarks } from '@ppt4ai/model'

export const DEFAULT_FONT_SIZE = 18
export const DEFAULT_FONT_FAMILY = 'Arial'
const EMU_PER_POINT = 12700
const DEFAULT_FONT_SCALE = 100000

function isCjkOrFullWidth(codePoint: number): boolean {
  return (codePoint >= 0x1100 && codePoint <= 0x11ff)
    || (codePoint >= 0x2e80 && codePoint <= 0x9fff)
    || (codePoint >= 0xac00 && codePoint <= 0xd7af)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xff01 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
}

function characterFactor(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0
  if (codePoint > 0xffff || isCjkOrFullWidth(codePoint)) return 1
  if (character === ' ') return 0.28
  if (codePoint >= 0x41 && codePoint <= 0x5a) return 0.62
  if (codePoint >= 0x61 && codePoint <= 0x7a) return 0.54
  if (codePoint >= 0x30 && codePoint <= 0x39) return 0.62
  if (codePoint <= 0x7f && /[^\w\s]/u.test(character)) return 0.38
  return 0.6
}

export function measureText(text: string, marks?: TextMarks, fontScale = DEFAULT_FONT_SCALE): number {
  const fontSize = marks?.fontSize ?? DEFAULT_FONT_SIZE
  const emuPerEm = fontSize * EMU_PER_POINT * fontScale / DEFAULT_FONT_SCALE
  return [...text].reduce((width, character) => width + Math.round(emuPerEm * characterFactor(character)), 0)
}
