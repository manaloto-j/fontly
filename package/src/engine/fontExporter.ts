/**
 * Font Export Engine
 * Uses opentype.js to assemble and serialize TTF and OTF font binaries.
 * Pure TypeScript — zero React dependencies.
 *
 * Pipeline:
 *  1. Validate project (check for uploaded glyphs, stroke warnings)
 *  2. Parse each glyph's SVG content → transformed path data
 *  3. Build opentype.js Glyph objects
 *  4. Assemble Font object with proper metrics
 *  5. Serialize to ArrayBuffer → trigger browser download
 */

import opentype from 'opentype.js'
import { parseSVGGlyph } from './svgParser'
import type { FontProject, GlyphData, FontMetrics, FontMetadata } from '../types/font'

// ── Validation ─────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  uploadedCount: number
  totalCount: number
  strokeGlyphs: string[]       // codepoints with strokes (will be skipped)
  emptyGlyphs: string[]        // codepoints with no SVG uploaded
  warnings: string[]
  errors: string[]
}

export function validateProject(project: FontProject): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    uploadedCount: 0,
    totalCount: Object.keys(project.glyphs).length,
    strokeGlyphs: [],
    emptyGlyphs: [],
    warnings: [],
    errors: [],
  }

  for (const [cp, glyph] of Object.entries(project.glyphs)) {
    if (!glyph.svgContent) {
      result.emptyGlyphs.push(cp)
      continue
    }

    result.uploadedCount++

    // Quick stroke check
    const parsed = parseSVGGlyph(glyph.svgContent, project.metrics.unitsPerEm, project.metrics.ascender)
    if (parsed.hasStrokes) {
      result.strokeGlyphs.push(cp)
      result.warnings.push(`${cp}: contains strokes — will be skipped during export.`)
    }
  }

  if (result.uploadedCount === 0) {
    result.valid = false
    result.errors.push('No glyphs have been uploaded. Upload at least one SVG glyph before exporting.')
  }

  if (result.strokeGlyphs.length > 0) {
    result.warnings.push(
      `${result.strokeGlyphs.length} glyph(s) with strokes will be skipped. Convert strokes to filled outlines in your SVG editor first.`
    )
  }

  return result
}

// ── Codepoint utilities ────────────────────────────────────────────────────────

function codepointStringToUnicode(cp: string): number {
  // cp is like "U+0041"
  return parseInt(cp.replace('U+', ''), 16)
}

// ── Path string → opentype.js Path ────────────────────────────────────────────

function buildOpentypePath(pathDataStrings: string[]): opentype.Path {
  const path = new opentype.Path()

  for (const d of pathDataStrings) {
    const tokens = d.match(/[MCLZz]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g) ?? []
    let i = 0
    const num = () => parseFloat(tokens[i++])

    while (i < tokens.length) {
      const cmd = tokens[i++]
      switch (cmd) {
        case 'M': {
          while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
            const x = num(), y = num()
            path.moveTo(x, y)
          }
          break
        }
        case 'L': {
          while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
            const x = num(), y = num()
            path.lineTo(x, y)
          }
          break
        }
        case 'C': {
          while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
            const x1 = num(), y1 = num()
            const x2 = num(), y2 = num()
            const x = num(), y = num()
            path.curveTo(x1, y1, x2, y2, x, y)
          }
          break
        }
        case 'Z':
        case 'z':
          path.close()
          break
      }
    }
  }

  return path
}

// ── Glyph builder ──────────────────────────────────────────────────────────────

function buildGlyph(
  cp: string,
  glyphData: GlyphData,
  metrics: FontMetrics,
  index: number,
): opentype.Glyph | null {
  if (!glyphData.svgContent) return null

  const parsed = parseSVGGlyph(glyphData.svgContent, metrics.unitsPerEm, metrics.ascender)
  if (parsed.hasStrokes || parsed.paths.length === 0) return null

  const adj = glyphData.adjustments
  const unicode = codepointStringToUnicode(cp)

  // Build the path
  const path = buildOpentypePath(parsed.paths)

  const glyph = new opentype.Glyph({
    name: `uni${cp.replace('U+', '')}`,
    unicode,
    advanceWidth: adj.advanceWidth,
    leftSideBearing: adj.leftBearing,
    path,
    index,
  })

  return glyph
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

  // Build notdef glyph (required — shown for missing characters)
  const notdefPath = new opentype.Path()
  const w = 500, h = metrics.ascender - metrics.descender
  const margin = 50
  // Outer rectangle
  notdefPath.moveTo(margin, metrics.descender)
  notdefPath.lineTo(w - margin, metrics.descender)
  notdefPath.lineTo(w - margin, metrics.ascender)
  notdefPath.lineTo(margin, metrics.ascender)
  notdefPath.close()
  // Inner rectangle (cutout — counter)
  const inner = 80
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

  // Build all glyphs
  const builtGlyphs: opentype.Glyph[] = [notdef]
  let glyphIndex = 1

  // Sort by codepoint for deterministic ordering
  const sortedEntries = Object.entries(glyphs).sort(([a], [b]) => {
    return codepointStringToUnicode(a) - codepointStringToUnicode(b)
  })

  for (const [cp, glyphData] of sortedEntries) {
    if (!glyphData.svgContent) continue

    const glyph = buildGlyph(cp, glyphData, metrics, glyphIndex)
    if (!glyph) {
      skippedGlyphs.push(cp)
      continue
    }

    builtGlyphs.push(glyph)
    glyphIndex++
  }

  if (builtGlyphs.length <= 1) {
    return {
      success: false,
      format,
      fileName: '',
      error: 'No valid glyphs to export. Make sure your SVGs use filled paths (no strokes).',
      skippedGlyphs,
    }
  }

  // Build font name table entries
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
      // @ts-ignore — opentype.js accepts these but types may be incomplete
      capHeight: metrics.capHeight,
      xHeight: metrics.xHeight,
      glyphs: builtGlyphs,
    })

    const arrayBuffer = font.download(undefined) // returns ArrayBuffer or triggers download

    // Trigger browser download
    const blob = new Blob([arrayBuffer as unknown as ArrayBuffer], {
      type: format === 'otf' ? 'font/otf' : 'font/ttf',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeName = familyName.replace(/\s+/g, '-').toLowerCase()
    a.href = url
    a.download = `${safeName}.${format}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    return {
      success: true,
      format,
      fileName: `${safeName}.${format}`,
      skippedGlyphs,
    }
  } catch (err) {
    return {
      success: false,
      format,
      fileName: '',
      error: err instanceof Error ? err.message : 'Unknown export error',
      skippedGlyphs,
    }
  }
}
