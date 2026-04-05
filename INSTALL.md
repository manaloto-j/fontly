# Fontly — Step 8: Bug Fixes

## Replace these 3 files:
- src/engine/fontExporter.ts      ← TTF export fix
- src/components/FontPanel.tsx    ← renamed button + overflow fix
- src/components/FontPanel.module.css ← panel now fixed-position, no overflow

## What was fixed

### 1. TTF exported as OTF (bug)
opentype.js font.download() always produces CFF/OTF binary regardless of filename.
Fix: use font.arrayBuffer({ type: 'truetype' }) for TTF, font.arrayBuffer() for OTF.

### 2. Panel overflows screen
Panel was positioned with left:50% transform — pushed off right edge on small screens.
Fix: position: fixed, top: 56px, right: 12px, max-height: calc(100vh - 68px).
Panel now always stays within viewport, scrolls internally if content is tall.

### 3. Button renamed
"Font settings" → "Export & Settings"
Export tab is now the default tab when panel opens.
Tab order changed to: Export | Metrics | Info
