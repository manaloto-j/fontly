import { useState, useRef } from 'react'
import { useFontStore } from '../store/useFontStore'
import { CHAR_GROUPS } from '../constants/charsets'
import { toCodepoint } from '../constants/charsets'
import styles from './Sidebar.module.css'

interface SidebarProps {
  onSelectChar: (codepoint: string) => void
  activeCodepoint: string | null
}

// ── Confirmation modal ─────────────────────────────────────────────────────────
function ClearConfirmModal({
  uploadedCount,
  onConfirm,
  onCancel,
}: {
  uploadedCount: number
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className={styles.modalBackdrop} onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalIconDanger}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 2h4M2 4h12M5 4v8a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M7 7v3M9 7v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div className={styles.modalTitle}>Clear all glyphs?</div>
            <div className={styles.modalSubtitle}>This cannot be undone after closing</div>
          </div>
        </div>

        <div className={styles.modalBody}>
          <p className={styles.modalText}>
            You have <strong>{uploadedCount}</strong> uploaded glyph{uploadedCount !== 1 ? 's' : ''}. Clearing will permanently remove all SVG data and reset every glyph's adjustments back to default.
          </p>
          <p className={styles.modalText} style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
            Your font name, metrics, and settings will be kept. Only the uploaded SVGs are removed.
          </p>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.modalCancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.modalDangerBtn} onClick={onConfirm}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M4.5 1.5h4M1.5 3h10M3.5 3v7.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Clear all glyphs
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Sidebar({ onSelectChar, activeCodepoint }: SidebarProps) {
  const specialCharsEnabled = useFontStore(s => s.project.specialCharsEnabled)
  const glyphs = useFontStore(s => s.project.glyphs)
  const toggleSpecialChars = useFontStore(s => s.toggleSpecialChars)
  const { clearAllGlyphs, importProject } = useFontStore()

  const uploadedCount = Object.values(glyphs).filter(g => g.svgContent !== null).length
  const totalCount = Object.keys(glyphs).length

  const [showClearModal, setShowClearModal] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    uppercase: true,
    lowercase: true,
    numbers: true,
    punctuation: false,
    special: false,
  })

  const toggle = (id: string) =>
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  const visibleGroups = CHAR_GROUPS.filter(g => !g.special || specialCharsEnabled)

  const handleClearConfirm = () => {
    clearAllGlyphs()
    setShowClearModal(false)
  }

  const handleImportClick = () => {
    setImportError(null)
    importInputRef.current?.click()
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const json = ev.target?.result as string
      const result = importProject(json)
      if (result.success) {
        setImportSuccess(true)
        setTimeout(() => setImportSuccess(false), 3000)
      } else {
        setImportError(result.error ?? 'Import failed')
        setTimeout(() => setImportError(null), 4000)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <>
      {/* Hidden import input */}
      <input
        ref={importInputRef}
        type="file"
        accept=".fontly,.json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      {/* Clear confirmation modal */}
      {showClearModal && (
        <ClearConfirmModal
          uploadedCount={uploadedCount}
          onConfirm={handleClearConfirm}
          onCancel={() => setShowClearModal(false)}
        />
      )}

      <aside className={styles.sidebar}>
        {/* Progress summary */}
        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Glyphs uploaded</span>
            <span className={styles.summaryVal}>{uploadedCount} / {totalCount}</span>
          </div>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${totalCount > 0 ? (uploadedCount / totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Project actions */}
        <div className={styles.actionsRow}>
          {/* Import .fontly */}
          <button
            className={styles.actionBtn}
            onClick={handleImportClick}
            title="Load a .fontly project file"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 2h7l2 2v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M6.5 5v4M4.5 7l2 2 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Load project
          </button>

          {/* Clear all */}
          <button
            className={`${styles.actionBtn} ${styles.actionBtnDanger} ${uploadedCount === 0 ? styles.actionBtnDisabled : ''}`}
            onClick={() => uploadedCount > 0 && setShowClearModal(true)}
            disabled={uploadedCount === 0}
            title="Clear all uploaded SVGs"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M4.5 1.5h4M1.5 3h10M3.5 3v7.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5.5 5.5v4M7.5 5.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Clear all
          </button>
        </div>

        {/* Import feedback */}
        {importSuccess && (
          <div className={styles.feedbackSuccess}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l2.5 2.5L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Project loaded successfully
          </div>
        )}
        {importError && (
          <div className={styles.feedbackError}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M6 4v2.5M6 8v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            {importError}
          </div>
        )}

        {/* Special chars toggle */}
        <div className={styles.toggleRow}>
          <span className={styles.toggleLabel}>Special characters</span>
          <button
            className={`${styles.toggle} ${specialCharsEnabled ? styles.toggleOn : ''}`}
            onClick={toggleSpecialChars}
            title="Toggle extended special characters"
            role="switch"
            aria-checked={specialCharsEnabled}
          >
            <span className={styles.toggleThumb} />
          </button>
        </div>

        {/* Character groups */}
        <nav className={styles.groups}>
          {visibleGroups.map(group => {
            const isOpen = expanded[group.id]
            const uploadedInGroup = group.characters.filter(
              ch => glyphs[toCodepoint(ch)]?.svgContent !== null
            ).length
            return (
              <div key={group.id} className={styles.group}>
                <button
                  className={styles.groupHeader}
                  onClick={() => toggle(group.id)}
                  aria-expanded={isOpen}
                >
                  <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                  <span className={styles.groupLabel}>{group.label}</span>
                  <span className={styles.groupCount}>
                    {uploadedInGroup}/{group.characters.length}
                  </span>
                </button>

                {isOpen && (
                  <div className={styles.charGrid}>
                    {group.characters.map(ch => {
                      const cp = toCodepoint(ch)
                      const glyph = glyphs[cp]
                      const hasGlyph = glyph?.svgContent !== null
                      const isActive = activeCodepoint === cp
                      return (
                        <button
                          key={cp}
                          className={`${styles.charPill} ${hasGlyph ? styles.charPillFilled : ''} ${isActive ? styles.charPillActive : ''}`}
                          onClick={() => onSelectChar(cp)}
                          title={`${ch} (${cp})`}
                        >
                          {ch}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
