/**
 * SVG Parser + Coordinate Transform Engine
 * Pure TypeScript — zero React, zero DOM dependencies (except DOMParser)
 *
 * Handles:
 *  - All SVG path commands including A/a arcs (converted to cubics)
 *  - All SVG shape types (path, rect, circle, ellipse, polygon, polyline)
 *  - Transform flattening (matrix, translate, scale, rotate, skewX, skewY)
 *  - GlyphAdjustments baked into the coordinate transform
 *  - SVG → font coordinate space (top-left Y-down → bottom-left Y-up, scaled to UPM)
 */

import type { GlyphAdjustments } from '../types/font'

export interface ParsedGlyph {
  paths: string[]
  hasStrokes: boolean
  strokeWarning?: string
  svgWidth: number
  svgHeight: number
  viewBox: { x: number; y: number; w: number; h: number }
}

export interface TransformMatrix {
  a: number; b: number; c: number
  d: number; e: number; f: number
}

const IDENTITY: TransformMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

// ── Matrix helpers ─────────────────────────────────────────────────────────────

function multiplyMatrix(m1: TransformMatrix, m2: TransformMatrix): TransformMatrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  }
}

function applyMatrix(m: TransformMatrix, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]
}

// ── Transform attribute parser ─────────────────────────────────────────────────

export function parseTransformAttr(transform: string): TransformMatrix {
  let result = { ...IDENTITY }
  if (!transform) return result

  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]+)\)/g
  let match: RegExpExecArray | null

  while ((match = re.exec(transform)) !== null) {
    const type = match[1]
    const args = match[2].trim().split(/[\s,]+/).map(Number)
    let m: TransformMatrix = { ...IDENTITY }

    switch (type) {
      case 'matrix':
        m = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] }
        break
      case 'translate':
        m = { ...IDENTITY, e: args[0], f: args[1] ?? 0 }
        break
      case 'scale': {
        const sx = args[0], sy = args[1] ?? args[0]
        m = { ...IDENTITY, a: sx, d: sy }
        break
      }
      case 'rotate': {
        const ang = (args[0] * Math.PI) / 180
        const cx = args[1] ?? 0, cy = args[2] ?? 0
        const cos = Math.cos(ang), sin = Math.sin(ang)
        m = {
          a: cos, b: sin, c: -sin, d: cos,
          e: cx - cos * cx + sin * cy,
          f: cy - sin * cx - cos * cy,
        }
        break
      }
      case 'skewX': {
        const t = Math.tan((args[0] * Math.PI) / 180)
        m = { ...IDENTITY, c: t }
        break
      }
      case 'skewY': {
        const t = Math.tan((args[0] * Math.PI) / 180)
        m = { ...IDENTITY, b: t }
        break
      }
    }
    result = multiplyMatrix(result, m)
  }
  return result
}

// ── Arc to cubic bezier conversion ────────────────────────────────────────────
// Converts SVG arc parameters to one or more cubic bezier curves.
// Based on the SVG spec implementation (endpoint to center parameterization).

