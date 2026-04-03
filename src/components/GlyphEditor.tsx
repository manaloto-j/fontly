import { useCallback, useEffect, useRef, useState } from 'react'
import { useFontStore } from '../store/useFontStore'
import { CHAR_GROUPS, toCodepoint } from '../constants/charsets'
import { GlyphAdjustments } from '../types/font'
import styles from './GlyphEditor.module.css'

interface GlyphEditorProps {
  codepoint: string
  onClose: () => void
}

function useOrderedCodepoints() {
  const specialCharsEnabled = useFontStore(s => s.project.specialCharsEnabled)
  const groups = CHAR_GROUPS.filter(g => !g.special || specialCharsEnabled)
  return groups.flatMap(g => g.characters.map(toCodepoint))
}

const GUIDE_LINES = [
  { key: 'ascender',  label: 'Ascender',  defaultY: 0.08, color: '#4a9eff' },
  { key: 'capHeight', label: 'Cap Height', defaultY: 0.18, color: '#a78bfa' },
  { key: 'xHeight',   label: 'x-Height',   defaultY: 0.38, color: '#34d399' },
  { key: 'baseline',  label: 'Baseline',   defaultY: 0.75, color: '#f59e0b' },
  { key: 'descender', label: 'Descender',  defaultY: 0.88, color: '#f87171' },
]

const DEFAULT_ADJUSTMENTS: GlyphAdjustments = {
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
}

// ── Local history for undo within glyph editor ────────────────────────────────
function useAdjustmentHistory(initial: GlyphAdjustments) {
  const [stack, setStack] = useState<GlyphAdjustments[]>([initial])
  const [index, setIndex] = useState(0)

  const push = useCallback((adj: GlyphAdjustments) => {
    setStack(prev => {
      const next = prev.slice(0, index + 1)
      next.push({ ...adj })
      if (next.length > 60) next.shift()
      return next
    })
    setIndex(prev => Math.min(prev + 1, 59))
  }, [index])

  const undo = useCallback(() => {
    if (index <= 0) return null
    const newIndex = index - 1
    setIndex(newIndex)
    return stack[newIndex]
  }, [index, stack])

  const redo = useCallback(() => {
    if (index >= stack.length - 1) return null
    const newIndex = index + 1
    setIndex(newIndex)
    return stack[newIndex]
  }, [index, stack])

  const canUndo = index > 0
  const canRedo = index < stack.length - 1
  const current = stack[index]

  return { current, push, undo, redo, canUndo, canRedo }
}

