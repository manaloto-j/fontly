// ── Glyph ────────────────────────────────────────────────────────────────────

export interface GlyphAdjustments {
  scaleX: number       // 0.1 – 3.0, default 1
  scaleY: number       // 0.1 – 3.0, default 1
  offsetX: number      // em units, default 0
  offsetY: number      // em units, default 0
  leftBearing: number  // em units, default 50
  rightBearing: number // em units, default 50
  baselineShift: number // em units, default 0
}

export interface GlyphData {
  codepoint: string       // e.g. "U+0041"
  character: string       // e.g. "A"
  svgContent: string | null  // raw SVG string, null if not uploaded
  svgFileName: string | null
  adjustments: GlyphAdjustments
  uploadedAt: number | null  // timestamp
}

// ── Font Metrics ─────────────────────────────────────────────────────────────

export interface FontMetrics {
  unitsPerEm: number       // 1000 (OTF standard)
  ascender: number         // default 800
  descender: number        // default -200
  capHeight: number        // default 700
  xHeight: number          // default 500
  lineGap: number          // default 0
}

// ── Font Metadata ─────────────────────────────────────────────────────────────

export interface FontMetadata {
  familyName: string       // e.g. "My Font"
  style: 'Regular' | 'Bold' | 'Italic' | 'Bold Italic'
  version: string          // e.g. "1.0"
  designer: string
  license: string
}

// ── Project ──────────────────────────────────────────────────────────────────

export interface FontProject {
  id: string
  metadata: FontMetadata
  metrics: FontMetrics
  glyphs: Record<string, GlyphData>  // keyed by codepoint e.g. "U+0041"
  specialCharsEnabled: boolean
  createdAt: number
  updatedAt: number
}

// ── History (undo/redo) ───────────────────────────────────────────────────────

export interface HistoryEntry {
  glyphs: Record<string, GlyphData>
  metrics: FontMetrics
  metadata: FontMetadata
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export const DEFAULT_ADJUSTMENTS: GlyphAdjustments = {
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
  leftBearing: 50,
  rightBearing: 50,
  baselineShift: 0,
}

export const DEFAULT_METRICS: FontMetrics = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  capHeight: 700,
  xHeight: 500,
  lineGap: 0,
}

export const DEFAULT_METADATA: FontMetadata = {
  familyName: 'Untitled Font',
  style: 'Regular',
  version: '1.0',
  designer: '',
  license: '',
}

export function makeGlyph(character: string): GlyphData {
  const cp = character.codePointAt(0)!
  const codepoint = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
  return {
    codepoint,
    character,
    svgContent: null,
    svgFileName: null,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    uploadedAt: null,
  }
}
