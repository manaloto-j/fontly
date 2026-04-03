import { useState } from 'react'
import { useFontStore } from '../store/useFontStore'
import { CHAR_GROUPS } from '../constants/charsets'
import { toCodepoint } from '../constants/charsets'
import styles from './Sidebar.module.css'

interface SidebarProps {
  onSelectChar: (codepoint: string) => void
  activeCodepoint: string | null
}

export default function Sidebar({ onSelectChar, activeCodepoint }: SidebarProps) {
  const specialCharsEnabled = useFontStore(s => s.project.specialCharsEnabled)
  const glyphs = useFontStore(s => s.project.glyphs)
  const toggleSpecialChars = useFontStore(s => s.toggleSpecialChars)
  const uploadedCount = useFontStore(s =>
    Object.values(s.project.glyphs).filter(g => g.svgContent !== null).length
  )
  const totalCount = Object.keys(glyphs).length

  // All groups start expanded except special
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

  return (
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
              {/* Group header */}
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

              {/* Character pills */}
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
  )
}
