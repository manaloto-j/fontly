import { useState, useRef, useEffect } from 'react'
import { useFontStore } from '../store/useFontStore'
import { validateProject } from '../engine/fontExporter'
import styles from './FontPanel.module.css'

type PanelTab = 'metrics' | 'info' | 'export'

// ── Metrics visualization diagram ─────────────────────────────────────────────
function MetricsDiagram() {
  const metrics = useFontStore(s => s.project.metrics)
  const { unitsPerEm, ascender, descender, capHeight, xHeight } = metrics
  const totalH = ascender - descender

  const toPercent = (y: number) =>
    `${((ascender - y) / totalH) * 100}%`

  const LINES = [
    { label: 'Ascender',   y: ascender,  color: '#4a9eff' },
    { label: 'Cap',        y: capHeight, color: '#a78bfa' },
    { label: 'x-Height',   y: xHeight,   color: '#34d399' },
    { label: 'Baseline',   y: 0,         color: '#f59e0b' },
    { label: 'Descender',  y: descender, color: '#f87171' },
  ]

  return (
    <div className={styles.metricsViz}>
      <span className={styles.vizChar} aria-hidden>Hx</span>
      {LINES.map(l => (
        <div
          key={l.label}
          className={styles.vizLine}
          style={{ top: toPercent(l.y), '--guide-color': l.color } as React.CSSProperties}
        >
          <div className={styles.vizLineFill} />
          <span className={styles.vizLineLabel}>{l.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function FontPanel() {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<PanelTab>('metrics')
  const [exporting, setExporting] = useState<'ttf' | 'otf' | null>(null)
  const [exportSuccess, setExportSuccess] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const project = useFontStore(s => s.project)
  const metrics = useFontStore(s => s.project.metrics)
  const metadata = useFontStore(s => s.project.metadata)
  const { updateMetrics, updateMetadata } = useFontStore()

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        !panelRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  const validation = validateProject(project)

  const handleExport = async (format: 'ttf' | 'otf') => {
    if (!validation.valid || exporting) return
    setExporting(format)
    setExportSuccess(null)
    try {
      // Dynamic import so the engine doesn't block the main bundle
      const { exportFont } = await import('../engine/fontExporter')
      const result = await exportFont(project, format)
      if (result.success) {
        setExportSuccess(`${result.fileName} downloaded successfully!`)
        setTimeout(() => setExportSuccess(null), 4000)
      } else {
        alert(`Export failed: ${result.error}`)
      }
    } catch (err) {
      alert(`Export error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(null)
    }
  }

  const SliderField = ({
    label,
    hint,
    value,
    min,
    max,
    step = 1,
    onChange,
  }: {
    label: string
    hint?: string
    value: number
    min: number
    max: number
    step?: number
    onChange: (v: number) => void
  }) => (
    <div className={styles.fieldGroup}>
      <label className={styles.label}>
        {label}
        {hint && <span className={styles.labelHint}>{hint}</span>}
      </label>
      <div className={styles.sliderRow}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className={styles.slider}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || value)}
          className={styles.numInput}
        />
      </div>
    </div>
  )

  return (
    <div style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        className={`${styles.navTrigger} ${open ? styles.navTriggerActive : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Font settings & export"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M6.5 4v2.5l1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        Font settings
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        >
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <>
          <div className={styles.overlay} onClick={() => setOpen(false)} />
          <div ref={panelRef} className={styles.panel}>

            {/* Tabs */}
            <div className={styles.tabs}>
              {(['metrics', 'info', 'export'] as PanelTab[]).map(tab => (
                <button
                  key={tab}
                  className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'metrics' && '📐 '}
                  {tab === 'info' && 'ℹ️ '}
                  {tab === 'export' && '⬇️ '}
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* ── Metrics tab ── */}
            {activeTab === 'metrics' && (
              <div className={styles.content}>
                <MetricsDiagram />

                <SliderField
                  label="Units per Em"
                  hint="em"
                  value={metrics.unitsPerEm}
                  min={500}
                  max={4096}
                  step={1}
                  onChange={v => updateMetrics({ unitsPerEm: v })}
                />

                <div className={styles.divider} />

                <div className={styles.row2}>
                  <SliderField
                    label="Ascender"
                    value={metrics.ascender}
                    min={100}
                    max={metrics.unitsPerEm}
                    onChange={v => updateMetrics({ ascender: v })}
                  />
                  <SliderField
                    label="Descender"
                    hint="negative"
                    value={metrics.descender}
                    min={-metrics.unitsPerEm}
                    max={0}
                    onChange={v => updateMetrics({ descender: v })}
                  />
                </div>

                <div className={styles.row2}>
                  <SliderField
                    label="Cap Height"
                    value={metrics.capHeight}
                    min={100}
                    max={metrics.ascender}
                    onChange={v => updateMetrics({ capHeight: v })}
                  />
                  <SliderField
                    label="x-Height"
                    value={metrics.xHeight}
                    min={100}
                    max={metrics.capHeight}
                    onChange={v => updateMetrics({ xHeight: v })}
                  />
                </div>

                <SliderField
                  label="Line Gap"
                  value={metrics.lineGap}
                  min={0}
                  max={500}
                  onChange={v => updateMetrics({ lineGap: v })}
                />
              </div>
            )}

            {/* ── Info tab ── */}
            {activeTab === 'info' && (
              <div className={styles.content}>
                <p className={styles.sectionHeading}>Identity</p>

                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Family name</label>
                  <input
                    type="text"
                    className={styles.textInput}
                    value={metadata.familyName}
                    onChange={e => updateMetadata({ familyName: e.target.value })}
                    placeholder="Untitled Font"
                    maxLength={64}
                  />
                </div>

                <div className={styles.row2}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Style name</label>
                    <input
                      type="text"
                      className={styles.textInput}
                      value={metadata.styleName}
                      onChange={e => updateMetadata({ styleName: e.target.value })}
                      placeholder="Regular"
                      maxLength={32}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Version</label>
                    <input
                      type="text"
                      className={styles.textInput}
                      value={metadata.version}
                      onChange={e => updateMetadata({ version: e.target.value })}
                      placeholder="1.0"
                      maxLength={16}
                    />
                  </div>
                </div>

                <div className={styles.divider} />

                <p className={styles.sectionHeading}>Details</p>

                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Description</label>
                  <textarea
                    className={styles.textareaInput}
                    value={metadata.description}
                    onChange={e => updateMetadata({ description: e.target.value })}
                    placeholder="A brief description of your font…"
                    rows={3}
                    maxLength={256}
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.label}>License</label>
                  <input
                    type="text"
                    className={styles.textInput}
                    value={metadata.license}
                    onChange={e => updateMetadata({ license: e.target.value })}
                    placeholder="MIT, OFL, Proprietary…"
                    maxLength={128}
                  />
                </div>
              </div>
            )}

            {/* ── Export tab ── */}
            {activeTab === 'export' && (
              <div className={styles.content}>
                <div className={styles.exportSection}>

                  {/* Validation summary */}
                  <div className={styles.validationBox}>
                    <div className={styles.validationRow}>
                      <span>Glyphs ready</span>
                      <strong>{validation.uploadedCount - validation.strokeGlyphs.length} / {validation.totalCount}</strong>
                    </div>
                    <div className={styles.progressBar}>
                      <div
                        className={styles.progressFill}
                        style={{
                          width: `${validation.totalCount > 0
                            ? ((validation.uploadedCount - validation.strokeGlyphs.length) / validation.totalCount) * 100
                            : 0}%`
                        }}
                      />
                    </div>
                    <div className={styles.validationRow}>
                      <span>Em size</span>
                      <strong>{metrics.unitsPerEm} UPM</strong>
                    </div>
                    <div className={styles.validationRow}>
                      <span>Font name</span>
                      <strong>{metadata.familyName} {metadata.styleName}</strong>
                    </div>
                  </div>

                  {/* Warnings */}
                  {(validation.warnings.length > 0 || validation.errors.length > 0) && (
                    <div className={styles.warningList}>
                      {validation.errors.map((e, i) => (
                        <div key={i} className={styles.errorItem}>
                          <span className={styles.warningIcon}>
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <circle cx="6.5" cy="6.5" r="5.5" stroke="#ef4444" strokeWidth="1.2"/>
                              <path d="M6.5 4v3M6.5 9v.5" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round"/>
                            </svg>
                          </span>
                          {e}
                        </div>
                      ))}
                      {validation.warnings.slice(0, 3).map((w, i) => (
                        <div key={i} className={styles.warningItem}>
                          <span className={styles.warningIcon}>
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <path d="M6.5 1.5L12 11H1L6.5 1.5Z" stroke="#d97706" strokeWidth="1.2" strokeLinejoin="round"/>
                              <path d="M6.5 5v2.5M6.5 9.5v.5" stroke="#d97706" strokeWidth="1.3" strokeLinecap="round"/>
                            </svg>
                          </span>
                          {w}
                        </div>
                      ))}
                      {validation.warnings.length > 3 && (
                        <div className={styles.warningItem}>
                          <span className={styles.warningIcon}>⚠</span>
                          +{validation.warnings.length - 3} more warnings
                        </div>
                      )}
                    </div>
                  )}

                  {/* Success toast */}
                  {exportSuccess && (
                    <div className={styles.successToast}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2.5 7l3 3 6-6" stroke="#2d8a5a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      {exportSuccess}
                    </div>
                  )}

                  {/* Export buttons */}
                  <div className={styles.exportButtons}>
                    <button
                      className={`${styles.exportBtn} ${styles.exportBtnTTF} ${!validation.valid ? styles.exportBtnDisabled : ''}`}
                      onClick={() => handleExport('ttf')}
                      disabled={!validation.valid || !!exporting}
                      title="Export as TrueType Font (.ttf)"
                    >
                      {exporting === 'ttf' ? (
                        <svg className={styles.exportBtnLoading} width="18" height="18" viewBox="0 0 18 18" fill="none">
                          <circle cx="9" cy="9" r="7" stroke="white" strokeWidth="2" strokeDasharray="22" strokeDashoffset="8"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                          <path d="M9 2v10M5 8l4 4 4-4" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M3 15h12" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
                        </svg>
                      )}
                      Export TTF
                      <span className={styles.exportBtnLabel}>TrueType font</span>
                    </button>

                    <button
                      className={`${styles.exportBtn} ${styles.exportBtnOTF} ${!validation.valid ? styles.exportBtnDisabled : ''}`}
                      onClick={() => handleExport('otf')}
                      disabled={!validation.valid || !!exporting}
                      title="Export as OpenType Font (.otf)"
                    >
                      {exporting === 'otf' ? (
                        <svg className={styles.exportBtnLoading} width="18" height="18" viewBox="0 0 18 18" fill="none">
                          <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="2" strokeDasharray="22" strokeDashoffset="8"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                          <path d="M9 2v10M5 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M3 15h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                        </svg>
                      )}
                      Export OTF
                      <span className={styles.exportBtnLabel}>OpenType font</span>
                    </button>
                  </div>

                  {/* Help note */}
                  <p style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                    Only glyphs with filled paths (no strokes) are included. Empty glyph slots are skipped — the font will still work for uploaded characters.
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
