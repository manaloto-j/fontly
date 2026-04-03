import { useRef, useState } from 'react'
import { useFontStore } from '../store/useFontStore'
import styles from './Navbar.module.css'

interface NavbarProps {
  onBack: () => void
}

export default function Navbar({ onBack }: NavbarProps) {
  const familyName = useFontStore(s => s.project.metadata.familyName)
  const saveStatus = useFontStore(s => s.saveStatus)
  const zoom = useFontStore(s => s.zoom)
  const canUndo = useFontStore(s => s.canUndo())
  const canRedo = useFontStore(s => s.canRedo())
  const { setFontName, undo, redo, zoomIn, zoomOut, resetZoom, exportProject } = useFontStore()

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
      {/* Left — logo + back */}
      <div className={styles.left}>
        <button className={styles.backBtn} onClick={onBack} title="Back to home">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className={styles.logoMark}>F</div>
        <span className={styles.logoText}>Fontly</span>
        <span className={styles.divider} />
        {/* Editable font name */}
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
        {/* Save status */}
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

      {/* Center — undo/redo + zoom */}
      <div className={styles.center}>
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
      </div>

      {/* Right — export */}
      <div className={styles.right}>
        <button className={styles.exportBtn} onClick={exportProject} title="Export .fontly project file">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 1v8M3 6l3.5 3.5L10 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M1 10h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Export font
        </button>
      </div>
    </header>
  )
}
