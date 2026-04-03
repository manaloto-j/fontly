import { useCallback, useEffect, useRef, useState } from 'react'
import { useFontStore } from '../store/useFontStore'
import { CHAR_GROUPS, toCodepoint } from '../constants/charsets'
import { GlyphAdjustments } from '../types/font'
import styles from './GlyphEditor.module.css'

interface GlyphEditorProps {
  codepoint: string
  onClose: () => void
}

// Flat ordered list of all visible codepoints
function useOrderedCodepoints() {
  const specialCharsEnabled = useFontStore(s => s.project.specialCharsEnabled)
  const groups = CHAR_GROUPS.filter(g => !g.special || specialCharsEnabled)
  return groups.flatMap(g => g.characters.map(toCodepoint))
}

const GUIDE_LINES = [
  { key: 'ascender',   label: 'Ascender',   defaultY: 0.08,  color: '#4a9eff' },
  { key: 'capHeight',  label: 'Cap Height',  defaultY: 0.18,  color: '#a78bfa' },
  { key: 'xHeight',    label: 'x-Height',    defaultY: 0.38,  color: '#34d399' },
  { key: 'baseline',   label: 'Baseline',    defaultY: 0.75,  color: '#f59e0b' },
  { key: 'descender',  label: 'Descender',   defaultY: 0.88,  color: '#f87171' },
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

export default function GlyphEditor({ codepoint, onClose }: GlyphEditorProps) {
  const glyphs = useFontStore(s => s.project.glyphs)
  const updateAdjustments = useFontStore(s => s.updateAdjustments)
  const uploadGlyph = useFontStore(s => s.uploadGlyph)
  const specialCharsEnabled = useFontStore(s => s.project.specialCharsEnabled)

  const orderedCps = useOrderedCodepoints()
  const currentIndex = orderedCps.indexOf(codepoint)

  const glyph = glyphs[codepoint]
  const adj: GlyphAdjustments = { ...DEFAULT_ADJUSTMENTS, ...(glyph?.adjustments ?? {}) }

  // Find character from codepoint
  const allChars = CHAR_GROUPS.filter(g => !g.special || specialCharsEnabled)
    .flatMap(g => g.characters)
  const char = allChars.find(ch => toCodepoint(ch) === codepoint) ?? '?'

  const [visibleGuides, setVisibleGuides] = useState<Record<string, boolean>>({
    ascender: true, capHeight: true, xHeight: true, baseline: true, descender: true,
    leftBearing: true, rightBearing: true,
  })

  const [activeTab, setActiveTab] = useState<'transform' | 'spacing' | 'guides'>('transform')
  const [dragging, setDragging] = useState<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Navigate to prev/next
  const goTo = useCallback((dir: -1 | 1) => {
    const nextIndex = currentIndex + dir
    if (nextIndex < 0 || nextIndex >= orderedCps.length) return
    // We bubble up via a custom event so Editor.tsx can update activeCodepoint
    const event = new CustomEvent('glyph-navigate', { detail: orderedCps[nextIndex] })
    window.dispatchEvent(event)
  }, [currentIndex, orderedCps])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && (e.ctrlKey || e.metaKey || e.altKey)) { e.preventDefault(); goTo(-1) }
      if (e.key === 'ArrowRight' && (e.ctrlKey || e.metaKey || e.altKey)) { e.preventDefault(); goTo(1) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, goTo])

  const update = (patch: Partial<GlyphAdjustments>) => {
    updateAdjustments(codepoint, { ...adj, ...patch })
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

  const resetAdj = () => updateAdjustments(codepoint, DEFAULT_ADJUSTMENTS)

  // Build SVG transform string for preview
  const svgTransform = [
    `scale(${adj.flipH ? -1 : 1} ${adj.flipV ? -1 : 1})`,
    `rotate(${adj.rotate})`,
    `translate(${adj.offsetX} ${adj.offsetY})`,
    `scale(${adj.scaleX} ${adj.scaleY})`,
  ].join(' ')

  const CANVAS_W = 480
  const CANVAS_H = 520

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
          <div
            ref={canvasRef}
            className={styles.canvas}
            style={{ width: CANVAS_W, height: CANVAS_H }}
          >
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

            {/* Left bearing line */}
            {visibleGuides.leftBearing && (
              <div
                className={styles.guideLineV}
                style={{ left: `${(adj.leftBearing / adj.advanceWidth) * 100}%`, '--guide-color': '#94a3b8' } as React.CSSProperties}
              />
            )}

            {/* Right bearing line */}
            {visibleGuides.rightBearing && (
              <div
                className={styles.guideLineV}
                style={{ right: `${(adj.leftBearing / adj.advanceWidth) * 100}%`, '--guide-color': '#94a3b8' } as React.CSSProperties}
              />
            )}

            {/* Baseline horizontal emphasis */}
            <div className={styles.baselineEmphasis} style={{ top: '75%' }} />

            {/* SVG content */}
            {glyph?.svgContent ? (
              <div
                className={styles.svgWrapper}
                style={{
                  transform: svgTransform,
                  transformOrigin: 'center center',
                }}
                dangerouslySetInnerHTML={{ __html: glyph.svgContent }}
              />
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

            {/* Replace button when filled */}
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
          </div>
        </div>

        {/* Controls panel */}
        <div className={styles.controls}>
          {/* Tab bar */}
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
                    <div
                      className={styles.spacingRSB}
                      style={{ flex: 1 }}
                    />
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
                    <span
                      className={styles.guideColorDot}
                      style={{ background: g.color }}
                    />
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
