/**
 * SVG Preview Utilities
 * Shared helpers for rendering SVG glyphs consistently across the app.
 */

export interface ParsedSVGPreview {
  innerContent: string
  viewBox: string
  width: number
  height: number
  aspectRatio: number
}

/**
 * Parse an SVG string and extract its inner content + viewBox.
 * Used to render glyphs inline as native SVG elements (not <image> tags).
 */
export function parseSVGForPreview(svgString: string): ParsedSVGPreview {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  const svg = doc.querySelector('svg')

  if (!svg) {
    return { innerContent: '', viewBox: '0 0 100 100', width: 100, height: 100, aspectRatio: 1 }
  }

  let viewBox = svg.getAttribute('viewBox') ?? ''
  let vbW = 100, vbH = 100

  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4) {
      vbW = parts[2]
      vbH = parts[3]
    }
  } else {
    vbW = parseFloat(svg.getAttribute('width') ?? '100') || 100
    vbH = parseFloat(svg.getAttribute('height') ?? '100') || 100
    viewBox = `0 0 ${vbW} ${vbH}`
  }

  return {
    innerContent: svg.innerHTML,
    viewBox,
    width: vbW,
    height: vbH,
    aspectRatio: vbW / vbH,
  }
}

/**
 * Build a self-contained SVG string suitable for use in dangerouslySetInnerHTML
 * inside a container div. Strips the outer <svg> and re-wraps with proper viewBox.
 * The container div controls sizing via CSS.
 */
export function buildPreviewSVG(svgString: string): string {
  const parsed = parseSVGForPreview(svgString)
  return `<svg viewBox="${parsed.viewBox}" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" overflow="visible">${parsed.innerContent}</svg>`
}