export default function GlyphEditor({ codepoint, onClose }: GlyphEditorProps) {
  const glyphs = useFontStore(s => s.project.glyphs)
  const updateAdjustments = useFontStore(s => s.updateAdjustments)
  const uploadGlyph = useFontStore(s => s.uploadGlyph)
  const specialCharsEnabled = useFontStore(s => s.project.specialCharsEnabled)

  const orderedCps = useOrderedCodepoints()
  const currentIndex = orderedCps.indexOf(codepoint)

  const glyph = glyphs[codepoint]
  const storedAdj: GlyphAdjustments = { ...DEFAULT_ADJUSTMENTS, ...(glyph?.adjustments ?? {}) }

  // Local adjustment history for per-editor Ctrl+Z
  const adjHistory = useAdjustmentHistory(storedAdj)
  const adj = adjHistory.current

  const allChars = CHAR_GROUPS.filter(g => !g.special || specialCharsEnabled)
    .flatMap(g => g.characters)
  const char = allChars.find(ch => toCodepoint(ch) === codepoint) ?? '?'

  const [visibleGuides, setVisibleGuides] = useState<Record<string, boolean>>({
    ascender: true, capHeight: true, xHeight: true, baseline: true, descender: true,
    leftBearing: true, rightBearing: true,
  })

  const [activeTab, setActiveTab] = useState<'transform' | 'spacing' | 'guides'>('transform')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const goTo = useCallback((dir: -1 | 1) => {
    const nextIndex = currentIndex + dir
    if (nextIndex < 0 || nextIndex >= orderedCps.length) return
    const event = new CustomEvent('glyph-navigate', { detail: orderedCps[nextIndex] })
    window.dispatchEvent(event)
  }, [currentIndex, orderedCps])

  // Keyboard shortcuts — Ctrl+Z / Ctrl+Y for local undo in editor
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowLeft' && (e.ctrlKey || e.metaKey || e.altKey)) { e.preventDefault(); goTo(-1) }
      if (e.key === 'ArrowRight' && (e.ctrlKey || e.metaKey || e.altKey)) { e.preventDefault(); goTo(1) }

      // Local undo/redo for adjustments
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation() // prevent global undo
        const prev = adjHistory.undo()
        if (prev) updateAdjustments(codepoint, prev)
      }
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        e.stopPropagation()
        const next = adjHistory.redo()
        if (next) updateAdjustments(codepoint, next)
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [onClose, goTo, adjHistory, codepoint, updateAdjustments])

  // Update both local history and store
  const update = (patch: Partial<GlyphAdjustments>) => {
    const next = { ...adj, ...patch }
    adjHistory.push(next)
    updateAdjustments(codepoint, next)
  }

  const handleUpload = () => fileInputRef.current?.click()
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => uploadGlyph(codepoint, ev.target?.result as string, file.name)
    reader.readAsText(file)
    e.target.value = ''
  }

  const resetAdj = () => {
    adjHistory.push(DEFAULT_ADJUSTMENTS)
    updateAdjustments(codepoint, DEFAULT_ADJUSTMENTS)
  }

  // ── Build SVG transform for live preview ────────────────────────────────────
  // Use SVG-native transform on the wrapper for accurate visual representation
  // that matches what the export engine will produce.
  const CANVAS_W = 480
  const CANVAS_H = 520

  // Center of canvas for transform origin
  const cx = CANVAS_W / 2
  const cy = CANVAS_H / 2

  // Build SVG transform string applied to a <g> wrapping the SVG content.
  // Order: translate(offset) → rotate(around center) → scale(around center) → flip
  const buildSVGTransform = () => {
    const parts: string[] = []

    // Translate to center, apply transforms, translate back
    parts.push(`translate(${cx}, ${cy})`)
    if (adj.rotate !== 0) parts.push(`rotate(${adj.rotate})`)
    parts.push(`scale(${adj.scaleX * (adj.flipH ? -1 : 1)}, ${adj.scaleY * (adj.flipV ? -1 : 1)})`)
    parts.push(`translate(${-cx + adj.offsetX}, ${-cy + adj.offsetY})`)

    return parts.join(' ')
  }

  return (
    <div className={styles.root}>
      <input ref={fileInputRef} type="file" accept=".svg" style={{ display: 'none' }} onChange={handleFileChange} />

      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={onClose} title="Back to grid (Esc)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to grid
        </button>

        <div className={styles.glyphTitle}>
          <span className={styles.glyphChar}>{char}</span>
          <div className={styles.glyphMeta}>
            <span className={styles.glyphCp}>{codepoint}</span>
            <span className={styles.glyphStatus}>
              {glyph?.svgContent ? (
                <><span className={styles.dotGreen} />Uploaded</>
              ) : (
                <><span className={styles.dotGray} />Empty</>
              )}
            </span>
          </div>
        </div>

        {/* Local undo/redo indicators */}
        <div className={styles.localUndoRow}>
          <button
            className={styles.localUndoBtn}
            onClick={() => { const p = adjHistory.undo(); if (p) updateAdjustments(codepoint, p) }}
            disabled={!adjHistory.canUndo}
            title="Undo transform change (Ctrl+Z)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 4h5a3 3 0 0 1 0 6H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 4l2.5-2.5M2 4l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className={styles.localUndoBtn}
            onClick={() => { const n = adjHistory.redo(); if (n) updateAdjustments(codepoint, n) }}
            disabled={!adjHistory.canRedo}
            title="Redo transform change (Ctrl+Y)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M10 4H5a3 3 0 0 0 0 6h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M10 4l-2.5-2.5M10 4l-2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div className={styles.navButtons}>
          <button
            className={styles.navBtn}
            onClick={() => goTo(-1)}
            disabled={currentIndex <= 0}
            title="Previous glyph (Alt+←)"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M8 2L3.5 6.5 8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span className={styles.navCount}>{currentIndex + 1} / {orderedCps.length}</span>
          <button
            className={styles.navBtn}
            onClick={() => goTo(1)}
            disabled={currentIndex >= orderedCps.length - 1}
            title="Next glyph (Alt+→)"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M5 2l4.5 4.5L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className={styles.body}>

        {/* Canvas area */}
        <div className={styles.canvasArea}>
          <div className={styles.canvas} style={{ width: CANVAS_W, height: CANVAS_H }}>

            {/* Guide lines */}
            {GUIDE_LINES.map(g => visibleGuides[g.key] && (
              <div
                key={g.key}
                className={styles.guideLine}
                style={{ top: `${g.defaultY * 100}%`, '--guide-color': g.color } as React.CSSProperties}
              >
                <span className={styles.guideLabel}>{g.label}</span>
              </div>
            ))}

            {/* Left/right bearing lines */}
            {visibleGuides.leftBearing && (
              <div
                className={styles.guideLineV}
                style={{ left: `${(adj.leftBearing / adj.advanceWidth) * 100}%`, '--guide-color': '#94a3b8' } as React.CSSProperties}
              />
            )}
            {visibleGuides.rightBearing && (
              <div
                className={styles.guideLineV}
                style={{ right: `${(adj.leftBearing / adj.advanceWidth) * 100}%`, '--guide-color': '#94a3b8' } as React.CSSProperties}
              />
            )}

            {/* SVG content — rendered as an inline SVG so transforms are native */}
            {glyph?.svgContent ? (
              <div className={styles.svgWrapper}>
                <svg
                  width={CANVAS_W}
                  height={CANVAS_H}
                  viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
                  style={{ position: 'absolute', inset: 0 }}
                >
                  <g transform={buildSVGTransform()}>
                    {/* Embed the glyph SVG content via foreignObject workaround:
                        We parse and inline the SVG's inner content */}
                    <image
                      href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(glyph.svgContent)}`}
                      x={0}
                      y={0}
                      width={CANVAS_W}
                      height={CANVAS_H}
                      preserveAspectRatio="xMidYMid meet"
                    />
                  </g>
                </svg>
              </div>
            ) : (
              <div className={styles.emptyCanvas}>
                <div className={styles.emptyChar}>{char}</div>
                <button className={styles.uploadBtn} onClick={handleUpload}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 2v7M4 5l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M2 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  Upload SVG
                </button>
              </div>
            )}

            {/* Replace button */}
            {glyph?.svgContent && (
              <button className={styles.replaceBtn} onClick={handleUpload} title="Replace SVG">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M5.5 1v5M3 4l2.5-3L8 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M1 8h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                Replace
              </button>
            )}
          </div>

          {/* Canvas bottom info bar */}
          <div className={styles.canvasInfo}>
            <span>Em: 1000 UPM</span>
            <span>Advance: {adj.advanceWidth}u</span>
            <span>LSB: {adj.leftBearing}u</span>
            <span>Rotate: {adj.rotate}°</span>
            <span>Scale: {adj.scaleX.toFixed(2)}×{adj.scaleY.toFixed(2)}</span>
          </div>
        </div>

        {/* Controls panel */}
        <div className={styles.controls}>
          <div className={styles.tabs}>
            {(['transform', 'spacing', 'guides'] as const).map(tab => (
              <button
                key={tab}
                className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <div className={styles.tabContent}>

            {/* ── Transform tab ── */}
            {activeTab === 'transform' && (
              <div className={styles.section}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Scale X</label>
                  <div className={styles.sliderRow}>
                    <input type="range" min="0.1" max="3" step="0.01"
                      value={adj.scaleX}
                      onChange={e => update({ scaleX: parseFloat(e.target.value) })}
                      className={styles.slider}
                    />
                    <input type="number" min="0.1" max="3" step="0.01"
                      value={adj.scaleX.toFixed(2)}
                      onChange={e => update({ scaleX: parseFloat(e.target.value) || 1 })}
                      className={styles.numInput}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Scale Y</label>
                  <div className={styles.sliderRow}>
                    <input type="range" min="0.1" max="3" step="0.01"
                      value={adj.scaleY}
                      onChange={e => update({ scaleY: parseFloat(e.target.value) })}
                      className={styles.slider}
                    />
                    <input type="number" min="0.1" max="3" step="0.01"
                      value={adj.scaleY.toFixed(2)}
                      onChange={e => update({ scaleY: parseFloat(e.target.value) || 1 })}
                      className={styles.numInput}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Offset X</label>
                  <div className={styles.sliderRow}>
                    <input type="range" min="-200" max="200" step="1"
                      value={adj.offsetX}
                      onChange={e => update({ offsetX: parseInt(e.target.value) })}
                      className={styles.slider}
                    />
                    <input type="number" min="-200" max="200" step="1"
                      value={adj.offsetX}
                      onChange={e => update({ offsetX: parseInt(e.target.value) || 0 })}
                      className={styles.numInput}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Offset Y</label>
                  <div className={styles.sliderRow}>
                    <input type="range" min="-200" max="200" step="1"
                      value={adj.offsetY}
                      onChange={e => update({ offsetY: parseInt(e.target.value) })}
                      className={styles.slider}
                    />
                    <input type="number" min="-200" max="200" step="1"
                      value={adj.offsetY}
                      onChange={e => update({ offsetY: parseInt(e.target.value) || 0 })}
                      className={styles.numInput}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Rotate</label>
                  <div className={styles.sliderRow}>
                    <input type="range" min="-180" max="180" step="0.5"
                      value={adj.rotate}
                      onChange={e => update({ rotate: parseFloat(e.target.value) })}
                      className={styles.slider}
                    />
                    <input type="number" min="-180" max="180" step="0.5"
                      value={adj.rotate}
                      onChange={e => update({ rotate: parseFloat(e.target.value) || 0 })}
                      className={styles.numInput}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Baseline shift</label>
                  <div className={styles.sliderRow}>
                    <input type="range" min="-200" max="200" step="1"
                      value={adj.baseline}
                      onChange={e => update({ baseline: parseInt(e.target.value) })}
                      className={styles.slider}
                    />
                    <input type="number" min="-200" max="200" step="1"
                      value={adj.baseline}
                      onChange={e => update({ baseline: parseInt(e.target.value) || 0 })}
                      className={styles.numInput}
                    />
                  </div>
                </div>

                {/* Flip buttons */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Flip</label>
                  <div className={styles.flipRow}>
                    <button
                      className={`${styles.flipBtn} ${adj.flipH ? styles.flipBtnActive : ''}`}
                      onClick={() => update({ flipH: !adj.flipH })}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M7 2v10M4 4L2 7l2 3M10 4l2 3-2 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Horizontal
                    </button>
                    <button
                      className={`${styles.flipBtn} ${adj.flipV ? styles.flipBtnActive : ''}`}
                      onClick={() => update({ flipV: !adj.flipV })}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7h10M4 4L7 2l3 2M4 10l3 2 3-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Vertical
                    </button>
                  </div>
                </div>

                <button className={styles.resetBtn} onClick={resetAdj}>
                  Reset all transforms
                </button>
              </div>
            )}

            {/* ── Spacing tab ── */}
            {activeTab === 'spacing' && (
              <div className={styles.section}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Advance width <span className={styles.unit}>units</span></label>
                  <div className={styles.sliderRow}>
                    <input type="range" min="0" max="1200" step="1"
                      value={adj.advanceWidth}
                      onChange={e => update({ advanceWidth: parseInt(e.target.value) })}
                      className={styles.slider}
                    />
                    <input type="number" min="0" max="1200" step="1"
                      value={adj.advanceWidth}
                      onChange={e => update({ advanceWidth: parseInt(e.target.value) || 600 })}
                      className={styles.numInput}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Left side bearing <span className={styles.unit}>units</span></label>
                  <div className={styles.sliderRow}>
                    <input type="range" min="0" max="400" step="1"
                      value={adj.leftBearing}
                      onChange={e => update({ leftBearing: parseInt(e.target.value) })}
                      className={styles.slider}
                    />
                    <input type="number" min="0" max="400" step="1"
                      value={adj.leftBearing}
                      onChange={e => update({ leftBearing: parseInt(e.target.value) || 0 })}
                      className={styles.numInput}
                    />
                  </div>
                </div>

                <div className={styles.infoBox}>
                  <div className={styles.infoRow}>
                    <span>Right side bearing</span>
                    <strong>{Math.max(0, adj.advanceWidth - adj.leftBearing - 400)}u</strong>
                  </div>
                  <div className={styles.infoRow}>
                    <span>Total advance</span>
                    <strong>{adj.advanceWidth}u</strong>
                  </div>
                  <div className={styles.infoRow}>
                    <span>At 16px</span>
                    <strong>{(adj.advanceWidth / 1000 * 16).toFixed(1)}px</strong>
                  </div>
                </div>

                {/* Spacing visualizer */}
                <div className={styles.spacingViz}>
                  <div className={styles.spacingTrack}>
                    <div
                      className={styles.spacingLSB}
                      style={{ width: `${(adj.leftBearing / adj.advanceWidth) * 100}%` }}
                    />
                    <div className={styles.spacingGlyph}>
                      <span>{char}</span>
                    </div>
                    <div className={styles.spacingRSB} style={{ flex: 1 }} />
                  </div>
                  <div className={styles.spacingLabels}>
                    <span>LSB</span>
                    <span>Glyph</span>
                    <span>RSB</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Guides tab ── */}
            {activeTab === 'guides' && (
              <div className={styles.section}>
                <p className={styles.guidesNote}>Toggle guide line visibility on the canvas.</p>

                {GUIDE_LINES.map(g => (
                  <div key={g.key} className={styles.guideToggleRow}>
                    <span className={styles.guideColorDot} style={{ background: g.color }} />
                    <span className={styles.guideName}>{g.label}</span>
                    <button
                      className={`${styles.toggleSmall} ${visibleGuides[g.key] ? styles.toggleSmallOn : ''}`}
                      onClick={() => setVisibleGuides(prev => ({ ...prev, [g.key]: !prev[g.key] }))}
                      role="switch"
                      aria-checked={visibleGuides[g.key]}
                    >
                      <span className={styles.toggleSmallThumb} />
                    </button>
                  </div>
                ))}

                <div className={styles.guideDivider} />

                <div className={styles.guideToggleRow}>
                  <span className={styles.guideColorDot} style={{ background: '#94a3b8' }} />
                  <span className={styles.guideName}>Left bearing</span>
                  <button
                    className={`${styles.toggleSmall} ${visibleGuides.leftBearing ? styles.toggleSmallOn : ''}`}
                    onClick={() => setVisibleGuides(prev => ({ ...prev, leftBearing: !prev.leftBearing }))}
                    role="switch"
                    aria-checked={visibleGuides.leftBearing}
                  >
                    <span className={styles.toggleSmallThumb} />
                  </button>
                </div>

                <div className={styles.guideToggleRow}>
                  <span className={styles.guideColorDot} style={{ background: '#94a3b8' }} />
                  <span className={styles.guideName}>Right bearing</span>
                  <button
                    className={`${styles.toggleSmall} ${visibleGuides.rightBearing ? styles.toggleSmallOn : ''}`}
                    onClick={() => setVisibleGuides(prev => ({ ...prev, rightBearing: !prev.rightBearing }))}
                    role="switch"
                    aria-checked={visibleGuides.rightBearing}
                  >
                    <span className={styles.toggleSmallThumb} />
                  </button>
                </div>

                <div className={styles.guideDivider} />

                <button
                  className={styles.resetBtn}
                  onClick={() => setVisibleGuides({
                    ascender: true, capHeight: true, xHeight: true,
                    baseline: true, descender: true, leftBearing: true, rightBearing: true,
                  })}
                >
                  Show all guides
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
