# Fontly — Step 5 Update: Font Metrics Panel + TTF/OTF Export Engine

## New files to add/replace:

### New files:
- src/engine/svgParser.ts         ← SVG path parser + coordinate transform
- src/engine/fontExporter.ts      ← TTF/OTF export engine (uses opentype.js)
- src/components/FontPanel.tsx    ← Metrics/Info/Export dropdown panel
- src/components/FontPanel.module.css

### Replace these files:
- src/components/Navbar.tsx       ← Adds FontPanel trigger + Save project button
- src/store/useFontStore.ts       ← Adds updateMetrics() and updateMetadata() actions

### Patch (append to existing file):
- src/components/Navbar.module.css ← Append contents of Navbar.module.css.patch

## Install opentype.js:
```bash
npm install opentype.js
npm install -D @types/opentype.js
```

## What was built:

### Engine (src/engine/) — pure TypeScript, zero React:
- svgParser.ts: Parses SVG strings, detects strokes, flattens transforms,
  converts all SVG shape types (path, rect, circle, ellipse, polygon) to
  path data, and transforms coordinates from SVG space (top-left, Y-down)
  to font space (bottom-left, Y-up, scaled to UPM).
- fontExporter.ts: Validates the project, builds opentype.js Glyph objects
  from parsed paths, assembles the Font with all proper metrics/metadata,
  serializes to ArrayBuffer, and triggers browser download for TTF or OTF.

### FontPanel (3 tabs):
- Metrics tab: UPM, Ascender, Descender, Cap Height, x-Height, Line Gap —
  all with sliders + number inputs + a live visual diagram showing guide lines.
- Info tab: Family name, Style name, Version, Description, License.
- Export tab: Pre-export validation (glyph count, stroke warnings, errors),
  separate TTF and OTF download buttons with loading state + success toast.

### Store additions:
- updateMetrics(patch) — partial update to font metrics
- updateMetadata(patch) — partial update to font metadata
