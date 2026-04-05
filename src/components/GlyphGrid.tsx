import { useRef, useState, useCallback } from "react";
import { useFontStore } from "../store/useFontStore";
import { CHAR_GROUPS, toCodepoint } from "../constants/charsets";
import { buildPreviewSVG } from "../utils/svgPreview";
import styles from "./GlyphGrid.module.css";

interface GlyphGridProps {
  activeCodepoint: string | null;
  onSelectGlyph: (codepoint: string) => void;
  onOpenEditor: (codepoint: string) => void;
}

function filenameToCodepoint(filename: string): string | null {
  const base = filename.replace(/\.svg$/i, "").trim();

  const uplusMatch = base.match(/^U\+([0-9A-Fa-f]{4,6})$/i);
  if (uplusMatch) return `U+${uplusMatch[1].toUpperCase().padStart(4, "0")}`;

  const uniMatch = base.match(/^uni_?([0-9A-Fa-f]{4,6})$/i);
  if (uniMatch) return `U+${uniMatch[1].toUpperCase().padStart(4, "0")}`;

  const hexMatch = base.match(/^([0-9A-Fa-f]{4,6})$/);
  if (hexMatch) return `U+${hexMatch[1].toUpperCase().padStart(4, "0")}`;

  if (base.length === 1) {
    const cp = base.codePointAt(0)!;
    return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  }

  return null;
}

