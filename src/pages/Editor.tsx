import { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import GlyphGrid from "../components/GlyphGrid";
import GlyphEditor from "../components/GlyphEditor";
import FontPreview from "./FontPreview";
import { useFontStore } from "../store/useFontStore";
import styles from "./Editor.module.css";

interface EditorProps {
  onBack: () => void;
}

export default function Editor({ onBack }: EditorProps) {
  const [activeCodepoint, setActiveCodepoint] = useState<string | null>(null);
  const [editingCodepoint, setEditingCodepoint] = useState<string | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const selectGlyph = useFontStore((s) => s.selectGlyph);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        useFontStore.getState().undo();
      }
      if (ctrl && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        useFontStore.getState().redo();
      }
      if (ctrl && e.key === "+") {
        e.preventDefault();
        useFontStore.getState().zoomIn();
      }
      if (ctrl && e.key === "-") {
        e.preventDefault();
        useFontStore.getState().zoomOut();
      }
      if (ctrl && e.key === "0") {
        e.preventDefault();
        useFontStore.getState().resetZoom();
      }
      if (ctrl && e.key === "p") {
        e.preventDefault();
        setIsPreview((p) => !p);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const cp = (e as CustomEvent<string>).detail;
      setActiveCodepoint(cp);
      setEditingCodepoint(cp);
      selectGlyph(cp);
    };
    window.addEventListener("glyph-navigate", handler);
    return () => window.removeEventListener("glyph-navigate", handler);
  }, [selectGlyph]);

  const handleSelectChar = (codepoint: string) => {
    setActiveCodepoint(codepoint);
    selectGlyph(codepoint);
    if (editingCodepoint !== null) {
      setEditingCodepoint(codepoint);
    } else {
      setTimeout(() => {
        const el = document.querySelector(`[data-cp="${codepoint}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }
  };

  const handleSelectGlyph = (codepoint: string) => {
    setActiveCodepoint(codepoint);
    selectGlyph(codepoint);
  };

  const handleOpenEditor = (codepoint: string) => {
    setActiveCodepoint(codepoint);
    setEditingCodepoint(codepoint);
    selectGlyph(codepoint);
  };

  const handleCloseEditor = () => setEditingCodepoint(null);

  const handleTogglePreview = () => {
    setIsPreview((p) => !p);
    if (!isPreview) setEditingCodepoint(null);
  };

  if (isPreview) {
    return (
      <div className={styles.root}>
        <Navbar
          onBack={onBack}
          onPreview={handleTogglePreview}
          isPreview={true}
        />
        <div className={styles.body}>
          <FontPreview onBack={handleTogglePreview} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <Navbar
        onBack={onBack}
        onPreview={handleTogglePreview}
        isPreview={false}
      />
      <div className={styles.body}>
        <Sidebar
          onSelectChar={handleSelectChar}
          activeCodepoint={activeCodepoint}
        />
        <main className={styles.main}>
          {editingCodepoint !== null ? (
            <GlyphEditor
              key={editingCodepoint}
              codepoint={editingCodepoint}
              onClose={handleCloseEditor}
            />
          ) : (
            <GlyphGrid
              activeCodepoint={activeCodepoint}
              onSelectGlyph={handleSelectGlyph}
              onOpenEditor={handleOpenEditor}
            />
          )}
        </main>
      </div>
    </div>
  );
}
