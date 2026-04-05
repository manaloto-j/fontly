import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useFontStore } from "../store/useFontStore";
import { CHAR_GROUPS, toCodepoint } from "../constants/charsets";
import { GlyphAdjustments } from "../types/font";
import styles from "./GlyphEditor.module.css";

interface GlyphEditorProps {
  codepoint: string;
  onClose: () => void;
}

function useOrderedCodepoints() {
  const specialCharsEnabled = useFontStore(
    (s) => s.project.specialCharsEnabled,
  );
  const groups = CHAR_GROUPS.filter((g) => !g.special || specialCharsEnabled);
  return groups.flatMap((g) => g.characters.map(toCodepoint));
}

const GUIDE_LINES = [
  { key: "ascender", label: "Ascender", defaultY: 0.08, color: "#4a9eff" },
  { key: "capHeight", label: "Cap Height", defaultY: 0.18, color: "#a78bfa" },
  { key: "xHeight", label: "x-Height", defaultY: 0.38, color: "#34d399" },
  { key: "baseline", label: "Baseline", defaultY: 0.75, color: "#f59e0b" },
  { key: "descender", label: "Descender", defaultY: 0.88, color: "#f87171" },
];

const DEFAULT_ADJUSTMENTS: GlyphAdjustments = {
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
  rotate: 0,
  flipH: false,
  flipV: false,
  baseline: 0,
  advanceWidth: 600,
  leftBearing: 50,
};

const DEFAULT_SPACING = {
  advanceWidth: DEFAULT_ADJUSTMENTS.advanceWidth,
  leftBearing: DEFAULT_ADJUSTMENTS.leftBearing,
};

const CANVAS_W = 480;
const CANVAS_H = 520;
const BASELINE_Y = 0.75;
const CAP_HEIGHT_Y = 0.18;

type ToolMode = "select" | "move" | "guides";

function parseSVGContent(svgString: string): {
  innerContent: string;
  viewBox: string;
  width: number;
  height: number;
  aspectRatio: number;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svg = doc.querySelector("svg");

  if (!svg)
    return {
      innerContent: svgString,
      viewBox: "0 0 100 100",
      width: 100,
      height: 100,
      aspectRatio: 1,
    };

  let viewBox = svg.getAttribute("viewBox") ?? "";
  let vbW = 100,
    vbH = 100;

  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4) {
      vbW = parts[2];
      vbH = parts[3];
    }
  } else {
    vbW = parseFloat(svg.getAttribute("width") ?? "100") || 100;
    vbH = parseFloat(svg.getAttribute("height") ?? "100") || 100;
    viewBox = `0 0 ${vbW} ${vbH}`;
  }

  return {
    innerContent: svg.innerHTML,
    viewBox,
    width: vbW,
    height: vbH,
    aspectRatio: vbW / vbH,
  };
}

function computeAutoFit(parsedSVG: {
  width: number;
  height: number;
  aspectRatio: number;
}): Partial<GlyphAdjustments> {
  const padding = 40;
  const availH = CANVAS_H - padding * 2;
  const availW = CANVAS_W - padding * 2;
  const capY = CAP_HEIGHT_Y * CANVAS_H;
  const baseY = BASELINE_Y * CANVAS_H;
  const targetH = baseY - capY;
  const targetW = availW;
  const scaleToFitH = targetH / availH;
  const scaleToFitW = targetW / availW;
  const fitScale = Math.min(scaleToFitH, scaleToFitW);
  const targetCenterY = capY + targetH / 2;
  const canvasCenterY = CANVAS_H / 2;
  const offsetY = -(targetCenterY - canvasCenterY);
  return {
    scaleX: Math.round(fitScale * 100) / 100,
    scaleY: Math.round(fitScale * 100) / 100,
    offsetY: Math.round(offsetY),
    offsetX: 0,
    baseline: 0,
  };
}

function useAdjustmentHistory(initial: GlyphAdjustments) {
  const [stack, setStack] = useState<GlyphAdjustments[]>([initial]);
  const [index, setIndex] = useState(0);

  const push = useCallback(
    (adj: GlyphAdjustments) => {
      setStack((prev) => {
        const next = prev.slice(0, index + 1);
        next.push({ ...adj });
        if (next.length > 60) next.shift();
        return next;
      });
      setIndex((prev) => Math.min(prev + 1, 59));
    },
    [index],
  );

  const undo = useCallback(() => {
    if (index <= 0) return null;
    const newIndex = index - 1;
    setIndex(newIndex);
    return stack[newIndex];
  }, [index, stack]);

  const redo = useCallback(() => {
    if (index >= stack.length - 1) return null;
    const newIndex = index + 1;
    setIndex(newIndex);
    return stack[newIndex];
  }, [index, stack]);

  return {
    current: stack[index],
    push,
    undo,
    redo,
    canUndo: index > 0,
    canRedo: index < stack.length - 1,
  };
}