function arcToCubics(
  x1: number, y1: number,
  rx: number, ry: number,
  xRot: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number, y2: number,
): Array<[number, number, number, number, number, number]> {
  // Handle degenerate case
  if (x1 === x2 && y1 === y2) return []
  if (rx === 0 || ry === 0) {
    // Treat as line — return empty, caller handles as lineTo
    return []
  }

  const phi = (xRot * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  // Step 1: Compute (x1', y1')
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy

  // Step 2: Compute (cx', cy')
  rx = Math.abs(rx)
  ry = Math.abs(ry)

  // Ensure radii are large enough
  const x1pSq = x1p * x1p
  const y1pSq = y1p * y1p
  const rxSq = rx * rx
  const rySq = ry * ry

  const lambda = x1pSq / rxSq + y1pSq / rySq
  if (lambda > 1) {
    const sqrtLambda = Math.sqrt(lambda)
    rx *= sqrtLambda
    ry *= sqrtLambda
  }

  const rxSq2 = rx * rx
  const rySq2 = ry * ry

  const num = Math.max(0, rxSq2 * rySq2 - rxSq2 * y1pSq - rySq2 * x1pSq)
  const den = rxSq2 * y1pSq + rySq2 * x1pSq
  const sq = Math.sqrt(num / den)
  const sign = largeArc === sweep ? -1 : 1

  const cxp = sign * sq * (rx * y1p) / ry
  const cyp = sign * sq * -(ry * x1p) / rx

  // Step 3: Compute (cx, cy) from (cx', cy')
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2

  // Step 4: Compute theta1 and dtheta
  const ux = (x1p - cxp) / rx
  const uy = (y1p - cyp) / ry
  const vx = (-x1p - cxp) / rx
  const vy = (-y1p - cyp) / ry

  const angle = (u: [number, number], v: [number, number]) => {
    const dot = u[0] * v[0] + u[1] * v[1]
    const len = Math.sqrt((u[0] * u[0] + u[1] * u[1]) * (v[0] * v[0] + v[1] * v[1]))
    return Math.sign(u[0] * v[1] - u[1] * v[0]) * Math.acos(Math.max(-1, Math.min(1, dot / len)))
  }

  let theta1 = angle([1, 0], [ux, uy])
  let dtheta = angle([ux, uy], [vx, vy])

  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI

  // Split arc into segments of at most 90 degrees
  const segments = Math.ceil(Math.abs(dtheta) / (Math.PI / 2))
  const dt = dtheta / segments

  const cubics: Array<[number, number, number, number, number, number]> = []

  for (let i = 0; i < segments; i++) {
    const t1 = theta1 + i * dt
    const t2 = theta1 + (i + 1) * dt
    const alpha = (4 / 3) * Math.tan((t2 - t1) / 4)

    const cos1 = Math.cos(t1), sin1 = Math.sin(t1)
    const cos2 = Math.cos(t2), sin2 = Math.sin(t2)

    // Control points in ellipse space
    const ep1x = rx * cos1
    const ep1y = ry * sin1
    const ep2x = rx * cos2
    const ep2y = ry * sin2

    const d1x = -rx * sin1 * alpha
    const d1y = ry * cos1 * alpha
    const d2x = rx * sin2 * alpha
    const d2y = -ry * cos2 * alpha

    // Rotate back and translate to absolute coords
    const toAbs = (ex: number, ey: number): [number, number] => [
      cosPhi * ex - sinPhi * ey + cx,
      sinPhi * ex + cosPhi * ey + cy,
    ]

    const [p1x, p1y] = toAbs(ep1x + d1x, ep1y + d1y)
    const [p2x, p2y] = toAbs(ep2x + d2x, ep2y + d2y)
    const [px, py] = toAbs(ep2x, ep2y)

    cubics.push([p1x, p1y, p2x, p2y, px, py])
  }

  return cubics
}

// ── Stroke detection ───────────────────────────────────────────────────────────

function elementHasStroke(el: Element): boolean {
  const stroke = el.getAttribute('stroke')
  const strokeWidth = el.getAttribute('stroke-width')
  const style = el.getAttribute('style') || ''

  if (stroke && stroke !== 'none') return true
  if (strokeWidth && parseFloat(strokeWidth) > 0) {
    if (stroke !== 'none' && !style.includes('stroke: none') && !style.includes('stroke:none')) {
      return true
    }
  }
  if (style.includes('stroke') && !style.includes('stroke: none') && !style.includes('stroke:none')) {
    const match = style.match(/stroke\s*:\s*([^;]+)/)
    if (match && match[1].trim() !== 'none') return true
  }
  return false
}

// ── Build adjustment matrix from GlyphAdjustments ────────────────────────────
// Converts the per-glyph editor adjustments into a single transform matrix
// that gets pre-multiplied into the path transform pipeline.

function buildAdjustmentMatrix(
  adj: GlyphAdjustments,
  viewBox: { x: number; y: number; w: number; h: number },
): TransformMatrix {
  // Center of the viewBox — we transform around this point
  const cx = viewBox.x + viewBox.w / 2
  const cy = viewBox.y + viewBox.h / 2

  // Start with identity
  let m: TransformMatrix = { ...IDENTITY }

  // 1. Flip H/V (scale around center)
  if (adj.flipH || adj.flipV) {
    const sx = adj.flipH ? -1 : 1
    const sy = adj.flipV ? -1 : 1
    // translate to center, scale, translate back
    const flip: TransformMatrix = {
      a: sx, b: 0, c: 0, d: sy,
      e: cx * (1 - sx),
      f: cy * (1 - sy),
    }
    m = multiplyMatrix(m, flip)
  }

  // 2. Rotate around center
  if (adj.rotate !== 0) {
    const ang = (adj.rotate * Math.PI) / 180
    const cos = Math.cos(ang), sin = Math.sin(ang)
    const rot: TransformMatrix = {
      a: cos, b: sin, c: -sin, d: cos,
      e: cx - cos * cx + sin * cy,
      f: cy - sin * cx - cos * cy,
    }
    m = multiplyMatrix(m, rot)
  }

  // 3. Scale around center
  if (adj.scaleX !== 1 || adj.scaleY !== 1) {
    const scale: TransformMatrix = {
      a: adj.scaleX, b: 0, c: 0, d: adj.scaleY,
      e: cx * (1 - adj.scaleX),
      f: cy * (1 - adj.scaleY),
    }
    m = multiplyMatrix(m, scale)
  }

  // 4. Translate (offsetX, offsetY are in SVG user units)
  if (adj.offsetX !== 0 || adj.offsetY !== 0) {
    const translate: TransformMatrix = {
      ...IDENTITY,
      e: adj.offsetX,
      f: adj.offsetY,
    }
    m = multiplyMatrix(m, translate)
  }

  return m
}

// ── Path data transformer ──────────────────────────────────────────────────────

export function transformPathData(
  d: string,
  matrix: TransformMatrix,
  svgHeight: number,
  viewBox: { x: number; y: number; w: number; h: number },
  upm: number,
  ascender: number,
  baselineShift: number = 0,
): string {
  const scaleX = upm / viewBox.w
  const scaleY = upm / viewBox.h

  const transformPoint = (x: number, y: number): [number, number] => {
    const [mx, my] = applyMatrix(matrix, x, y)
    const vx = mx - viewBox.x
    const vy = my - viewBox.y
    const fx = vx * scaleX
    // Flip Y: SVG Y-down → font Y-up, offset by ascender + baseline shift
    const fy = ascender - vy * scaleY + baselineShift
    return [fx, fy]
  }

  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g) ?? []

  let result = ''
  let i = 0
  let cx = 0, cy = 0
  let startX = 0, startY = 0
  let lastCmd = ''
  let lastCx2 = 0, lastCy2 = 0 // last cubic control point (for S/s)
  let lastQx1 = 0, lastQy1 = 0 // last quad control point (for T/t)

  const num = () => parseFloat(tokens[i++])
  const hasMore = () => i < tokens.length && !/[A-Za-z]/.test(tokens[i])

  while (i < tokens.length) {
    const cmd = tokens[i++]

    switch (cmd) {
      case 'M': {
        const args: string[] = []
        let first = true
        while (hasMore()) {
          cx = num(); cy = num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
          if (first) { startX = cx; startY = cy; first = false }
        }
        result += `M ${args.join(' ')} `
        break
      }
      case 'm': {
        const args: string[] = []
        let first = true
        while (hasMore()) {
          cx += num(); cy += num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
          if (first) { startX = cx; startY = cy; first = false }
        }
        result += `M ${args.join(' ')} `
        break
      }
      case 'L': {
        const args: string[] = []
        while (hasMore()) {
          cx = num(); cy = num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `L ${args.join(' ')} `
        break
      }
      case 'l': {
        const args: string[] = []
        while (hasMore()) {
          cx += num(); cy += num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `L ${args.join(' ')} `
        break
      }
      case 'H': {
        const args: string[] = []
        while (hasMore()) {
          cx = num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `L ${args.join(' ')} `
        break
      }
      case 'h': {
        const args: string[] = []
        while (hasMore()) {
          cx += num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `L ${args.join(' ')} `
        break
      }
      case 'V': {
        const args: string[] = []
        while (hasMore()) {
          cy = num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `L ${args.join(' ')} `
        break
      }
      case 'v': {
        const args: string[] = []
        while (hasMore()) {
          cy += num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `L ${args.join(' ')} `
        break
      }
      case 'C': {
        const args: string[] = []
        while (hasMore()) {
          const x1 = num(), y1 = num()
          const x2 = num(), y2 = num()
          cx = num(); cy = num()
          const [fx1, fy1] = transformPoint(x1, y1)
          const [fx2, fy2] = transformPoint(x2, y2)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx1.toFixed(3)},${fy1.toFixed(3)} ${fx2.toFixed(3)},${fy2.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
          lastCx2 = x2; lastCy2 = y2
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 'c': {
        const args: string[] = []
        while (hasMore()) {
          const x1 = cx + num(), y1 = cy + num()
          const x2 = cx + num(), y2 = cy + num()
          cx += num(); cy += num()
          const [fx1, fy1] = transformPoint(x1, y1)
          const [fx2, fy2] = transformPoint(x2, y2)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx1.toFixed(3)},${fy1.toFixed(3)} ${fx2.toFixed(3)},${fy2.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
          lastCx2 = x2; lastCy2 = y2
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 'S': {
        const args: string[] = []
        while (hasMore()) {
          // Reflect last control point
          const rx1 = 2 * cx - (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's' ? lastCx2 : cx)
          const ry1 = 2 * cy - (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's' ? lastCy2 : cy)
          const x2 = num(), y2 = num()
          cx = num(); cy = num()
          const [frx1, fry1] = transformPoint(rx1, ry1)
          const [fx2, fy2] = transformPoint(x2, y2)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${frx1.toFixed(3)},${fry1.toFixed(3)} ${fx2.toFixed(3)},${fy2.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
          lastCx2 = x2; lastCy2 = y2
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 's': {
        const args: string[] = []
        while (hasMore()) {
          const rx1 = 2 * cx - (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's' ? lastCx2 : cx)
          const ry1 = 2 * cy - (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's' ? lastCy2 : cy)
          const x2 = cx + num(), y2 = cy + num()
          cx += num(); cy += num()
          const [frx1, fry1] = transformPoint(rx1, ry1)
          const [fx2, fy2] = transformPoint(x2, y2)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${frx1.toFixed(3)},${fry1.toFixed(3)} ${fx2.toFixed(3)},${fy2.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
          lastCx2 = x2; lastCy2 = y2
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 'Q': {
        const args: string[] = []
        while (hasMore()) {
          const qx1 = num(), qy1 = num()
          cx = num(); cy = num()
          // Elevate quadratic to cubic
          const prevX = cx, prevY = cy // Note: cx/cy already updated
          const [fqx1, fqy1] = transformPoint(qx1, qy1)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fqx1.toFixed(3)},${fqy1.toFixed(3)} ${fqx1.toFixed(3)},${fqy1.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
          lastQx1 = qx1; lastQy1 = qy1
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 'q': {
        const args: string[] = []
        while (hasMore()) {
          const qx1 = cx + num(), qy1 = cy + num()
          cx += num(); cy += num()
          const [fqx1, fqy1] = transformPoint(qx1, qy1)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fqx1.toFixed(3)},${fqy1.toFixed(3)} ${fqx1.toFixed(3)},${fqy1.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
          lastQx1 = qx1; lastQy1 = qy1
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 'T': {
        // Smooth quadratic — reflect last quad control point
        const args: string[] = []
        while (hasMore()) {
          const qx1 = 2 * cx - (lastCmd === 'Q' || lastCmd === 'q' || lastCmd === 'T' || lastCmd === 't' ? lastQx1 : cx)
          const qy1 = 2 * cy - (lastCmd === 'Q' || lastCmd === 'q' || lastCmd === 'T' || lastCmd === 't' ? lastQy1 : cy)
          cx = num(); cy = num()
          const [fqx1, fqy1] = transformPoint(qx1, qy1)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fqx1.toFixed(3)},${fqy1.toFixed(3)} ${fqx1.toFixed(3)},${fqy1.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
          lastQx1 = qx1; lastQy1 = qy1
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 't': {
        const args: string[] = []
        while (hasMore()) {
          const qx1 = 2 * cx - (lastCmd === 'Q' || lastCmd === 'q' || lastCmd === 'T' || lastCmd === 't' ? lastQx1 : cx)
          const qy1 = 2 * cy - (lastCmd === 'Q' || lastCmd === 'q' || lastCmd === 'T' || lastCmd === 't' ? lastQy1 : cy)
          cx += num(); cy += num()
          const [fqx1, fqy1] = transformPoint(qx1, qy1)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fqx1.toFixed(3)},${fqy1.toFixed(3)} ${fqx1.toFixed(3)},${fqy1.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
          lastQx1 = qx1; lastQy1 = qy1
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 'A': {
        // Arc → cubic bezier conversion
        while (hasMore()) {
          const rxi = Math.abs(num()), ryi = Math.abs(num())
          const xRot = num()
          const largeArc = num() !== 0
          const sweep = num() !== 0
          const x2 = num(), y2 = num()
          const cubics = arcToCubics(cx, cy, rxi, ryi, xRot, largeArc, sweep, x2, y2)
          for (const [p1x, p1y, p2x, p2y, px, py] of cubics) {
            const [fp1x, fp1y] = transformPoint(p1x, p1y)
            const [fp2x, fp2y] = transformPoint(p2x, p2y)
            const [fpx, fpy] = transformPoint(px, py)
            result += `C ${fp1x.toFixed(3)},${fp1y.toFixed(3)} ${fp2x.toFixed(3)},${fp2y.toFixed(3)} ${fpx.toFixed(3)},${fpy.toFixed(3)} `
          }
          // If no cubics (degenerate), treat as lineTo
          if (cubics.length === 0) {
            const [fx, fy] = transformPoint(x2, y2)
            result += `L ${fx.toFixed(3)},${fy.toFixed(3)} `
          }
          cx = x2; cy = y2
        }
        break
      }
      case 'a': {
        while (hasMore()) {
          const rxi = Math.abs(num()), ryi = Math.abs(num())
          const xRot = num()
          const largeArc = num() !== 0
          const sweep = num() !== 0
          const x2 = cx + num(), y2 = cy + num()
          const cubics = arcToCubics(cx, cy, rxi, ryi, xRot, largeArc, sweep, x2, y2)
          for (const [p1x, p1y, p2x, p2y, px, py] of cubics) {
            const [fp1x, fp1y] = transformPoint(p1x, p1y)
            const [fp2x, fp2y] = transformPoint(p2x, p2y)
            const [fpx, fpy] = transformPoint(px, py)
            result += `C ${fp1x.toFixed(3)},${fp1y.toFixed(3)} ${fp2x.toFixed(3)},${fp2y.toFixed(3)} ${fpx.toFixed(3)},${fpy.toFixed(3)} `
          }
          if (cubics.length === 0) {
            const [fx, fy] = transformPoint(x2, y2)
            result += `L ${fx.toFixed(3)},${fy.toFixed(3)} `
          }
          cx = x2; cy = y2
        }
        break
      }
      case 'Z':
      case 'z':
        cx = startX; cy = startY
        result += 'Z '
        break
      default:
        break
    }

    lastCmd = cmd
  }

  return result.trim()
}

// ── Main parser ────────────────────────────────────────────────────────────────

export function parseSVGGlyph(
  svgString: string,
  upm: number,
  ascender: number,
  adjustments?: GlyphAdjustments,
): ParsedGlyph {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  const svg = doc.querySelector('svg')

  if (!svg) {
    return { paths: [], hasStrokes: false, svgWidth: 0, svgHeight: 0, viewBox: { x: 0, y: 0, w: upm, h: upm } }
  }

  // Parse viewBox
  let viewBox = { x: 0, y: 0, w: upm, h: upm }
  const vbAttr = svg.getAttribute('viewBox')
  if (vbAttr) {
    const parts = vbAttr.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4) {
      viewBox = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }
    }
  }

  const svgWidth = parseFloat(svg.getAttribute('width') ?? String(viewBox.w)) || viewBox.w
  const svgHeight = parseFloat(svg.getAttribute('height') ?? String(viewBox.h)) || viewBox.h
  if (!vbAttr) {
    viewBox.w = svgWidth
    viewBox.h = svgHeight
  }

  // Build the adjustment matrix if adjustments are provided
  const adjustmentMatrix = adjustments
    ? buildAdjustmentMatrix(adjustments, viewBox)
    : { ...IDENTITY }

  // Baseline shift: convert from SVG units to font units
  const baselineShift = adjustments
    ? (adjustments.baseline / viewBox.h) * upm
    : 0

  let hasStrokes = false
  const paths: string[] = []

  const collectPaths = (el: Element, parentMatrix: TransformMatrix) => {
    const transformAttr = el.getAttribute('transform') ?? ''
    const localMatrix = parseTransformAttr(transformAttr)
    // Compose: adjustment matrix → local SVG transforms → parent transforms
    const matrix = multiplyMatrix(adjustmentMatrix, multiplyMatrix(parentMatrix, localMatrix))

    if (elementHasStroke(el)) hasStrokes = true

    const tagName = el.tagName.toLowerCase().replace(/^[^:]+:/, '') // strip namespace

    if (tagName === 'path') {
      const d = el.getAttribute('d')
      if (d) {
        const transformed = transformPathData(d, matrix, svgHeight, viewBox, upm, ascender, baselineShift)
        if (transformed) paths.push(transformed)
      }
    } else if (tagName === 'rect') {
      const x = parseFloat(el.getAttribute('x') ?? '0') || 0
      const y = parseFloat(el.getAttribute('y') ?? '0') || 0
      const w = parseFloat(el.getAttribute('width') ?? '0') || 0
      const h = parseFloat(el.getAttribute('height') ?? '0') || 0
      const rx = parseFloat(el.getAttribute('rx') ?? '0') || 0
      const ry = parseFloat(el.getAttribute('ry') ?? el.getAttribute('rx') ?? '0') || 0
      let d: string
      if (rx === 0 && ry === 0) {
        d = `M ${x},${y} H ${x + w} V ${y + h} H ${x} Z`
      } else {
        d = `M ${x + rx},${y} H ${x + w - rx} A ${rx},${ry} 0 0 1 ${x + w},${y + ry} V ${y + h - ry} A ${rx},${ry} 0 0 1 ${x + w - rx},${y + h} H ${x + rx} A ${rx},${ry} 0 0 1 ${x},${y + h - ry} V ${y + ry} A ${rx},${ry} 0 0 1 ${x + rx},${y} Z`
      }
      const transformed = transformPathData(d, matrix, svgHeight, viewBox, upm, ascender, baselineShift)
      if (transformed) paths.push(transformed)
    } else if (tagName === 'circle') {
      const ecx = parseFloat(el.getAttribute('cx') ?? '0') || 0
      const ecy = parseFloat(el.getAttribute('cy') ?? '0') || 0
      const r = parseFloat(el.getAttribute('r') ?? '0') || 0
      // Use arc commands — now properly handled
      const d = `M ${ecx - r},${ecy} A ${r},${r} 0 0 1 ${ecx + r},${ecy} A ${r},${r} 0 0 1 ${ecx - r},${ecy} Z`
      const transformed = transformPathData(d, matrix, svgHeight, viewBox, upm, ascender, baselineShift)
      if (transformed) paths.push(transformed)
    } else if (tagName === 'ellipse') {
      const ecx = parseFloat(el.getAttribute('cx') ?? '0') || 0
      const ecy = parseFloat(el.getAttribute('cy') ?? '0') || 0
      const erx = parseFloat(el.getAttribute('rx') ?? '0') || 0
      const ery = parseFloat(el.getAttribute('ry') ?? '0') || 0
      const d = `M ${ecx - erx},${ecy} A ${erx},${ery} 0 0 1 ${ecx + erx},${ecy} A ${erx},${ery} 0 0 1 ${ecx - erx},${ecy} Z`
      const transformed = transformPathData(d, matrix, svgHeight, viewBox, upm, ascender, baselineShift)
      if (transformed) paths.push(transformed)
    } else if (tagName === 'polygon' || tagName === 'polyline') {
      const pointsAttr = el.getAttribute('points') ?? ''
      const pts = pointsAttr.trim().split(/[\s,]+/).map(Number)
      if (pts.length >= 2) {
        let d = `M ${pts[0]},${pts[1]}`
        for (let j = 2; j < pts.length; j += 2) {
          d += ` L ${pts[j]},${pts[j + 1]}`
        }
        if (tagName === 'polygon') d += ' Z'
        const transformed = transformPathData(d, matrix, svgHeight, viewBox, upm, ascender, baselineShift)
        if (transformed) paths.push(transformed)
      }
    } else if (tagName === 'line') {
      const x1 = parseFloat(el.getAttribute('x1') ?? '0') || 0
      const y1 = parseFloat(el.getAttribute('y1') ?? '0') || 0
      const x2 = parseFloat(el.getAttribute('x2') ?? '0') || 0
      const y2 = parseFloat(el.getAttribute('y2') ?? '0') || 0
      const d = `M ${x1},${y1} L ${x2},${y2}`
      const transformed = transformPathData(d, matrix, svgHeight, viewBox, upm, ascender, baselineShift)
      if (transformed) paths.push(transformed)
    }

    // Recurse into children (g, symbol, defs, etc.)
    for (const child of Array.from(el.children)) {
      collectPaths(child, multiplyMatrix(parentMatrix, localMatrix))
    }
  }

  collectPaths(svg, { ...IDENTITY })

  return {
    paths,
    hasStrokes,
    strokeWarning: hasStrokes
      ? 'This glyph contains strokes. Convert strokes to filled outlines in your SVG editor.'
      : undefined,
    svgWidth,
    svgHeight,
    viewBox,
  }
}
