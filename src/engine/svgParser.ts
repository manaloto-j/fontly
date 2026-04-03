/**
 * SVG Parser + Coordinate Transform Engine
 * Pure TypeScript — zero React, zero DOM dependencies (except DOMParser for SVG parsing)
 */

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

export function transformPathData(
  d: string,
  matrix: TransformMatrix,
  svgHeight: number,
  viewBox: { x: number; y: number; w: number; h: number },
  upm: number,
  ascender: number,
): string {
  const scaleX = upm / viewBox.w
  const scaleY = upm / viewBox.h

  const transformPoint = (x: number, y: number): [number, number] => {
    const [mx, my] = applyMatrix(matrix, x, y)
    const vx = mx - viewBox.x
    const vy = my - viewBox.y
    const fx = vx * scaleX
    const fy = ascender - vy * scaleY
    return [fx, fy]
  }

  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g) ?? []

  let result = ''
  let i = 0
  let cx = 0, cy = 0
  let startX = 0, startY = 0

  const num = () => parseFloat(tokens[i++])

  while (i < tokens.length) {
    const cmd = tokens[i++]

    switch (cmd) {
      case 'M': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          cx = num(); cy = num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
          startX = cx; startY = cy
        }
        result += `M ${args.join(' ')} `
        break
      }
      case 'm': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          cx += num(); cy += num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
          startX = cx; startY = cy
        }
        result += `M ${args.join(' ')} `
        break
      }
      case 'L': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          cx = num(); cy = num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `L ${args.join(' ')} `
        break
      }
      case 'l': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          cx += num(); cy += num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `L ${args.join(' ')} `
        break
      }
      case 'H': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          cx = num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `L ${args.join(' ')} `
        break
      }
      case 'h': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          cx += num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `L ${args.join(' ')} `
        break
      }
      case 'V': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          cy = num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `L ${args.join(' ')} `
        break
      }
      case 'v': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          cy += num()
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `L ${args.join(' ')} `
        break
      }
      case 'C': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          const x1 = num(), y1 = num()
          const x2 = num(), y2 = num()
          cx = num(); cy = num()
          const [fx1, fy1] = transformPoint(x1, y1)
          const [fx2, fy2] = transformPoint(x2, y2)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx1.toFixed(3)},${fy1.toFixed(3)} ${fx2.toFixed(3)},${fy2.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 'c': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          const x1 = cx + num(), y1 = cy + num()
          const x2 = cx + num(), y2 = cy + num()
          cx += num(); cy += num()
          const [fx1, fy1] = transformPoint(x1, y1)
          const [fx2, fy2] = transformPoint(x2, y2)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx1.toFixed(3)},${fy1.toFixed(3)} ${fx2.toFixed(3)},${fy2.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 'S': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          const x2 = num(), y2 = num()
          cx = num(); cy = num()
          const [fx2, fy2] = transformPoint(x2, y2)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx2.toFixed(3)},${fy2.toFixed(3)} ${fx2.toFixed(3)},${fy2.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 's': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          const x2 = cx + num(), y2 = cy + num()
          cx += num(); cy += num()
          const [fx2, fy2] = transformPoint(x2, y2)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fx2.toFixed(3)},${fy2.toFixed(3)} ${fx2.toFixed(3)},${fy2.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 'Q': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          const qx1 = num(), qy1 = num()
          cx = num(); cy = num()
          const [fqx1, fqy1] = transformPoint(qx1, qy1)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fqx1.toFixed(3)},${fqy1.toFixed(3)} ${fqx1.toFixed(3)},${fqy1.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `C ${args.join(' ')} `
        break
      }
      case 'q': {
        const args: string[] = []
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          const qx1 = cx + num(), qy1 = cy + num()
          cx += num(); cy += num()
          const [fqx1, fqy1] = transformPoint(qx1, qy1)
          const [fx, fy] = transformPoint(cx, cy)
          args.push(`${fqx1.toFixed(3)},${fqy1.toFixed(3)} ${fqx1.toFixed(3)},${fqy1.toFixed(3)} ${fx.toFixed(3)},${fy.toFixed(3)}`)
        }
        result += `C ${args.join(' ')} `
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
  }

  return result.trim()
}