export default function GlyphGrid({
  activeCodepoint,
  onSelectGlyph,
  onOpenEditor,
}: GlyphGridProps) {
  const glyphs = useFontStore((s) => s.project.glyphs);
  const specialCharsEnabled = useFontStore((s) => s.project.specialCharsEnabled);
  const zoom = useFontStore((s) => s.zoom);
  const { uploadGlyph, uploadMultipleGlyphs } = useFontStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUpload = useRef<string | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStats, setDragStats] = useState<{ matched: number; total: number } | null>(null);
  const dragCounter = useRef(0);

  const handleCellClick = (codepoint: string) => onSelectGlyph(codepoint);

  const handleCellDoubleClick = (codepoint: string) => {
    const glyph = glyphs[codepoint];
    if (glyph?.svgContent) {
      onOpenEditor(codepoint);
    } else {
      pendingUpload.current = codepoint;
      fileInputRef.current?.click();
    }
  };

  const handleUploadClick = (e: React.MouseEvent, codepoint: string) => {
    e.stopPropagation();
    pendingUpload.current = codepoint;
    fileInputRef.current?.click();
  };

  const handleEditClick = (e: React.MouseEvent, codepoint: string) => {
    e.stopPropagation();
    onOpenEditor(codepoint);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const cp = pendingUpload.current;
    if (!file || !cp) return;
    const reader = new FileReader();
    reader.onload = (ev) => uploadGlyph(cp, ev.target?.result as string, file.name);
    reader.readAsText(file);
    e.target.value = "";
    pendingUpload.current = null;
  };

  const processSVGFiles = useCallback(
    async (files: File[]) => {
      const svgFiles = files.filter((f) => f.name.toLowerCase().endsWith(".svg"));
      const entries: Array<{ codepoint: string; svgContent: string; fileName: string }> = [];
      let matched = 0;

      await Promise.all(
        svgFiles.map(
          (file) =>
            new Promise<void>((resolve) => {
              const cp = filenameToCodepoint(file.name);
              if (!cp || !glyphs[cp]) { resolve(); return; }
              matched++;
              const reader = new FileReader();
              reader.onload = (ev) => {
                entries.push({ codepoint: cp, svgContent: ev.target?.result as string, fileName: file.name });
                resolve();
              };
              reader.onerror = () => resolve();
              reader.readAsText(file);
            })
        )
      );

      if (entries.length > 0) uploadMultipleGlyphs(entries);
      setDragStats({ matched: entries.length, total: svgFiles.length });
      setTimeout(() => setDragStats(null), 3000);
    },
    [glyphs, uploadMultipleGlyphs]
  );

  const collectFiles = async (dataTransfer: DataTransfer): Promise<File[]> => {
    const files: File[] = [];
    if (dataTransfer.items) {
      const itemPromises: Promise<void>[] = [];
      for (const item of Array.from(dataTransfer.items)) {
        if (item.kind !== "file") continue;
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          itemPromises.push(traverseEntry(entry, files));
        } else {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      await Promise.all(itemPromises);
    } else {
      for (const file of Array.from(dataTransfer.files)) files.push(file);
    }
    return files;
  };

  const traverseEntry = (entry: FileSystemEntry, files: File[]): Promise<void> => {
    return new Promise((resolve) => {
      if (entry.isFile) {
        (entry as FileSystemFileEntry).file((f) => { files.push(f); resolve(); }, resolve);
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const readAll = () => {
          reader.readEntries(async (entries) => {
            if (entries.length === 0) { resolve(); return; }
            await Promise.all(entries.map((e) => traverseEntry(e, files)));
            readAll();
          }, resolve);
        };
        readAll();
      } else {
        resolve();
      }
    });
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current++;
    if (dragCounter.current === 1) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = await collectFiles(e.dataTransfer);
    await processSVGFiles(files);
  };

  const visibleGroups = CHAR_GROUPS.filter((g) => !g.special || specialCharsEnabled);
  const cellSize = Math.round(88 * zoom);

  return (
    <div
      className={`${styles.root} ${isDragging ? styles.dragging : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {isDragging && (
        <div className={styles.dragOverlay}>
          <div className={styles.dragOverlayInner}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <path d="M20 8v16M12 16l8-8 8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 30h24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            <span>Drop SVG files or a folder</span>
            <span className={styles.dragOverlayHint}>
              Files are matched by name — A.svg, U+0041.svg, 0041.svg
            </span>
          </div>
        </div>
      )}

      {dragStats && (
        <div className={styles.importToast}>
          {dragStats.matched > 0 ? (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 7l3 3 6-6" stroke="#2d8a5a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {dragStats.matched} of {dragStats.total} SVG{dragStats.total !== 1 ? "s" : ""} imported
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="#d97706" strokeWidth="1.2"/>
                <path d="M7 4.5v3M7 9.5v.5" stroke="#d97706" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              No SVGs matched — name files as A.svg, U+0041.svg, or 0041.svg
            </>
          )}
        </div>
      )}

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
              const hasGlyph = glyph?.svgContent != null;
              const isActive = activeCodepoint === cp;

              return (
                <div
                  key={cp}
                  data-cp={cp}
                  className={`${styles.cell} ${hasGlyph ? styles.cellFilled : ""} ${isActive ? styles.cellActive : ""}`}
                  onClick={() => handleCellClick(cp)}
                  onDoubleClick={() => handleCellDoubleClick(cp)}
                  title={hasGlyph ? `${ch} · ${cp} · Double-click to edit` : `${ch} · ${cp} · Double-click to upload SVG`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCellDoubleClick(cp);
                    if (e.key === " ") handleCellClick(cp);
                  }}
                >
                  <span className={styles.watermark} aria-hidden="true">{ch}</span>

                  {hasGlyph ? (
                    <>
                      {/* ── Inline SVG preview — correct aspect ratio, no boxing issues ── */}
                      <div
                        className={styles.svgPreview}
                        dangerouslySetInnerHTML={{ __html: buildPreviewSVG(glyph.svgContent!) }}
                      />
                      <div className={styles.editOverlay} onClick={(e) => handleEditClick(e, cp)}>
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                          <path d="M9 2l2 2-7 7H2V9l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Edit
                      </div>
                    </>
                  ) : (
                    <div className={styles.uploadPrompt} onClick={(e) => handleUploadClick(e, cp)}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M7 2v7M4 5l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M2 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      </svg>
                    </div>
                  )}

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
