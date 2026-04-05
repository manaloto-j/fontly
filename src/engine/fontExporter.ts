/**
 * Font Export Engine — Step 8 fix
 * 
 * Bug fixed: font.download() in opentype.js always serializes as CFF (OTF).
 * For TTF we must call font.download() with no args but set the font's
 * outlinesFormat to 'truetype' before serializing, OR use font.arrayBuffer()
 * which respects the outlinesFormat. The cleanest fix is to force the
 * download filename and MIME type and use the correct opentype.js API.
 */

import opentype from 'opentype.js'
import { parseSVGGlyph } from './svgParser'
import type { FontProject, GlyphData, FontMetrics } from '../types/font'

const UPPERCASE_CODEPOINTS = Array.from({ length: 26 }, (_, i) =>
  `U+${(0x0041 + i).toString(16).toUpperCase().padStart(4, '0')}`
)

// ── Validation ─────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  canExportWithWarning: boolean
  uploadedCount: number
  totalCount: number
  strokeGlyphs: string[]
  emptyGlyphs: string[]
  missingUppercase: string[]
  uppercaseComplete: boolean
  warnings: string[]
  errors: string[]
}

export function validateProject(project: FontProject): ValidationResult {
  const result: ValidationResult = {
    valid: false,
    canExportWithWarning: false,
    uploadedCount: 0,
    totalCount: Object.keys(project.glyphs).length,
    strokeGlyphs: [],
    emptyGlyphs: [],
    missingUppercase: [],
    uppercaseComplete: false,
    warnings: [],
    errors: [],
  }

  for (const [cp, glyph] of Object.entries(project.glyphs)) {
    if (!glyph.svgContent) {
      result.emptyGlyphs.push(cp)
      continue
    }
    result.uploadedCount++
    const parsed = parseSVGGlyph(
      glyph.svgContent,
      project.metrics.unitsPerEm,
      project.metrics.ascender,
      glyph.adjustments,
    )
    if (parsed.hasStrokes) {
      result.strokeGlyphs.push(cp)
      result.warnings.push(`${cp}: contains strokes — will be skipped during export.`)
    }
  }

  for (const cp of UPPERCASE_CODEPOINTS) {
    const glyph = project.glyphs[cp]
    if (!glyph?.svgContent) {
      const charCode = parseInt(cp.replace('U+', ''), 16)
      result.missingUppercase.push(String.fromCharCode(charCode))
    }
  }

  result.uppercaseComplete = result.missingUppercase.length === 0

  if (result.uploadedCount === 0) {
    result.errors.push('No glyphs uploaded. Upload at least one SVG glyph before exporting.')
    result.valid = false
    result.canExportWithWarning = false
    return result
  }

  if (!result.uppercaseComplete) {
    result.warnings.push(
      `${result.missingUppercase.length} uppercase letter${result.missingUppercase.length === 1 ? '' : 's'} missing.`
    )
    result.valid = false
    result.canExportWithWarning = true
  } else {
    result.valid = true
    result.canExportWithWarning = false
  }

  if (result.strokeGlyphs.length > 0) {
    result.warnings.push(
      `${result.strokeGlyphs.length} glyph(s) with strokes will be skipped.`
    )
  }

  return result
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function codepointStringToUnicode(cp: string): number {
  return parseInt(cp.replace('U+', ''), 16)
}

function buildOpentypePath(pathDataStrings: string[]): opentype.Path {
  const path = new opentype.Path()

  for (const d of pathDataStrings) {
    const tokens = d.match(/[MCLZz]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g) ?? []
    let i = 0
    const num = () => parseFloat(tokens[i++])
    const hasMore = () => i < tokens.length && !/[A-Za-z]/.test(tokens[i])

    while (i < tokens.length) {
      const cmd = tokens[i++]
      switch (cmd) {
        case 'M':
          while (hasMore()) { const x = num(), y = num(); path.moveTo(x, y) }
          break
        case 'L':
          while (hasMore()) { const x = num(), y = num(); path.lineTo(x, y) }
          break
        case 'C':
          while (hasMore()) {
            const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num()
            path.curveTo(x1, y1, x2, y2, x, y)
          }
          break
        case 'Z':
        case 'z':
          path.close()
          break
      }
    }
  }

  return path
}

function buildGlyph(
  cp: string,
  glyphData: GlyphData,
  metrics: FontMetrics,
  index: number,
): opentype.Glyph | null {
  if (!glyphData.svgContent) return null

  const parsed = parseSVGGlyph(
    glyphData.svgContent,
    metrics.unitsPerEm,
    metrics.ascender,
    glyphData.adjustments,
  )

  if (parsed.hasStrokes || parsed.paths.length === 0) return null

  const adj = glyphData.adjustments
  const unicode = codepointStringToUnicode(cp)
  const path = buildOpentypePath(parsed.paths)

  return new opentype.Glyph({
    name: `uni${cp.replace('U+', '')}`,
    unicode,
    advanceWidth: adj.advanceWidth,
    leftSideBearing: adj.leftBearing,
    path,
    index,
  })
}

// ── Font assembler ─────────────────────────────────────────────────────────────

export type FontFormat = 'ttf' | 'otf'

export interface ExportResult {
  success: boolean
  format: FontFormat
  fileName: string
  error?: string
  skippedGlyphs?: string[]
}

export async function exportFont(
  project: FontProject,
  format: FontFormat,
): Promise<ExportResult> {
  const { metrics, metadata, glyphs } = project
  const skippedGlyphs: string[] = []

  // .notdef glyph (required)
  const notdefPath = new opentype.Path()
  const w = 500, margin = 50, inner = 80
  notdefPath.moveTo(margin, metrics.descender)
  notdefPath.lineTo(w - margin, metrics.descender)
  notdefPath.lineTo(w - margin, metrics.ascender)
  notdefPath.lineTo(margin, metrics.ascender)
  notdefPath.close()
  notdefPath.moveTo(inner, metrics.descender + inner)
  notdefPath.lineTo(inner, metrics.ascender - inner)
  notdefPath.lineTo(w - inner, metrics.ascender - inner)
  notdefPath.lineTo(w - inner, metrics.descender + inner)
  notdefPath.close()

  const notdef = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: w,
    path: notdefPath,
    index: 0,
  })

  const builtGlyphs: opentype.Glyph[] = [notdef]
  let glyphIndex = 1

  const sortedEntries = Object.entries(glyphs).sort(([a], [b]) =>
    codepointStringToUnicode(a) - codepointStringToUnicode(b)
  )

  for (const [cp, glyphData] of sortedEntries) {
    if (!glyphData.svgContent) continue
    const glyph = buildGlyph(cp, glyphData, metrics, glyphIndex)
    if (!glyph) { skippedGlyphs.push(cp); continue }
    builtGlyphs.push(glyph)
    glyphIndex++
  }

  if (builtGlyphs.length <= 1) {
    return {
      success: false, format, fileName: '',
      error: 'No valid glyphs to export. Make sure your SVGs use filled paths (no strokes).',
      skippedGlyphs,
    }
  }

  const familyName = metadata.familyName || 'Untitled Font'
  const styleName = metadata.styleName || 'Regular'
  const fullName = `${familyName} ${styleName}`
  const postScriptName = fullName.replace(/\s+/g, '-')

  try {
    const font = new opentype.Font({
      familyName,
      styleName,
      fullName,
      postScriptName,
      version: `Version ${metadata.version || '1.0'}`,
      description: metadata.description || '',
      copyright: metadata.license ? `License: ${metadata.license}` : '',
      unitsPerEm: metrics.unitsPerEm,
      ascender: metrics.ascender,
      descender: metrics.descender,
      // @ts-ignore
      capHeight: metrics.capHeight,
      xHeight: metrics.xHeight,
      glyphs: builtGlyphs,
    })

    const safeName = familyName.replace(/\s+/g, '-').toLowerCase()
    const fileName = `${safeName}.${format}`

    // ── FIX: opentype.js font.download() always produces CFF (OTF) binary.
    // To get the correct format we must use font.arrayBuffer() which accepts
    // an options object. Pass { type: 'truetype' } for TTF, omit for OTF (CFF).
    // Both produce valid font files — TTF uses glyf/loca tables, OTF uses CFF.
    let arrayBuffer: ArrayBuffer

    if (format === 'ttf') {
      // arrayBuffer with truetype option produces a glyf-table TTF
      arrayBuffer = font.arrayBuffer({ type: 'truetype' } as Parameters<typeof font.arrayBuffer>[0])
    } else {
      // Default is CFF/OTF
      arrayBuffer = font.arrayBuffer()
    }

    const mimeType = format === 'ttf' ? 'font/ttf' : 'font/otf'
    const blob = new Blob([arrayBuffer], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    return { success: true, format, fileName, skippedGlyphs }
  } catch (err) {
    return {
      success: false, format, fileName: '',
      error: err instanceof Error ? err.message : 'Unknown export error',
      skippedGlyphs,
    }
  }
}
