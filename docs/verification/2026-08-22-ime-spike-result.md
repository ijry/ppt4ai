# IME Spike Verification Result

## Decision

**GO — manual Chrome and Edge verification passed.**

Chromium CDP automation passes, but the native Windows candidate window still requires a human-observed Chrome and Edge check. Workspace expansion is approved.

## Environment

| Item | Value |
|---|---|
| Date | 2026-08-22 |
| OS | Microsoft Windows 11 IoT Enterprise LTSC, 10.0.26100 build 26100 |
| Display scale | 100% (`AppliedDPI=96`) |
| Google Chrome | 151.0.7922.48 |
| Microsoft Edge | 151.0.4129.101 |
| Playwright | 1.62.1 |
| Playwright Chromium | Chrome for Testing 151.0.7922.34, build 1234 |
| Input method | Pending manual recording |

## Automated Evidence

Command: `pnpm test:e2e --project=chromium`

Result: **PASS — 5 tests passed.**

- CDP `Input.imeSetComposition` renders transient `zhong` before commit.
- Canvas contains painted non-white pixels during composition.
- CDP `Input.insertText` commits `中`, then `文`, producing exactly `中文`.
- Composition remains active while the Canvas caret origin moves.
- The native DOM Range caret and probe rectangle remain aligned within 2 CSS pixels.
- Canvas-origin movement is reflected by the hidden input anchor within 1 CSS pixel after browser scaling.
- Long text wraps visually at the configured text-box width without inserting newline characters into committed text.

Unit and build evidence:

- `pnpm exec vitest run apps/ime-lab/src packages/text/src/ime`: **PASS — 17 tests passed.**
- `pnpm typecheck`: **PASS.**
- `pnpm build`: **PASS.**

## Manual Evidence

Checklist: [`apps/ime-lab/e2e/manual-ime-checklist.md`](../../apps/ime-lab/e2e/manual-ime-checklist.md)

| Field | Result |
|---|---|
| Chrome candidate-window placement | PASS |
| Edge candidate-window placement | PASS |
| IME name/version | PASS — Windows Chinese IME |
| Zoom matrix | PASS — 80%, 100%, 125% |
| 150% display scale | PASS — verified |
| Screenshot/recording paths | User-confirmed manual pass |

## Gate

The manual matrix records a pass in both Chrome and Edge. Proceed with Tasks 7-9. Any future NO-GO result requires revisiting the input architecture.