export function parseSVGGlyph(
  svgString: string,
  upm: number,
  ascender: number,
): ParsedGlyph {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  const svg = doc.querySelector('svg')

  if (!svg) {
    return { paths: [], hasStrokes: false, svgWidth: 0, svgHeight: 0, viewBox: { x: 0, y: 0, w: upm, h: upm } }
  }

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

  let hasStrokes = false
  const paths: string[] = []

  const collectPaths = (el: Element, parentMatrix: TransformMatrix) => {
    const transformAttr = el.getAttribute('transform') ?? ''
    const localMatrix = parseTransformAttr(transformAttr)
    const matrix = multiplyMatrix(parentMatrix, localMatrix)

    if (elementHasStroke(el)) hasStrokes = true

    const tagName = el.tagName.toLowerCase()

    if (tagName === 'path') {
      const d = el.getAttribute('d')
      if (d) {
        const transformed = transformPathData(d, matrix, svgHeight, viewBox, upm, ascender)
        if (transformed) paths.push(transformed)
      }
    } else if (tagName === 'rect') {
      const x = parseFloat(el.getAttribute('x') ?? '0')
      const y = parseFloat(el.getAttribute('y') ?? '0')
      const w = parseFloat(el.getAttribute('width') ?? '0')
      const h = parseFloat(el.getAttribute('height') ?? '0')
      const rx = parseFloat(el.getAttribute('rx') ?? '0')
      const ry = parseFloat(el.getAttribute('ry') ?? el.getAttribute('rx') ?? '0')
      let d: string
      if (rx === 0 && ry === 0) {
        d = `M ${x},${y} H ${x+w} V ${y+h} H ${x} Z`
      } else {
        d = `M ${x+rx},${y} H ${x+w-rx} A ${rx},${ry} 0 0 1 ${x+w},${y+ry} V ${y+h-ry} A ${rx},${ry} 0 0 1 ${x+w-rx},${y+h} H ${x+rx} A ${rx},${ry} 0 0 1 ${x},${y+h-ry} V ${y+ry} A ${rx},${ry} 0 0 1 ${x+rx},${y} Z`
      }
      const transformed = transformPathData(d, matrix, svgHeight, viewBox, upm, ascender)
      if (transformed) paths.push(transformed)
    } else if (tagName === 'circle') {
      const cx2 = parseFloat(el.getAttribute('cx') ?? '0')
      const cy2 = parseFloat(el.getAttribute('cy') ?? '0')
      const r = parseFloat(el.getAttribute('r') ?? '0')
      const k = 0.5522847498
      const d = `M ${cx2-r},${cy2} C ${cx2-r},${cy2-k*r} ${cx2-k*r},${cy2-r} ${cx2},${cy2-r} C ${cx2+k*r},${cy2-r} ${cx2+r},${cy2-k*r} ${cx2+r},${cy2} C ${cx2+r},${cy2+k*r} ${cx2+k*r},${cy2+r} ${cx2},${cy2+r} C ${cx2-k*r},${cy2+r} ${cx2-r},${cy2+k*r} ${cx2-r},${cy2} Z`
      const transformed = transformPathData(d, matrix, svgHeight, viewBox, upm, ascender)
      if (transformed) paths.push(transformed)
    } else if (tagName === 'ellipse') {
      const cx2 = parseFloat(el.getAttribute('cx') ?? '0')
      const cy2 = parseFloat(el.getAttribute('cy') ?? '0')
      const rx2 = parseFloat(el.getAttribute('rx') ?? '0')
      const ry2 = parseFloat(el.getAttribute('ry') ?? '0')
      const k = 0.5522847498
      const d = `M ${cx2-rx2},${cy2} C ${cx2-rx2},${cy2-k*ry2} ${cx2-k*rx2},${cy2-ry2} ${cx2},${cy2-ry2} C ${cx2+k*rx2},${cy2-ry2} ${cx2+rx2},${cy2-k*ry2} ${cx2+rx2},${cy2} C ${cx2+rx2},${cy2+k*ry2} ${cx2+k*rx2},${cy2+ry2} ${cx2},${cy2+ry2} C ${cx2-k*rx2},${cy2+ry2} ${cx2-rx2},${cy2+k*ry2} ${cx2-rx2},${cy2} Z`
      const transformed = transformPathData(d, matrix, svgHeight, viewBox, upm, ascender)
      if (transformed) paths.push(transformed)
    } else if (tagName === 'polygon' || tagName === 'polyline') {
      const pointsAttr = el.getAttribute('points') ?? ''
      const pts = pointsAttr.trim().split(/[\s,]+/).map(Number)
      if (pts.length >= 2) {
        let d = `M ${pts[0]},${pts[1]}`
        for (let j = 2; j < pts.length; j += 2) {
          d += ` L ${pts[j]},${pts[j+1]}`
        }
        if (tagName === 'polygon') d += ' Z'
        const transformed = transformPathData(d, matrix, svgHeight, viewBox, upm, ascender)
        if (transformed) paths.push(transformed)
      }
    }

    for (const child of Array.from(el.children)) {
      collectPaths(child, matrix)
    }
  }

  collectPaths(svg, { ...IDENTITY })

  return {
    paths,
    hasStrokes,
    strokeWarning: hasStrokes
      ? 'This glyph contains strokes. Strokes are not supported in font outlines — only filled paths will be exported. The glyph will be skipped during export.'
      : undefined,
    svgWidth,
    svgHeight,
    viewBox,
  }
}
