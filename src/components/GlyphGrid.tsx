import { useRef } from 'react'
import { useFontStore } from '../store/useFontStore'
import { CHAR_GROUPS } from '../constants/charsets'
import { toCodepoint } from '../constants/charsets'
import styles from './GlyphGrid.module.css'

interface GlyphGridProps {
  activeCodepoint: string | null
  onSelectGlyph: (codepoint: string) => void
}

export default function GlyphGrid({ activeCodepoint, onSelectGlyph }: GlyphGridProps) {
  const glyphs = useFontStore(s => s.project.glyphs)
  const specialCharsEnabled = useFontStore(s => s.project.specialCharsEnabled)
  const zoom = useFontStore(s => s.zoom)
  const { uploadGlyph } = useFontStore()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingUpload = useRef<string | null>(null)

  const handleCellClick = (codepoint: string) => {
    onSelectGlyph(codepoint)
  }

  const handleCellDoubleClick = (codepoint: string) => {
    pendingUpload.current = codepoint
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const cp = pendingUpload.current
    if (!file || !cp) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target?.result as string
      uploadGlyph(cp, content, file.name)
    }
    reader.readAsText(file)
    e.target.value = ''
    pendingUpload.current = null
  }

  const visibleGroups = CHAR_GROUPS.filter(g => !g.special || specialCharsEnabled)

  // Cell size scales with zoom
  const cellSize = Math.round(88 * zoom)

  return (
    <div className={styles.root}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {visibleGroups.map(group => (
        <section key={group.id} className={styles.section}>
          <h2 className={styles.sectionTitle}>{group.label}</h2>
          <div
            className={styles.grid}
            style={{ '--cell-size': `${cellSize}px` } as React.CSSProperties}
          >
            {group.characters.map(ch => {
              const cp = toCodepoint(ch)
              const glyph = glyphs[cp]
              const hasGlyph = glyph?.svgContent !== null
              const isActive = activeCodepoint === cp

              return (
                <div
                  key={cp}
                  className={`${styles.cell} ${hasGlyph ? styles.cellFilled : ''} ${isActive ? styles.cellActive : ''}`}
                  onClick={() => handleCellClick(cp)}
                  onDoubleClick={() => handleCellDoubleClick(cp)}
                  title={`${ch} · ${cp} · Double-click to upload SVG`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCellDoubleClick(cp)
                    if (e.key === ' ') handleCellClick(cp)
                  }}
                >
                  {/* Faint character watermark */}
                  <span className={styles.watermark} aria-hidden="true">{ch}</span>

                  {hasGlyph ? (
                    /* Uploaded SVG preview */
                    <div
                      className={styles.svgPreview}
                      dangerouslySetInnerHTML={{ __html: glyph.svgContent! }}
                    />
                  ) : (
                    /* Upload prompt */
                    <div className={styles.uploadPrompt}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M7 2v7M4 5l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M2 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      </svg>
                    </div>
                  )}

                  {/* Codepoint label */}
                  <span className={styles.cpLabel}>{cp}</span>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
