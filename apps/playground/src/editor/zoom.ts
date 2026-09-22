export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((z) => z > zoom + 1e-9) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!
}
export function zoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-9) ?? ZOOM_STEPS[0]!
}
export function fitZoom(container: { w: number; h: number }, page: { w: number; h: number }): number {
  if (page.w <= 0 || page.h <= 0) return 1
  return Math.min(container.w / page.w, container.h / page.h)
}
