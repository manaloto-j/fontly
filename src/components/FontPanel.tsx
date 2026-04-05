import { useState, useRef, useEffect } from 'react'
import { useFontStore } from '../store/useFontStore'
import { validateProject } from '../engine/fontExporter'
import styles from './FontPanel.module.css'

type PanelTab = 'metrics' | 'info' | 'export'

// ── Metrics visualization ──────────────────────────────────────────────────────
function MetricsDiagram() {
  const metrics = useFontStore(s => s.project.metrics)
  const { ascender, descender, capHeight, xHeight } = metrics
  const totalH = ascender - descender
  const toPercent = (y: number) => `${((ascender - y) / totalH) * 100}%`

  const LINES = [
    { label: 'Ascender',  y: ascender,  color: '#4a9eff' },
    { label: 'Cap',       y: capHeight, color: '#a78bfa' },
    { label: 'x-Height',  y: xHeight,   color: '#34d399' },
    { label: 'Baseline',  y: 0,         color: '#f59e0b' },
    { label: 'Descender', y: descender, color: '#f87171' },
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

// ── Confirmation modal ─────────────────────────────────────────────────────────
interface ConfirmModalProps {
  format: 'ttf' | 'otf'
  missingUppercase: string[]
  strokeCount: number
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmModal({ format, missingUppercase, strokeCount, onConfirm, onCancel }: ConfirmModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div className={styles.modalBackdrop} onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalIcon}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L14 13H2L8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              <path d="M8 6v3M8 11v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div className={styles.modalTitle}>Incomplete font — export anyway?</div>
            <div className={styles.modalSubtitle}>Exporting as .{format.toUpperCase()}</div>
          </div>
        </div>

        <div className={styles.modalBody}>
          {missingUppercase.length > 0 && (
            <div className={styles.modalSection}>
              <div className={styles.modalSectionTitle}>
                Missing uppercase letters ({missingUppercase.length} of 26)
              </div>
              <div className={styles.missingGrid}>
                {missingUppercase.map(ch => (
                  <span key={ch} className={styles.missingChar}>{ch}</span>
                ))}
              </div>
              <p className={styles.modalWarningText}>
                Characters without glyphs will render as the fallback box in apps.
              </p>
            </div>
          )}
          {strokeCount > 0 && (
            <div className={styles.modalSection}>
              <div className={styles.modalSectionTitle}>Stroke glyphs will be skipped</div>
              <p className={styles.modalWarningText}>
                {strokeCount} glyph{strokeCount === 1 ? '' : 's'} use strokes and won't be included. Convert strokes to outlines in your SVG editor.
              </p>
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.modalCancelBtn} onClick={onCancel}>Cancel</button>
          <button className={styles.modalConfirmBtn} onClick={onConfirm}>Export anyway</button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function FontPanel() {
  const [open, setOpen] = useState(false)
  // Default to export tab — that's what users most often want
  const [activeTab, setActiveTab] = useState<PanelTab>('export')
  const [exporting, setExporting] = useState<'ttf' | 'otf' | null>(null)
  const [exportSuccess, setExportSuccess] = useState<string | null>(null)
  const [pendingExport, setPendingExport] = useState<'ttf' | 'otf' | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const project = useFontStore(s => s.project)
  const metrics = useFontStore(s => s.project.metrics)
  const metadata = useFontStore(s => s.project.metadata)
  const { updateMetrics, updateMetadata } = useFontStore()

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open && !pendingExport) setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, pendingExport])

  const validation = validateProject(project)

  const doExport = async (format: 'ttf' | 'otf') => {
    setExporting(format)
    setExportSuccess(null)
    try {
      const { exportFont } = await import('../engine/fontExporter')
      const result = await exportFont(project, format)
      if (result.success) {
        setExportSuccess(`${result.fileName} downloaded!`)
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

  const handleExport = (format: 'ttf' | 'otf') => {
    if (exporting) return
    if (validation.uploadedCount === 0) return
    if (validation.valid) { doExport(format); return }
    if (validation.canExportWithWarning) setPendingExport(format)
  }

  const isExportBlocked = validation.uploadedCount === 0

  const SliderField = ({
    label, hint, value, min, max, step = 1, onChange,
  }: {
    label: string; hint?: string; value: number; min: number; max: number; step?: number
    onChange: (v: number) => void
  }) => (
    <div className={styles.fieldGroup}>
      <label className={styles.label}>
        {label}
        {hint && <span className={styles.labelHint}>{hint}</span>}
      </label>
      <div className={styles.sliderRow}>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))} className={styles.slider} />
        <input type="number" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value) || value)} className={styles.numInput} />
      </div>
    </div>
  )

  return (
    <>
      {pendingExport && (
        <ConfirmModal
          format={pendingExport}
          missingUppercase={validation.missingUppercase}
          strokeCount={validation.strokeGlyphs.length}
          onConfirm={() => { const f = pendingExport; setPendingExport(null); if (f) doExport(f) }}
          onCancel={() => setPendingExport(null)}
        />
      )}

      {/* Overlay to close on outside click */}
      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)} />
      )}

      {/* ── Trigger button — renamed to "Export & Settings" ── */}
      <button
        ref={triggerRef}
        className={`${styles.navTrigger} ${open ? styles.navTriggerActive : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Export font or adjust font settings"
      >
        {/* Download icon */}
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M6.5 2v6M4 6l2.5 2.5L9 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M2 10h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        Export & Settings
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        >
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>

      {/* ── Panel — fixed position, anchored to top-right, never overflows ── */}
      {open && (
        <div className={styles.panel}>
          {/* Tabs */}
          <div className={styles.tabs}>
            {(['export', 'metrics', 'info'] as PanelTab[]).map(tab => (
              <button
                key={tab}
                className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'export'  && '⬇️ '}
                {tab === 'metrics' && '📐 '}
                {tab === 'info'    && 'ℹ️ '}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* ── Export tab ── */}
          {activeTab === 'export' && (
            <div className={styles.content}>
              <div className={styles.exportSection}>
                <div className={styles.validationBox}>
                  <div className={styles.validationRow}>
                    <span>Uppercase A–Z</span>
                    <strong style={{ color: validation.uppercaseComplete ? '#4caf7d' : '#d97706' }}>
                      {26 - validation.missingUppercase.length} / 26
                    </strong>
                  </div>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{
                        width: `${((26 - validation.missingUppercase.length) / 26) * 100}%`,
                        background: validation.uppercaseComplete ? '#4caf7d' : '#f59e0b',
                      }}
                    />
                  </div>
                  <div className={styles.validationRow}>
                    <span>Total glyphs</span>
                    <strong>{validation.uploadedCount} / {validation.totalCount}</strong>
                  </div>
                  <div className={styles.validationRow}>
                    <span>Font name</span>
                    <strong>{metadata.familyName} {metadata.styleName}</strong>
                  </div>
                  <div className={styles.validationRow}>
                    <span>Em size</span>
                    <strong>{metrics.unitsPerEm} UPM</strong>
                  </div>
                </div>

                {validation.missingUppercase.length > 0 && (
                  <div className={styles.warningList}>
                    <div className={styles.warningItem}>
                      <span className={styles.warningIcon}>
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                          <path d="M6.5 1.5L12 11H1L6.5 1.5Z" stroke="#d97706" strokeWidth="1.2" strokeLinejoin="round"/>
                          <path d="M6.5 5v2.5M6.5 9.5v.5" stroke="#d97706" strokeWidth="1.3" strokeLinecap="round"/>
                        </svg>
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ marginBottom: 6 }}>
                          {validation.missingUppercase.length} uppercase letter{validation.missingUppercase.length === 1 ? '' : 's'} missing
                        </div>
                        <div className={styles.missingGrid}>
                          {validation.missingUppercase.map(ch => (
                            <span key={ch} className={styles.missingChar}>{ch}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {validation.strokeGlyphs.length > 0 && (
                  <div className={styles.warningList}>
                    <div className={styles.warningItem}>
                      <span className={styles.warningIcon}>⚠</span>
                      {validation.strokeGlyphs.length} glyph{validation.strokeGlyphs.length === 1 ? '' : 's'} with strokes will be skipped.
                    </div>
                  </div>
                )}

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

                {exportSuccess && (
                  <div className={styles.successToast}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2.5 7l3 3 6-6" stroke="#2d8a5a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    {exportSuccess}
                  </div>
                )}

                <div className={styles.exportButtons}>
                  <button
                    className={`${styles.exportBtn} ${styles.exportBtnTTF} ${isExportBlocked ? styles.exportBtnDisabled : ''}`}
                    onClick={() => handleExport('ttf')}
                    disabled={isExportBlocked || !!exporting}
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
                    className={`${styles.exportBtn} ${styles.exportBtnOTF} ${isExportBlocked ? styles.exportBtnDisabled : ''}`}
                    onClick={() => handleExport('otf')}
                    disabled={isExportBlocked || !!exporting}
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

                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
                  All 26 uppercase letters are recommended. Missing glyphs will render as a fallback box in apps.
                </p>
              </div>
            </div>
          )}

          {/* ── Metrics tab ── */}
          {activeTab === 'metrics' && (
            <div className={styles.content}>
              <MetricsDiagram />

              <SliderField label="Units per Em" hint="em"
                value={metrics.unitsPerEm} min={500} max={4096} step={1}
                onChange={v => updateMetrics({ unitsPerEm: v })} />

              <div className={styles.divider} />

              <div className={styles.row2}>
                <SliderField label="Ascender"
                  value={metrics.ascender} min={100} max={metrics.unitsPerEm}
                  onChange={v => updateMetrics({ ascender: v })} />
                <SliderField label="Descender" hint="negative"
                  value={metrics.descender} min={-metrics.unitsPerEm} max={0}
                  onChange={v => updateMetrics({ descender: v })} />
              </div>

              <div className={styles.row2}>
                <SliderField label="Cap Height"
                  value={metrics.capHeight} min={100} max={metrics.ascender}
                  onChange={v => updateMetrics({ capHeight: v })} />
                <SliderField label="x-Height"
                  value={metrics.xHeight} min={100} max={metrics.capHeight}
                  onChange={v => updateMetrics({ xHeight: v })} />
              </div>

              <SliderField label="Line Gap"
                value={metrics.lineGap} min={0} max={500}
                onChange={v => updateMetrics({ lineGap: v })} />
            </div>
          )}

          {/* ── Info tab ── */}
          {activeTab === 'info' && (
            <div className={styles.content}>
              <p className={styles.sectionHeading}>Identity</p>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Family name</label>
                <input type="text" className={styles.textInput}
                  value={metadata.familyName}
                  onChange={e => updateMetadata({ familyName: e.target.value })}
                  placeholder="Untitled Font" maxLength={64} />
              </div>

              <div className={styles.row2}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Style name</label>
                  <input type="text" className={styles.textInput}
                    value={metadata.styleName}
                    onChange={e => updateMetadata({ styleName: e.target.value })}
                    placeholder="Regular" maxLength={32} />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Version</label>
                  <input type="text" className={styles.textInput}
                    value={metadata.version}
                    onChange={e => updateMetadata({ version: e.target.value })}
                    placeholder="1.0" maxLength={16} />
                </div>
              </div>

              <div className={styles.divider} />
              <p className={styles.sectionHeading}>Details</p>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Description</label>
                <textarea className={styles.textareaInput}
                  value={metadata.description}
                  onChange={e => updateMetadata({ description: e.target.value })}
                  placeholder="A brief description of your font…" rows={3} maxLength={256} />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>License</label>
                <input type="text" className={styles.textInput}
                  value={metadata.license}
                  onChange={e => updateMetadata({ license: e.target.value })}
                  placeholder="MIT, OFL, Proprietary…" maxLength={128} />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
