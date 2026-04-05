import { useRef } from "react";
import { useFontStore } from "../store/useFontStore";
import { CHAR_GROUPS, toCodepoint } from "../constants/charsets";
import styles from "./GlyphGrid.module.css";

interface GlyphGridProps {
  activeCodepoint: string | null;
  onSelectGlyph: (codepoint: string) => void;
  onOpenEditor: (codepoint: string) => void;
}

export default function GlyphGrid({
  activeCodepoint,
  onSelectGlyph,
  onOpenEditor,
}: GlyphGridProps) {
  const glyphs = useFontStore((s) => s.project.glyphs);
  const specialCharsEnabled = useFontStore(
    (s) => s.project.specialCharsEnabled,
  );
  const zoom = useFontStore((s) => s.zoom);
  const { uploadGlyph } = useFontStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUpload = useRef<string | null>(null);

  const handleCellClick = (codepoint: string) => {
    onSelectGlyph(codepoint);
  };

  // Double-click: if glyph exists open editor, otherwise upload
  const handleCellDoubleClick = (codepoint: string) => {
    const glyph = glyphs[codepoint];
    if (glyph?.svgContent) {
      onOpenEditor(codepoint);
    } else {
      pendingUpload.current = codepoint;
      fileInputRef.current?.click();
    }
  };

  // Clicking upload icon in an empty cell
  const handleUploadClick = (e: React.MouseEvent, codepoint: string) => {
    e.stopPropagation();
    pendingUpload.current = codepoint;
    fileInputRef.current?.click();
  };

  // Clicking edit icon in a filled cell
  const handleEditClick = (e: React.MouseEvent, codepoint: string) => {
    e.stopPropagation();
    onOpenEditor(codepoint);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const cp = pendingUpload.current;
    if (!file || !cp) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      uploadGlyph(cp, content, file.name);
    };
    reader.readAsText(file);
    e.target.value = "";
    pendingUpload.current = null;
  };

  const visibleGroups = CHAR_GROUPS.filter(
    (g) => !g.special || specialCharsEnabled,
  );
  const cellSize = Math.round(88 * zoom);

  return (
    <div className={styles.root}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {visibleGroups.map((group) => (
        <section key={group.id} className={styles.section}>
          <h2 className={styles.sectionTitle}>{group.label}</h2>
          <div
            className={styles.grid}
            style={{ "--cell-size": `${cellSize}px` } as React.CSSProperties}
          >
            {group.characters.map((ch) => {
              const cp = toCodepoint(ch);
              const glyph = glyphs[cp];
              const hasGlyph =
                glyph?.svgContent !== null && glyph?.svgContent !== undefined;
              const isActive = activeCodepoint === cp;

              return (
                <div
                  key={cp}
                  data-cp={cp}
                  className={`${styles.cell} ${hasGlyph ? styles.cellFilled : ""} ${isActive ? styles.cellActive : ""}`}
                  onClick={() => handleCellClick(cp)}
                  onDoubleClick={() => handleCellDoubleClick(cp)}
                  title={
                    hasGlyph
                      ? `${ch} · ${cp} · Double-click to edit`
                      : `${ch} · ${cp} · Double-click to upload SVG`
                  }
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCellDoubleClick(cp);
                    if (e.key === " ") handleCellClick(cp);
                  }}
                >
                  {/* Faint character watermark */}
                  <span className={styles.watermark} aria-hidden="true">
                    {ch}
                  </span>

                  {hasGlyph ? (
                    <>
                      {/* Uploaded SVG preview */}
                      <div
                        className={styles.svgPreview}
                        dangerouslySetInnerHTML={{ __html: glyph.svgContent! }}
                      />
                      {/* Edit overlay on hover */}
                      <div
                        className={styles.editOverlay}
                        onClick={(e) => handleEditClick(e, cp)}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 13 13"
                          fill="none"
                        >
                          <path
                            d="M9 2l2 2-7 7H2V9l7-7z"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Edit
                      </div>
                    </>
                  ) : (
                    /* Upload prompt */
                    <div
                      className={styles.uploadPrompt}
                      onClick={(e) => handleUploadClick(e, cp)}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        <path
                          d="M7 2v7M4 5l3-3 3 3"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M2 10h10"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                  )}

                  {/* Codepoint label */}
                  <span className={styles.cpLabel}>{cp}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
