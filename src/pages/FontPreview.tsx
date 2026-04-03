import { useState, useMemo } from 'react'
import { useFontStore } from '../store/useFontStore'
import { CHAR_GROUPS, toCodepoint } from '../constants/charsets'
import styles from './FontPreview.module.css'

interface FontPreviewProps {
  onBack: () => void
}

const PANGRAM = 'The quick brown fox jumps over the lazy dog.'

const SAMPLE_SENTENCES = [
  'The quick brown fox jumps over the lazy dog.',
  'Pack my box with five dozen liquor jugs.',
  'How vexingly quick daft zebras jump!',
  'Sphinx of black quartz, judge my vow.',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789 !@#$%^&*()',
]

const FONT_SIZES = [12, 16, 24, 32, 48, 64, 96, 128]

export default function FontPreview({ onBack }: FontPreviewProps) {
  const glyphs = useFontStore(s => s.project.glyphs)
  const metadata = useFontStore(s => s.project.metadata)
  const metrics = useFontStore(s => s.project.metrics)

  const [customText, setCustomText] = useState('')
  const [fontSize, setFontSize] = useState(48)
  const [showGrid, setShowGrid] = useState(false)
  const [darkBg, setDarkBg] = useState(false)

  // Count uploaded glyphs
  const uploadedCount = useMemo(() =>
    Object.values(glyphs).filter(g => g.svgContent !== null).length,
    [glyphs]
  )

  const totalCount = useMemo(() => {
    return CHAR_GROUPS.flatMap(g => g.characters).length
  }, [])

  // Build a map of char → svgContent for rendering
  const charMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const group of CHAR_GROUPS) {
      for (const ch of group.characters) {
        const cp = toCodepoint(ch)
        const glyph = glyphs[cp]
        if (glyph?.svgContent) {
          map[ch] = glyph.svgContent
        }
      }
    }
    return map
  }, [glyphs])

  const displayText = customText || PANGRAM

  // Render a string as SVG glyphs inline
  const renderText = (text: string, size: number) => {
    return text.split('').map((char, i) => {
      const svg = charMap[char]
      if (char === ' ') {
        return <span key={i} className={styles.space} style={{ width: size * 0.28 }} />
      }
      if (svg) {
        return (
          <span
            key={i}
            className={styles.glyphChar}
            style={{ width: size * 0.72, height: size }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )
      }
      // Fallback — show the character dimmed
      return (
        <span
          key={i}
          className={styles.fallbackChar}
          style={{ fontSize: size * 0.75, height: size, lineHeight: `${size}px` }}
        >
          {char}
        </span>
      )
    })
  }

  return (
    <div className={`${styles.root} ${darkBg ? styles.dark : ''}`}>

      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={onBack} title="Back to editor">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to editor
        </button>

        <div className={styles.titleBlock}>
          <span className={styles.fontName}>{metadata.familyName}</span>
          <span className={styles.fontMeta}>{uploadedCount} / {totalCount} glyphs · {metrics.unitsPerEm} UPM</span>
        </div>

        <div className={styles.topControls}>
          {/* Dark bg toggle */}
          <button
            className={`${styles.toggleBtn} ${darkBg ? styles.toggleBtnActive : ''}`}
            onClick={() => setDarkBg(d => !d)}
            title="Toggle dark background"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 1a5.5 5.5 0 1 0 5.5 5.5A5.5 5.5 0 0 0 8 1.07" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M6.5 1v11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Dark
          </button>

          {/* Grid toggle */}
          <button
            className={`${styles.toggleBtn} ${showGrid ? styles.toggleBtnActive : ''}`}
            onClick={() => setShowGrid(g => !g)}
            title="Show baseline grid"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1 4h11M1 8h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Grid
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className={styles.body}>

        {/* Left: controls */}
        <aside className={styles.sidebar}>

          {/* Custom text input */}
          <div className={styles.inputSection}>
            <label className={styles.sectionLabel}>Preview text</label>
            <textarea
              className={styles.textInput}
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              placeholder={PANGRAM}
              rows={3}
              maxLength={200}
            />
            <div className={styles.inputHint}>Leave empty for pangram</div>
          </div>

          {/* Quick samples */}
          <div className={styles.samplesSection}>
            <label className={styles.sectionLabel}>Quick samples</label>
            <div className={styles.sampleList}>
              {SAMPLE_SENTENCES.map((s, i) => (
                <button
                  key={i}
                  className={`${styles.sampleBtn} ${customText === s ? styles.sampleBtnActive : ''}`}
                  onClick={() => setCustomText(s)}
                >
                  {s.length > 32 ? s.slice(0, 32) + '…' : s}
                </button>
              ))}
            </div>
          </div>

          {/* Size control */}
          <div className={styles.sizeSection}>
            <label className={styles.sectionLabel}>
              Size
              <span className={styles.sizeVal}>{fontSize}px</span>
            </label>
            <input
              type="range"
              min="12"
              max="160"
              step="2"
              value={fontSize}
              onChange={e => setFontSize(parseInt(e.target.value))}
              className={styles.sizeSlider}
            />
            <div className={styles.sizePresets}>
              {FONT_SIZES.map(s => (
                <button
                  key={s}
                  className={`${styles.sizePreset} ${fontSize === s ? styles.sizePresetActive : ''}`}
                  onClick={() => setFontSize(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Glyph coverage */}
          <div className={styles.coverageSection}>
            <label className={styles.sectionLabel}>Coverage</label>
            <div className={styles.coverageBar}>
              <div
                className={styles.coverageFill}
                style={{ width: `${totalCount > 0 ? (uploadedCount / totalCount) * 100 : 0}%` }}
              />
            </div>
            <div className={styles.coverageLabel}>
              {uploadedCount} of {totalCount} glyphs uploaded
              {uploadedCount === 0 && <span className={styles.coverageHint}> — upload SVGs to see them here</span>}
            </div>

            {/* Which chars in the preview are missing */}
            {uploadedCount > 0 && (() => {
              const missing = [...new Set(displayText.split(''))]
                .filter(c => c !== ' ' && !charMap[c])
              return missing.length > 0 ? (
                <div className={styles.missingChars}>
                  <span className={styles.missingLabel}>Missing in preview:</span>
                  <span className={styles.missingList}>{missing.join(' ')}</span>
                </div>
              ) : null
            })()}
          </div>
        </aside>

        {/* Right: preview canvas */}
        <div className={styles.canvas}>
          {showGrid && (
            <div className={styles.gridLines} style={{ '--line-height': `${fontSize * 1.4}px` } as React.CSSProperties} />
          )}

          {/* Waterfall: multiple sizes */}
          <div className={styles.waterfall}>
            {/* Main size preview */}
            <div className={styles.previewBlock}>
              <div className={styles.previewMeta}>
                <span>{fontSize}px</span>
                <span className={styles.previewMetaDivider}>·</span>
                <span>{metadata.familyName} Regular</span>
              </div>
              <div
                className={styles.textRow}
                style={{ height: fontSize * 1.5 }}
              >
                {renderText(displayText, fontSize)}
              </div>
            </div>

            {/* Waterfall — multiple sizes */}
            <div className={styles.waterfallDivider}>
              <span>Waterfall</span>
            </div>

            {[96, 64, 48, 32, 24, 16].map(size => (
              <div key={size} className={styles.waterfallRow}>
                <span className={styles.waterfallSize}>{size}</span>
                <div
                  className={styles.textRow}
                  style={{ height: size * 1.5 }}
                >
                  {renderText(displayText.slice(0, 40), size)}
                </div>
              </div>
            ))}
          </div>

          {/* Empty state */}
          {uploadedCount === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <rect x="3" y="3" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                  <rect x="18" y="3" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                  <rect x="3" y="18" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                  <rect x="18" y="18" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
              </div>
              <div className={styles.emptyTitle}>No glyphs uploaded yet</div>
              <div className={styles.emptyDesc}>
                Go back to the editor and upload SVGs for your characters.<br />
                They'll appear here in real time.
              </div>
              <button className={styles.emptyBtn} onClick={onBack}>
                Go to editor
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M3 6.5h7M7 3l3.5 3.5L7 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
