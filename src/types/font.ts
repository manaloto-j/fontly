// ─── Glyph adjustments ────────────────────────────────────────────────────────
export interface GlyphAdjustments {
  scaleX: number; // 0.1 – 3.0, default 1
  scaleY: number; // 0.1 – 3.0, default 1
  offsetX: number; // -200 – 200 units, default 0
  offsetY: number; // -200 – 200 units, default 0
  rotate: number; // -180 – 180 degrees, default 0
  flipH: boolean; // flip horizontally
  flipV: boolean; // flip vertically
  baseline: number; // baseline shift in units, default 0
  advanceWidth: number; // advance width in units, default 600
  leftBearing: number; // left side bearing in units, default 50
}

// ─── Per-glyph data ────────────────────────────────────────────────────────────
export interface GlyphData {
  codepoint: string; // e.g. "U+0041"
  svgContent: string | null; // raw SVG string
  fileName: string | null; // original file name
  adjustments: GlyphAdjustments;
  uploadedAt: number | null; // timestamp
}

// ─── Font metrics ──────────────────────────────────────────────────────────────
export interface FontMetrics {
  unitsPerEm: number; // typically 1000
  ascender: number; // typically 800
  descender: number; // typically -200
  capHeight: number; // typically 700
  xHeight: number; // typically 500
  lineGap: number; // typically 0
}

// ─── Font metadata ─────────────────────────────────────────────────────────────
export interface FontMetadata {
  familyName: string;
  styleName: string;
  version: string;
  description: string;
  license: string;
}

// ─── Full project ──────────────────────────────────────────────────────────────
export interface FontProject {
  id: string;
  metadata: FontMetadata;
  metrics: FontMetrics;
  glyphs: Record<string, GlyphData>; // keyed by codepoint string e.g. "U+0041"
  specialCharsEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─── History entry ─────────────────────────────────────────────────────────────
export interface HistoryEntry {
  glyphs: Record<string, GlyphData>;
  timestamp: number;
}

// ─── Defaults ──────────────────────────────────────────────────────────────────
export const DEFAULT_ADJUSTMENTS: GlyphAdjustments = {
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
  rotate: 0,
  flipH: false,
  flipV: false,
  baseline: 0,
  advanceWidth: 600,
  leftBearing: 50,
};

export const DEFAULT_METRICS: FontMetrics = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  capHeight: 700,
  xHeight: 500,
  lineGap: 0,
};

export const DEFAULT_METADATA: FontMetadata = {
  familyName: "Untitled Font",
  styleName: "Regular",
  version: "1.0",
  description: "",
  license: "MIT",
};
