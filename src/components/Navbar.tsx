import { useRef, useState } from 'react'
import { useFontStore } from '../store/useFontStore'
import FontPanel from './FontPanel'
import styles from './Navbar.module.css'

interface NavbarProps {
  onBack: () => void
  onPreview: () => void
  isPreview: boolean
}

export default function Navbar({ onBack, onPreview, isPreview }: NavbarProps) {
  const familyName = useFontStore(s => s.project.metadata.familyName)
  const saveStatus = useFontStore(s => s.saveStatus)
  const zoom = useFontStore(s => s.zoom)
  const canUndo = useFontStore(s => s.canUndo())
  const canRedo = useFontStore(s => s.canRedo())
  const { setFontName, undo, redo, zoomIn, zoomOut, resetZoom } = useFontStore()

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(familyName)
  const nameRef = useRef<HTMLInputElement>(null)

  const handleNameClick = () => {
    setNameValue(familyName)
    setEditingName(true)
    setTimeout(() => nameRef.current?.select(), 0)
  }

  const handleNameCommit = () => {
    const trimmed = nameValue.trim()
    if (trimmed) setFontName(trimmed)
    else setNameValue(familyName)
    setEditingName(false)
  }

  const handleNameKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleNameCommit()
    if (e.key === 'Escape') { setNameValue(familyName); setEditingName(false) }
  }

  return (
    <header className={styles.navbar}>
      {/* Left — logo + back + name + save status */}
      <div className={styles.left}>
        <button className={styles.backBtn} onClick={onBack} title="Back to home">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className={styles.logoMark}>F</div>
        <span className={styles.logoText}>Fontly</span>
        <span className={styles.dividerV} />
        {editingName ? (
          <input
            ref={nameRef}
            className={styles.nameInput}
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={handleNameCommit}
            onKeyDown={handleNameKey}
            maxLength={60}
          />
        ) : (
          <button className={styles.nameBtn} onClick={handleNameClick} title="Click to rename">
            {familyName}
          </button>
        )}
        <span className={`${styles.saveStatus} ${styles[saveStatus]}`}>
          {saveStatus === 'saved' && (
            <>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Saved
            </>
          )}
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'unsaved' && 'Unsaved'}
        </span>
      </div>

      {/* Center — view switcher (truly centered via absolute positioning) */}
      <div className={styles.center}>
        <div className={styles.viewSwitcher}>
          <button
            className={`${styles.viewBtn} ${!isPreview ? styles.viewBtnActive : ''}`}
            onClick={() => isPreview && onPreview()}
            title="Editor view (Ctrl+P)"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <rect x="1.5" y="1.5" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3"/>
              <rect x="7.5" y="1.5" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3"/>
              <rect x="1.5" y="7.5" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3"/>
              <rect x="7.5" y="7.5" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            Editor
          </button>
          <button
            className={`${styles.viewBtn} ${isPreview ? styles.viewBtnActive : ''}`}
            onClick={() => !isPreview && onPreview()}
            title="Preview view (Ctrl+P)"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1 6.5S3 2 6.5 2 12 6.5 12 6.5 10 11 6.5 11 1 6.5 1 6.5z" stroke="currentColor" strokeWidth="1.3"/>
              <circle cx="6.5" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            Preview
          </button>
        </div>
      </div>

      {/* Right — undo/redo + zoom + font settings + save project */}
      <div className={styles.right}>
        {/* Undo/redo — hidden in preview */}
        {!isPreview && (
          <div className={styles.btnGroup}>
            <button
              className={styles.iconBtn}
              onClick={undo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 5h6a4 4 0 0 1 0 8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 5l3-3M2 5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button
              className={styles.iconBtn}
              onClick={redo}
              disabled={!canRedo}
              title="Redo (Ctrl+Y)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M12 5H6a4 4 0 0 0 0 8h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 5l-3-3m3 3l-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Zoom — hidden in preview */}
        {!isPreview && (
          <div className={styles.zoomControl}>
            <button className={styles.iconBtn} onClick={zoomOut} disabled={zoom <= 0.5} title="Zoom out">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <button className={styles.zoomValue} onClick={resetZoom} title="Reset zoom">
              {Math.round(zoom * 100)}%
            </button>
            <button className={styles.iconBtn} onClick={zoomIn} disabled={zoom >= 2} title="Zoom in">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        )}

        <span className={styles.dividerV} />

        {/* Font settings / export panel */}
        <FontPanel />

        {/* Save .fontly project file */}
        <button
          className={styles.saveBtn}
          onClick={() => useFontStore.getState().exportProject()}
          title="Save .fontly project file"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 2h7l2 2v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            <path d="M4 2v3h5V2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3 7h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          Save project
        </button>
      </div>
    </header>
  )
}
