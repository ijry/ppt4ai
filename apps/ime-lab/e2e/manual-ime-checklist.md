# Windows Chinese IME Manual Checklist

## Purpose

Confirm behavior that headless Chromium cannot prove: the native Windows Chinese IME candidate window follows the Canvas-rendered caret while composition remains active.

## Setup

1. Run `pnpm dev:ime` from the repository root.
2. Open `http://127.0.0.1:4173` in the browser under test.
3. Enable Microsoft Pinyin or another named Windows Chinese IME and record its name/version.
4. Click the Canvas before each scenario so the hidden contenteditable receives focus.
5. Record browser version, Windows build, display scale, browser zoom, and evidence paths.

Use DevTools Console to place or move the Canvas caret:

- Upper-left: `window.__IME_LAB__.setCaretOrigin({ x: 50, y: 80 })`
- Center: `window.__IME_LAB__.setCaretOrigin({ x: 320, y: 240 })`
- Lower-right: `window.__IME_LAB__.setCaretOrigin({ x: 760, y: 440 })`

## Required Scenarios

Run every row in both latest Chrome and latest Edge. Test browser zoom at 80%, 100%, and 125%. Run display scale at 100% and 150% when the display environment supports changing scale safely.

| Check | Steps | Expected Result | Result |
|---|---|---|---|
| Left caret composition | Set the caret near the upper-left, type `zhongwen` without committing | `zhongwen` updates visibly on Canvas; native candidate window is adjacent to the Canvas caret | PASS |
| Center caret composition | Move the caret near the center, type `zhongwen` | Candidate window follows the new Canvas caret; composition remains active | PASS |
| Lower-right caret composition | Move the caret near the lower-right, type `zhongwen` | Candidate window remains visible and within usable screen bounds | PASS |
| Move during composition | Begin `zhongwen`, move the caret from upper-left to center before commit | Candidate window moves with the caret; composition text is not lost or committed early | PASS |
| Exactly-once commit | Choose candidates that commit `中文` | Canvas displays exactly `中文`, with no duplicate transient or committed text | PASS |
| Escape cancellation | Begin `zhongwen`, then press Escape | Composition text disappears; committed text remains unchanged | PASS |
| Unicode Backspace | Commit `A中`, then press Backspace once | Only `中` is deleted; `A` remains | PASS |
| Automatic visual wrap | Type enough text to exceed the text box width without pressing Enter | Canvas wraps onto a new visual line; stored text contains no inserted `\n`; native candidate anchor follows the visual caret | PASS |

## Test Matrix

| Browser | Display Scale | Zoom | All Required Scenarios | Evidence |
|---|---:|---:|---|---|
| Chrome | 100% | 80% | PASS | Windows 11 manual verification |
| Chrome | 100% | 100% | PASS | Windows 11 manual verification |
| Chrome | 100% | 125% | PASS | Windows 11 manual verification |
| Edge | 100% | 80% | PASS | Windows 11 manual verification |
| Edge | 100% | 100% | PASS | Windows 11 manual verification |
| Edge | 100% | 125% | PASS | Windows 11 manual verification |
| Chrome | 150% | 100% | PASS | Windows 11 manual verification |
| Edge | 150% | 100% | PASS | Windows 11 manual verification |

## Current Lab Defaults

- Canvas: 960 × 540 CSS pixels.
- Text origin: `(40, 40)`.
- Automatic visual-wrap width: `880` CSS pixels.
- Soft wrapping never inserts `\n`; only Enter creates a stored line break.

## Decision Rule

- **GO** only when candidate placement passes in Chrome and Edge and committed text never duplicates.
- **NO-GO** when the candidate cannot follow the Canvas caret, composition is not visible before commit, or text is lost/duplicated.
- All required manual rows passed in Chrome and Edge; the gate is open for Tasks 7-9.
