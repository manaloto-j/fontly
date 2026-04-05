# Fontly — Step 9: Snap-to-guides + rendering fix

## Replace:
- src/components/GlyphEditor.tsx

## What changed

### 1. Snap-to-guides during Move tool drag
When dragging with the Move tool (M), the glyph center now snaps to any
visible guide line — Ascender, Cap Height, x-Height, Baseline, Descender.

The snap logic:
- Computes the glyph's visual center Y in canvas space (CANVAS_H/2 + offsetY)
- Finds the nearest visible guide line within 10px threshold
- Locks offsetY so glyph center lands exactly on that guide line
- Highlights the guide line with a snap pulse and colored label
- Shows a snap label ("⊡ Snapped to Baseline") in the guide's color
- X-axis center snap still works (snaps offsetX to 0)

### 2. SVG rendering fix
The previous GlyphEditor used a two-level SVG approach that caused the glyph
to appear tiny. The new approach:
- Outer <g> applies user transforms (scale, rotate, flip, offset) around canvas center
- Inner <svg> uses the glyph's own viewBox with preserveAspectRatio="xMidYMid meet"
  to correctly fill the CANVAS_W × CANVAS_H space
- This ensures the glyph fills the canvas at 1× scale and transforms apply correctly

### 3. Live DOM transform during drag
Transform is applied directly via svgGRef.current.setAttribute() during drag
(no React state update = buttery smooth). React state is only updated on mouseup.