export default function GlyphEditor({ codepoint, onClose }: GlyphEditorProps) {
  const glyphs = useFontStore((s) => s.project.glyphs);
  const updateAdjustments = useFontStore((s) => s.updateAdjustments);
  const uploadGlyph = useFontStore((s) => s.uploadGlyph);
  const specialCharsEnabled = useFontStore(
    (s) => s.project.specialCharsEnabled,
  );

  const orderedCps = useOrderedCodepoints();
  const currentIndex = orderedCps.indexOf(codepoint);

  const glyph = glyphs[codepoint];
  const storedAdj: GlyphAdjustments = {
    ...DEFAULT_ADJUSTMENTS,
    ...(glyph?.adjustments ?? {}),
  };

  const adjHistory = useAdjustmentHistory(storedAdj);
  const adj = adjHistory.current;

  const allChars = CHAR_GROUPS.filter(
    (g) => !g.special || specialCharsEnabled,
  ).flatMap((g) => g.characters);
  const char = allChars.find((ch) => toCodepoint(ch) === codepoint) ?? "?";

  const [visibleGuides, setVisibleGuides] = useState<Record<string, boolean>>({
    ascender: true,
    capHeight: true,
    xHeight: true,
    baseline: true,
    descender: true,
    leftBearing: true,
    rightBearing: true,
  });

  // Guide Y positions as fractions (0–1), keyed by guide key
  const [guidePositions, setGuidePositions] = useState<Record<string, number>>(
    Object.fromEntries(GUIDE_LINES.map((g) => [g.key, g.defaultY])),
  );

  const [activeTab, setActiveTab] = useState<
    "transform" | "spacing" | "guides"
  >("transform");
  const [scaleLocked, setScaleLocked] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoFitApplied = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Drag state for move-glyph tool
  const glyphDragRef = useRef<{
    startX: number;
    startY: number;
    startOffX: number;
    startOffY: number;
    adjSnapshot: GlyphAdjustments;
  } | null>(null);
  const [isDraggingGlyph, setIsDraggingGlyph] = useState(false);
  // Ref to the SVG <g> element so we can mutate its transform directly (no re-render during drag)
  const svgGRef = useRef<SVGGElement>(null);

  // Drag state for move-guides tool
  const guideDragRef = useRef<{
    key: string;
    startMouseY: number;
    startFrac: number;
  } | null>(null);
  const [draggingGuideKey, setDraggingGuideKey] = useState<string | null>(null);

  const parsedSVG = useMemo(() => {
    if (!glyph?.svgContent) return null;
    return parseSVGContent(glyph.svgContent);
  }, [glyph?.svgContent]);

  // Auto-fit on first upload
  useEffect(() => {
    if (!parsedSVG || autoFitApplied.current) return;
    const isDefault =
      storedAdj.scaleX === 1 &&
      storedAdj.scaleY === 1 &&
      storedAdj.offsetX === 0 &&
      storedAdj.offsetY === 0 &&
      storedAdj.baseline === 0;
    if (!isDefault) {
      autoFitApplied.current = true;
      return;
    }
    const fitted = computeAutoFit(parsedSVG);
    const next = { ...storedAdj, ...fitted };
    adjHistory.push(next);
    updateAdjustments(codepoint, next);
    autoFitApplied.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedSVG]);

  const goTo = useCallback(
    (dir: -1 | 1) => {
      const nextIndex = currentIndex + dir;
      if (nextIndex < 0 || nextIndex >= orderedCps.length) return;
      window.dispatchEvent(
        new CustomEvent("glyph-navigate", { detail: orderedCps[nextIndex] }),
      );
    },
    [currentIndex, orderedCps],
  );

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowLeft" && (e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        goTo(-1);
      }
      if (e.key === "ArrowRight" && (e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        goTo(1);
      }
      if (ctrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const prev = adjHistory.undo();
        if (prev) updateAdjustments(codepoint, prev);
      }
      if (ctrl && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        e.stopPropagation();
        const next = adjHistory.redo();
        if (next) updateAdjustments(codepoint, next);
      }
      // Tool shortcuts
      if (e.key === "v" && !ctrl) setToolMode("select");
      if (e.key === "m" && !ctrl) setToolMode("move");
      if (e.key === "g" && !ctrl) setToolMode("guides");
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () =>
      window.removeEventListener("keydown", handler, { capture: true });
  }, [onClose, goTo, adjHistory, codepoint, updateAdjustments]);

  const update = (patch: Partial<GlyphAdjustments>) => {
    const next = { ...adj, ...patch };
    adjHistory.push(next);
    updateAdjustments(codepoint, next);
  };

  // ── Move-glyph drag handlers ────────────────────────────────────────────────
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (toolMode === "move" && parsedSVG) {
        e.preventDefault();
        glyphDragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startOffX: adj.offsetX,
          startOffY: adj.offsetY,
          adjSnapshot: { ...adj },
        };
        setIsDraggingGlyph(true);
      }
    },
    [toolMode, parsedSVG, adj],
  );

  useEffect(() => {
    if (!isDraggingGlyph) return;

    const buildLiveTransform = (dx: number, dy: number): string => {
      const snap = glyphDragRef.current!.adjSnapshot;
      const newOffX = glyphDragRef.current!.startOffX + dx;
      const newOffY = glyphDragRef.current!.startOffY + dy;
      const flipScaleX = snap.flipH ? -1 : 1;
      const flipScaleY = snap.flipV ? -1 : 1;
      return [
        `translate(${cx}, ${cy})`,
        snap.rotate !== 0 ? `rotate(${snap.rotate})` : "",
        `scale(${snap.scaleX * flipScaleX}, ${snap.scaleY * flipScaleY})`,
        `translate(${-cx + newOffX}, ${-cy + newOffY + snap.baseline})`,
      ]
        .filter(Boolean)
        .join(" ");
    };

    const onMove = (e: MouseEvent) => {
      if (!glyphDragRef.current || !svgGRef.current) return;
      const dx = e.clientX - glyphDragRef.current.startX;
      const dy = e.clientY - glyphDragRef.current.startY;
      // Direct DOM mutation — zero React re-renders, buttery smooth
      svgGRef.current.setAttribute("transform", buildLiveTransform(dx, dy));
    };

    const onUp = (e: MouseEvent) => {
      if (!glyphDragRef.current) return;
      const snap = glyphDragRef.current.adjSnapshot;
      const dx = e.clientX - glyphDragRef.current.startX;
      const dy = e.clientY - glyphDragRef.current.startY;
      const newOffX = Math.round(glyphDragRef.current.startOffX + dx);
      const newOffY = Math.round(glyphDragRef.current.startOffY + dy);
      const committed = { ...snap, offsetX: newOffX, offsetY: newOffY };
      adjHistory.push(committed);
      updateAdjustments(codepoint, committed);
      glyphDragRef.current = null;
      setIsDraggingGlyph(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // All state read through refs — safe to omit deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingGlyph]);

  // ── Move-guides drag handlers ───────────────────────────────────────────────
  const handleGuideMouseDown = useCallback(
    (e: React.MouseEvent, key: string) => {
      if (toolMode !== "guides") return;
      e.preventDefault();
      e.stopPropagation();
      guideDragRef.current = {
        key,
        startMouseY: e.clientY,
        startFrac: guidePositions[key],
      };
      setDraggingGuideKey(key);
    },
    [toolMode, guidePositions],
  );

  useEffect(() => {
    if (!draggingGuideKey) return;
    const onMove = (e: MouseEvent) => {
      if (!guideDragRef.current || !canvasRef.current) return;
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const dy = e.clientY - guideDragRef.current.startMouseY;
      const fracDelta = dy / canvasRect.height;
      const newFrac = Math.max(
        0.01,
        Math.min(0.99, guideDragRef.current.startFrac + fracDelta),
      );
      setGuidePositions((prev) => ({
        ...prev,
        [guideDragRef.current!.key]: newFrac,
      }));
    };
    const onUp = () => {
      guideDragRef.current = null;
      setDraggingGuideKey(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingGuideKey]);

  const handleUpload = () => {
    autoFitApplied.current = false;
    fileInputRef.current?.click();
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    autoFitApplied.current = false;
    const reader = new FileReader();
    reader.onload = (ev) =>
      uploadGlyph(codepoint, ev.target?.result as string, file.name);
    reader.readAsText(file);
    e.target.value = "";
  };

  // Reset snaps to auto-fit scale (fills cap→baseline guide zone) rather than raw scale=1
  const getFitDefaults = (): GlyphAdjustments => {
    if (parsedSVG) {
      const fitted = computeAutoFit(parsedSVG);
      return { ...DEFAULT_ADJUSTMENTS, ...fitted };
    }
    return { ...DEFAULT_ADJUSTMENTS };
  };
  const resetAdj = () => {
    const next = getFitDefaults();
    adjHistory.push(next);
    updateAdjustments(codepoint, next);
  };
  const resetSpacing = () => {
    const next = { ...adj, ...DEFAULT_SPACING };
    adjHistory.push(next);
    updateAdjustments(codepoint, next);
  };

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;

  const buildInlineSVGTransform = () => {
    if (!parsedSVG) return { fitTransform: "", adjustTransform: "" };
    const padding = 40;
    const availW = CANVAS_W - padding * 2;
    const availH = CANVAS_H - padding * 2;
    const scaleToFit = Math.min(
      availW / parsedSVG.width,
      availH / parsedSVG.height,
    );
    const fitW = parsedSVG.width * scaleToFit;
    const fitH = parsedSVG.height * scaleToFit;
    const fitX = (CANVAS_W - fitW) / 2;
    const fitY = (CANVAS_H - fitH) / 2;
    const fitTransform = `translate(${fitX}, ${fitY}) scale(${scaleToFit})`;
    const flipScaleX = adj.flipH ? -1 : 1;
    const flipScaleY = adj.flipV ? -1 : 1;
    const adjustTransform = [
      `translate(${cx}, ${cy})`,
      adj.rotate !== 0 ? `rotate(${adj.rotate})` : "",
      `scale(${adj.scaleX * flipScaleX}, ${adj.scaleY * flipScaleY})`,
      `translate(${-cx + adj.offsetX}, ${-cy + adj.offsetY + adj.baseline})`,
    ]
      .filter(Boolean)
      .join(" ");
    return { fitTransform, adjustTransform };
  };

  const { adjustTransform } = buildInlineSVGTransform();

  // Scale is stored as 0.1–3 internally; UI shows/accepts percent (10–300)
  const scaleXPct = Math.round(adj.scaleX * 100);
  const scaleYPct = Math.round(adj.scaleY * 100);
  const handleScaleXPct = (pct: number) => {
    const v = Math.max(10, Math.min(300, pct)) / 100;
    update(scaleLocked ? { scaleX: v, scaleY: v } : { scaleX: v });
  };
  const handleScaleYPct = (pct: number) => {
    const v = Math.max(10, Math.min(300, pct)) / 100;
    update(scaleLocked ? { scaleX: v, scaleY: v } : { scaleY: v });
  };

  // Canvas cursor style
  const canvasCursor =
    toolMode === "move"
      ? isDraggingGlyph
        ? "grabbing"
        : "grab"
      : toolMode === "guides"
        ? "default"
        : "default";

  return (
    <div className={styles.root}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <button
          className={styles.backBtn}
          onClick={onClose}
          title="Back to grid (Esc)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M9 2L4 7l5 5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to grid
        </button>

        <div className={styles.glyphTitle}>
          <span className={styles.glyphChar}>{char}</span>
          <div className={styles.glyphMeta}>
            <span className={styles.glyphCp}>{codepoint}</span>
            <span className={styles.glyphStatus}>
              {glyph?.svgContent ? (
                <>
                  <span className={styles.dotGreen} />
                  Uploaded
                </>
              ) : (
                <>
                  <span className={styles.dotGray} />
                  Empty
                </>
              )}
            </span>
          </div>
        </div>

        <div className={styles.localUndoRow}>
          <button
            className={styles.localUndoBtn}
            onClick={() => {
              const p = adjHistory.undo();
              if (p) updateAdjustments(codepoint, p);
            }}
            disabled={!adjHistory.canUndo}
            title="Undo (Ctrl+Z)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 4h5a3 3 0 0 1 0 6H5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 4l2.5-2.5M2 4l2.5 2.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            className={styles.localUndoBtn}
            onClick={() => {
              const n = adjHistory.redo();
              if (n) updateAdjustments(codepoint, n);
            }}
            disabled={!adjHistory.canRedo}
            title="Redo (Ctrl+Y)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M10 4H5a3 3 0 0 0 0 6h2"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M10 4l-2.5-2.5M10 4l-2.5 2.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className={styles.navButtons}>
          <button
            className={styles.navBtn}
            onClick={() => goTo(-1)}
            disabled={currentIndex <= 0}
            title="Previous (Alt+←)"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M8 2L3.5 6.5 8 11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className={styles.navCount}>
            {currentIndex + 1} / {orderedCps.length}
          </span>
          <button
            className={styles.navBtn}
            onClick={() => goTo(1)}
            disabled={currentIndex >= orderedCps.length - 1}
            title="Next (Alt+→)"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M5 2l4.5 4.5L5 11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className={styles.body}>
        {/* Canvas */}
        <div className={styles.canvasArea}>
          {/* ── Tool palette ── */}
          <div className={styles.toolPalette}>
            <button
              className={`${styles.toolBtn} ${toolMode === "select" ? styles.toolBtnActive : ""}`}
              onClick={() => setToolMode("select")}
              title="Select (V) — default mode"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3 2l8 5-4.5 1.5L5 13 3 2z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                  fill={toolMode === "select" ? "currentColor" : "none"}
                  fillOpacity={toolMode === "select" ? 0.15 : 0}
                />
              </svg>
              <span className={styles.toolBtnLabel}>Select</span>
            </button>

            <button
              className={`${styles.toolBtn} ${toolMode === "move" ? styles.toolBtnActive : ""}`}
              onClick={() => setToolMode("move")}
              title="Move glyph (M) — drag to reposition"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M7 2v10M2 7h10"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
                <path
                  d="M5 4L7 2l2 2M5 10l2 2 2-2M4 5L2 7l2 2M10 5l2 2-2 2"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className={styles.toolBtnLabel}>Move</span>
            </button>

            <button
              className={`${styles.toolBtn} ${toolMode === "guides" ? styles.toolBtnActive : ""}`}
              onClick={() => setToolMode("guides")}
              title="Move guides (G) — drag guide lines"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M2 4h10M2 7h10M2 10h10"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeDasharray={toolMode === "guides" ? "0" : "2 1.5"}
                />
                <circle
                  cx="7"
                  cy="4"
                  r="1.5"
                  fill="currentColor"
                  opacity={toolMode === "guides" ? 1 : 0.5}
                />
              </svg>
              <span className={styles.toolBtnLabel}>Guides</span>
            </button>
          </div>

          <div
            ref={canvasRef}
            className={styles.canvas}
            style={{ width: CANVAS_W, height: CANVAS_H, cursor: canvasCursor }}
            onMouseDown={handleCanvasMouseDown}
          >
            {/* Guide lines */}
            {GUIDE_LINES.map(
              (g) =>
                visibleGuides[g.key] && (
                  <div
                    key={g.key}
                    className={`${styles.guideLine} ${toolMode === "guides" ? styles.guideLineDraggable : ""} ${draggingGuideKey === g.key ? styles.guideLineDragging : ""}`}
                    style={
                      {
                        top: `${guidePositions[g.key] * 100}%`,
                        "--guide-color": g.color,
                      } as React.CSSProperties
                    }
                    onMouseDown={(e) => handleGuideMouseDown(e, g.key)}
                  >
                    <span className={styles.guideLabel}>{g.label}</span>
                    {toolMode === "guides" && (
                      <span className={styles.guideDragHandle}>
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <circle cx="2" cy="2" r="1" fill="currentColor" />
                          <circle cx="6" cy="2" r="1" fill="currentColor" />
                          <circle cx="2" cy="6" r="1" fill="currentColor" />
                          <circle cx="6" cy="6" r="1" fill="currentColor" />
                        </svg>
                      </span>
                    )}
                  </div>
                ),
            )}

            {/* Vertical bearing guides */}
            {visibleGuides.leftBearing && (
              <div
                className={styles.guideLineV}
                style={
                  {
                    left: `${(adj.leftBearing / adj.advanceWidth) * 100}%`,
                    "--guide-color": "#94a3b8",
                  } as React.CSSProperties
                }
              />
            )}
            {visibleGuides.rightBearing && (
              <div
                className={styles.guideLineV}
                style={
                  {
                    right: `${(adj.leftBearing / adj.advanceWidth) * 100}%`,
                    "--guide-color": "#94a3b8",
                  } as React.CSSProperties
                }
              />
            )}

            {parsedSVG ? (
              <div
                className={`${styles.svgWrapper} ${toolMode === "move" ? styles.svgWrapperMovable : ""}`}
              >
                <svg
                  width={CANVAS_W}
                  height={CANVAS_H}
                  viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
                  style={{
                    position: "absolute",
                    inset: 0,
                    overflow: "visible",
                  }}
                >
                  <g ref={svgGRef} transform={adjustTransform}>
                    <svg
                      x={0}
                      y={0}
                      width={CANVAS_W}
                      height={CANVAS_H}
                      viewBox={parsedSVG.viewBox}
                      preserveAspectRatio="xMidYMid meet"
                      overflow="visible"
                    >
                      <g
                        dangerouslySetInnerHTML={{
                          __html: parsedSVG.innerContent,
                        }}
                      />
                    </svg>
                  </g>
                </svg>
              </div>
            ) : (
              <div className={styles.emptyCanvas}>
                <div className={styles.emptyChar}>{char}</div>
                <button className={styles.uploadBtn} onClick={handleUpload}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
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
                  Upload SVG
                </button>
              </div>
            )}

            {glyph?.svgContent && (
              <button
                className={styles.replaceBtn}
                onClick={handleUpload}
                title="Replace SVG"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path
                    d="M5.5 1v5M3 4l2.5-3L8 4"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M1 8h9"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
                Replace
              </button>
            )}

            {/* Active tool hint overlay */}
            {toolMode !== "select" && !isDraggingGlyph && !draggingGuideKey && (
              <div className={styles.toolHint}>
                {toolMode === "move" && "Drag to reposition glyph"}
                {toolMode === "guides" && "Drag a guide line to reposition it"}
              </div>
            )}
          </div>

          <div className={styles.canvasInfo}>
            <span>Em: 1000 UPM</span>
            <span>Advance: {adj.advanceWidth}u</span>
            <span>LSB: {adj.leftBearing}u</span>
            <span>Rotate: {adj.rotate}°</span>
            <span>
              Scale: {adj.scaleX.toFixed(2)}×{adj.scaleY.toFixed(2)}
            </span>
            {parsedSVG && (
              <span style={{ color: "var(--text-tertiary)", opacity: 0.6 }}>
                vb: {parsedSVG.viewBox}
              </span>
            )}
          </div>
        </div>

        {/* Controls panel */}
        <div className={styles.controls}>
          <div className={styles.tabs}>
            {(["transform", "spacing", "guides"] as const).map((tab) => (
              <button
                key={tab}
                className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <div className={styles.tabContent}>
            {/* ── Transform tab ── */}
            {activeTab === "transform" && (
              <div className={styles.section}>
                {/* ── Scale ── */}
                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabelRow}>
                    <span className={styles.fieldLabel}>Scale X</span>
                    <button
                      className={`${styles.lockBtn} ${scaleLocked ? styles.lockBtnActive : ""}`}
                      onClick={() => setScaleLocked((l) => !l)}
                      title={
                        scaleLocked
                          ? "Unlock X/Y scale"
                          : "Lock X/Y scale together"
                      }
                    >
                      {scaleLocked ? (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 11 11"
                          fill="none"
                        >
                          <rect
                            x="2"
                            y="5"
                            width="7"
                            height="5"
                            rx="1"
                            stroke="currentColor"
                            strokeWidth="1.2"
                          />
                          <path
                            d="M3.5 5V3.5a2 2 0 0 1 4 0V5"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                          />
                        </svg>
                      ) : (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 11 11"
                          fill="none"
                        >
                          <rect
                            x="2"
                            y="5"
                            width="7"
                            height="5"
                            rx="1"
                            stroke="currentColor"
                            strokeWidth="1.2"
                          />
                          <path
                            d="M3.5 5V3a2 2 0 0 1 4 0"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                          />
                        </svg>
                      )}
                      {scaleLocked ? "Linked" : "Link"}
                    </button>
                  </div>
                  <div className={styles.sliderRow}>
                    <input
                      type="range"
                      min="10"
                      max="300"
                      step="1"
                      value={scaleXPct}
                      onChange={(e) =>
                        handleScaleXPct(parseInt(e.target.value))
                      }
                      className={styles.slider}
                    />
                    <div className={styles.numInputWrap}>
                      <input
                        type="number"
                        min="10"
                        max="300"
                        step="1"
                        value={scaleXPct}
                        onChange={(e) =>
                          handleScaleXPct(parseInt(e.target.value) || 100)
                        }
                        className={styles.numInput}
                      />
                      <span className={styles.numUnit}>%</span>
                    </div>
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabelRow}>
                    <span className={styles.fieldLabel}>Scale Y</span>
                    {scaleLocked && (
                      <span className={styles.linkedBadge}>
                        <svg
                          width="9"
                          height="9"
                          viewBox="0 0 11 11"
                          fill="none"
                        >
                          <rect
                            x="2"
                            y="5"
                            width="7"
                            height="5"
                            rx="1"
                            stroke="currentColor"
                            strokeWidth="1.2"
                          />
                          <path
                            d="M3.5 5V3.5a2 2 0 0 1 4 0V5"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                          />
                        </svg>
                        Linked
                      </span>
                    )}
                  </div>
                  <div className={styles.sliderRow}>
                    <input
                      type="range"
                      min="10"
                      max="300"
                      step="1"
                      value={scaleYPct}
                      onChange={(e) =>
                        handleScaleYPct(parseInt(e.target.value))
                      }
                      className={styles.slider}
                    />
                    <div className={styles.numInputWrap}>
                      <input
                        type="number"
                        min="10"
                        max="300"
                        step="1"
                        value={scaleYPct}
                        onChange={(e) =>
                          handleScaleYPct(parseInt(e.target.value) || 100)
                        }
                        className={styles.numInput}
                      />
                      <span className={styles.numUnit}>%</span>
                    </div>
                  </div>
                </div>

                <div className={styles.sectionDivider} />

                {/* ── Position ── */}
                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabelRow}>
                    <span className={styles.fieldLabel}>Offset X</span>
                    <span className={styles.fieldUnit}>px</span>
                  </div>
                  <div className={styles.sliderRow}>
                    <input
                      type="range"
                      min="-200"
                      max="200"
                      step="1"
                      value={adj.offsetX}
                      onChange={(e) =>
                        update({ offsetX: parseInt(e.target.value) })
                      }
                      className={styles.slider}
                    />
                    <input
                      type="number"
                      min="-200"
                      max="200"
                      step="1"
                      value={adj.offsetX}
                      onChange={(e) =>
                        update({ offsetX: parseInt(e.target.value) || 0 })
                      }
                      className={styles.numInput}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabelRow}>
                    <span className={styles.fieldLabel}>Offset Y</span>
                    <span className={styles.fieldUnit}>px</span>
                  </div>
                  <div className={styles.sliderRow}>
                    <input
                      type="range"
                      min="-200"
                      max="200"
                      step="1"
                      value={adj.offsetY}
                      onChange={(e) =>
                        update({ offsetY: parseInt(e.target.value) })
                      }
                      className={styles.slider}
                    />
                    <input
                      type="number"
                      min="-200"
                      max="200"
                      step="1"
                      value={adj.offsetY}
                      onChange={(e) =>
                        update({ offsetY: parseInt(e.target.value) || 0 })
                      }
                      className={styles.numInput}
                    />
                  </div>
                </div>

                <div className={styles.sectionDivider} />

                {/* ── Rotation ── */}
                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabelRow}>
                    <span className={styles.fieldLabel}>Rotate</span>
                    <span className={styles.fieldUnit}>deg</span>
                  </div>
                  <div className={styles.sliderRow}>
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      step="0.5"
                      value={adj.rotate}
                      onChange={(e) =>
                        update({ rotate: parseFloat(e.target.value) })
                      }
                      className={styles.slider}
                    />
                    <div className={styles.numInputWrap}>
                      <input
                        type="number"
                        min="-180"
                        max="180"
                        step="0.5"
                        value={adj.rotate}
                        onChange={(e) =>
                          update({ rotate: parseFloat(e.target.value) || 0 })
                        }
                        className={styles.numInput}
                      />
                      <span className={styles.numUnit}>°</span>
                    </div>
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabelRow}>
                    <span className={styles.fieldLabel}>Baseline shift</span>
                    <span className={styles.fieldUnit}>px</span>
                  </div>
                  <div className={styles.sliderRow}>
                    <input
                      type="range"
                      min="-200"
                      max="200"
                      step="1"
                      value={adj.baseline}
                      onChange={(e) =>
                        update({ baseline: parseInt(e.target.value) })
                      }
                      className={styles.slider}
                    />
                    <input
                      type="number"
                      min="-200"
                      max="200"
                      step="1"
                      value={adj.baseline}
                      onChange={(e) =>
                        update({ baseline: parseInt(e.target.value) || 0 })
                      }
                      className={styles.numInput}
                    />
                  </div>
                </div>

                <div className={styles.sectionDivider} />

                {/* ── Flip ── */}
                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Flip</span>
                  <div className={styles.flipRow}>
                    <button
                      className={`${styles.flipBtn} ${adj.flipH ? styles.flipBtnActive : ""}`}
                      onClick={() => update({ flipH: !adj.flipH })}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        <path
                          d="M7 2v10M4 4L2 7l2 3M10 4l2 3-2 3"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Horizontal
                    </button>
                    <button
                      className={`${styles.flipBtn} ${adj.flipV ? styles.flipBtnActive : ""}`}
                      onClick={() => update({ flipV: !adj.flipV })}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        <path
                          d="M2 7h10M4 4L7 2l3 2M4 10l3 2 3-2"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Vertical
                    </button>
                  </div>
                </div>

                <button className={styles.resetBtn} onClick={resetAdj}>
                  Reset to fit guidelines
                </button>
              </div>
            )}

            {/* ── Spacing tab ── */}
            {activeTab === "spacing" && (
              <div className={styles.section}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    Advance width <span className={styles.unit}>units</span>
                  </label>
                  <div className={styles.sliderRow}>
                    <input
                      type="range"
                      min="0"
                      max="1200"
                      step="1"
                      value={adj.advanceWidth}
                      onChange={(e) =>
                        update({ advanceWidth: parseInt(e.target.value) })
                      }
                      className={styles.slider}
                    />
                    <input
                      type="number"
                      min="0"
                      max="1200"
                      step="1"
                      value={adj.advanceWidth}
                      onChange={(e) =>
                        update({
                          advanceWidth: parseInt(e.target.value) || 600,
                        })
                      }
                      className={styles.numInput}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    Left side bearing <span className={styles.unit}>units</span>
                  </label>
                  <div className={styles.sliderRow}>
                    <input
                      type="range"
                      min="0"
                      max="400"
                      step="1"
                      value={adj.leftBearing}
                      onChange={(e) =>
                        update({ leftBearing: parseInt(e.target.value) })
                      }
                      className={styles.slider}
                    />
                    <input
                      type="number"
                      min="0"
                      max="400"
                      step="1"
                      value={adj.leftBearing}
                      onChange={(e) =>
                        update({ leftBearing: parseInt(e.target.value) || 0 })
                      }
                      className={styles.numInput}
                    />
                  </div>
                </div>

                <div className={styles.infoBox}>
                  <div className={styles.infoRow}>
                    <span>Right side bearing</span>
                    <strong>
                      {Math.max(0, adj.advanceWidth - adj.leftBearing - 400)}u
                    </strong>
                  </div>
                  <div className={styles.infoRow}>
                    <span>Total advance</span>
                    <strong>{adj.advanceWidth}u</strong>
                  </div>
                  <div className={styles.infoRow}>
                    <span>At 16px</span>
                    <strong>
                      {((adj.advanceWidth / 1000) * 16).toFixed(1)}px
                    </strong>
                  </div>
                </div>

                <div className={styles.spacingViz}>
                  <div className={styles.spacingTrack}>
                    <div
                      className={styles.spacingLSB}
                      style={{
                        width: `${(adj.leftBearing / adj.advanceWidth) * 100}%`,
                      }}
                    />
                    <div className={styles.spacingGlyph}>
                      <span>{char}</span>
                    </div>
                    <div className={styles.spacingRSB} style={{ flex: 1 }} />
                  </div>
                  <div className={styles.spacingLabels}>
                    <span>LSB</span>
                    <span>Glyph</span>
                    <span>RSB</span>
                  </div>
                </div>

                <button className={styles.resetBtn} onClick={resetSpacing}>
                  Reset spacing to default
                </button>
              </div>
            )}

            {/* ── Guides tab ── */}
            {activeTab === "guides" && (
              <div className={styles.section}>
                <p className={styles.guidesNote}>
                  Toggle guide line visibility. Switch to{" "}
                  <strong>Guides tool</strong> (G) to drag them on canvas.
                </p>
                {GUIDE_LINES.map((g) => (
                  <div key={g.key} className={styles.guideToggleRow}>
                    <span
                      className={styles.guideColorDot}
                      style={{ background: g.color }}
                    />
                    <span className={styles.guideName}>{g.label}</span>
                    <span className={styles.guideYVal}>
                      {Math.round(guidePositions[g.key] * 100)}%
                    </span>
                    <button
                      className={`${styles.toggleSmall} ${visibleGuides[g.key] ? styles.toggleSmallOn : ""}`}
                      onClick={() =>
                        setVisibleGuides((prev) => ({
                          ...prev,
                          [g.key]: !prev[g.key],
                        }))
                      }
                      role="switch"
                      aria-checked={visibleGuides[g.key]}
                    >
                      <span className={styles.toggleSmallThumb} />
                    </button>
                  </div>
                ))}

                <div className={styles.guideDivider} />

                <div className={styles.guideToggleRow}>
                  <span
                    className={styles.guideColorDot}
                    style={{ background: "#94a3b8" }}
                  />
                  <span className={styles.guideName}>Left bearing</span>
                  <button
                    className={`${styles.toggleSmall} ${visibleGuides.leftBearing ? styles.toggleSmallOn : ""}`}
                    onClick={() =>
                      setVisibleGuides((prev) => ({
                        ...prev,
                        leftBearing: !prev.leftBearing,
                      }))
                    }
                    role="switch"
                    aria-checked={visibleGuides.leftBearing}
                  >
                    <span className={styles.toggleSmallThumb} />
                  </button>
                </div>

                <div className={styles.guideToggleRow}>
                  <span
                    className={styles.guideColorDot}
                    style={{ background: "#94a3b8" }}
                  />
                  <span className={styles.guideName}>Right bearing</span>
                  <button
                    className={`${styles.toggleSmall} ${visibleGuides.rightBearing ? styles.toggleSmallOn : ""}`}
                    onClick={() =>
                      setVisibleGuides((prev) => ({
                        ...prev,
                        rightBearing: !prev.rightBearing,
                      }))
                    }
                    role="switch"
                    aria-checked={visibleGuides.rightBearing}
                  >
                    <span className={styles.toggleSmallThumb} />
                  </button>
                </div>

                <div className={styles.guideDivider} />

                <button
                  className={styles.resetBtn}
                  onClick={() => {
                    setGuidePositions(
                      Object.fromEntries(
                        GUIDE_LINES.map((g) => [g.key, g.defaultY]),
                      ),
                    );
                    setVisibleGuides({
                      ascender: true,
                      capHeight: true,
                      xHeight: true,
                      baseline: true,
                      descender: true,
                      leftBearing: true,
                      rightBearing: true,
                    });
                  }}
                >
                  Reset all guides
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
