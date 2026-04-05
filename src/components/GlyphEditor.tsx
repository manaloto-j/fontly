import { useState, useRef, useEffect, useCallback } from "react";
import { useFontStore } from "../store/useFontStore";
import { CHAR_GROUPS, toCodepoint } from "../constants/charsets";
import { buildPreviewSVG } from "../utils/svgPreview";
import styles from "./GlyphEditor.module.css";

interface GlyphEditorProps {
  codepoint: string;
  onClose: () => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const CANVAS_W = 500;
const CANVAS_H = 600;
const SNAP_THRESHOLD_PX = 10; // pixels — how close before snapping

// ── Guide line definitions ─────────────────────────────────────────────────────
interface GuideLineConfig {
  key: string;
  label: string;
  color: string;
  getY: (
    metrics: ReturnType<typeof useFontStore.getState>["project"]["metrics"],
  ) => number;
}

const GUIDE_CONFIGS: GuideLineConfig[] = [
  {
    key: "ascender",
    label: "Ascender",
    color: "#4a9eff",
    getY: (m) => m.ascender,
  },
  {
    key: "cap",
    label: "Cap Height",
    color: "#a78bfa",
    getY: (m) => m.capHeight,
  },
  {
    key: "xHeight",
    label: "x-Height",
    color: "#34d399",
    getY: (m) => m.xHeight,
  },
  { key: "baseline", label: "Baseline", color: "#f59e0b", getY: (_m) => 0 },
  {
    key: "descender",
    label: "Descender",
    color: "#f87171",
    getY: (m) => m.descender,
  },
];

// ── Snap result ────────────────────────────────────────────────────────────────
interface SnapResult {
  snappedX: number | null; // font-unit X value snapped to, null if no snap
  snappedY: number | null; // font-unit Y value snapped to, null if no snap
  snapXLabel: string | null; // label for X snap
  snapYLabel: string | null; // label for Y snap
  snapYColor: string | null; // color of the snapped guide line
  snapXColor: string | null;
  snapEdge: string | null; // which edge of the glyph is snapping ('top'|'bottom'|'baseline'|'left'|'right'|'center')
}

// ── Font-unit ↔ canvas-pixel conversion ───────────────────────────────────────
function makeConverter(
  metrics: ReturnType<typeof useFontStore.getState>["project"]["metrics"],
) {
  const { ascender, descender, unitsPerEm } = metrics;
  const totalH = ascender - descender;

  // Canvas Y: 0 = top (ascender), CANVAS_H = bottom (descender)
  const fontYToCanvas = (fontY: number): number =>
    ((ascender - fontY) / totalH) * CANVAS_H;

  const canvasYToFont = (canvasY: number): number =>
    ascender - (canvasY / CANVAS_H) * totalH;

  const fontXToCanvas = (fontX: number): number =>
    (fontX / unitsPerEm) * CANVAS_W;

  const canvasXToFont = (canvasX: number): number =>
    (canvasX / CANVAS_W) * unitsPerEm;

  return { fontYToCanvas, canvasYToFont, fontXToCanvas, canvasXToFont };
}

// ── Snap computation ───────────────────────────────────────────────────────────
function computeSnap(
  offsetX: number,
  offsetY: number,
  scaleX: number,
  scaleY: number,
  metrics: ReturnType<typeof useFontStore.getState>["project"]["metrics"],
  svgNaturalW: number,
  svgNaturalH: number,
  zoom: number,
): SnapResult {
  const result: SnapResult = {
    snappedX: null,
    snappedY: null,
    snapXLabel: null,
    snapYLabel: null,
    snapYColor: null,
    snapXColor: null,
    snapEdge: null,
  };

  const conv = makeConverter(metrics);
  const thresholdFontUnits =
    SNAP_THRESHOLD_PX /
    zoom /
    (CANVAS_H / (metrics.ascender - metrics.descender));

  // Compute the glyph's key Y positions in font units
  // The SVG is placed so its baseline = offsetY (baseline shift)
  // Height in font units:
  const glyphHeightFU =
    (svgNaturalH / svgNaturalH) *
    (metrics.ascender - metrics.descender) *
    scaleY;
  // We treat the SVG as spanning from offsetY upward by glyphHeightFU
  const glyphTop = offsetY + glyphHeightFU * 0.8; // approximate cap
  const glyphBottom = offsetY - glyphHeightFU * 0.2; // approximate descender
  const glyphBaseline = offsetY; // baseline

  // Key positions to try snapping from the glyph
  const glyphEdges = [
    { value: glyphTop, edge: "top" },
    { value: glyphBaseline, edge: "baseline" },
    { value: glyphBottom, edge: "bottom" },
  ];

  // Try each guide line against each glyph edge
  let bestDist = Infinity;
  for (const guide of GUIDE_CONFIGS) {
    const guideY = guide.getY(metrics);
    for (const { value: edgeY, edge } of glyphEdges) {
      const dist = Math.abs(edgeY - guideY);
      if (dist < thresholdFontUnits && dist < bestDist) {
        bestDist = dist;
        // How much to shift offsetY so this edge lands on the guide
        const delta = guideY - edgeY;
        result.snappedY = offsetY + delta;
        result.snapYLabel = `${guide.label} · ${edge}`;
        result.snapYColor = guide.color;
        result.snapEdge = edge;
      }
    }
  }

  // Origin X snap (left edge of glyph to x=0)
  const glyphLeft = offsetX;
  if (Math.abs(glyphLeft) < thresholdFontUnits * 2) {
    result.snappedX = 0;
    result.snapXLabel = "Origin X";
    result.snapXColor = "#3b82f6";
  }

  return result;
}

// ── All ordered codepoints ─────────────────────────────────────────────────────
function getAllCodepoints(): string[] {
  return CHAR_GROUPS.flatMap((g) => g.characters.map((ch) => toCodepoint(ch)));
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function GlyphEditor({ codepoint, onClose }: GlyphEditorProps) {
  const project = useFontStore((s) => s.project);
  const glyphs = useFontStore((s) => s.project.glyphs);
  const metrics = useFontStore((s) => s.project.metrics);
  const zoom = useFontStore((s) => s.zoom);
  const { updateAdjustments, uploadGlyph } = useFontStore();

  const glyph = glyphs[codepoint];
  const adj = glyph?.adjustments ?? {
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

  const char = String.fromCodePoint(parseInt(codepoint.replace("U+", ""), 16));

  // ── Ordered codepoint list for prev/next ────────────────────────────────────
  const allCps = getAllCodepoints();
  const cpIdx = allCps.indexOf(codepoint);
  const prevCp = cpIdx > 0 ? allCps[cpIdx - 1] : null;
  const nextCp = cpIdx < allCps.length - 1 ? allCps[cpIdx + 1] : null;

  // ── Canvas / tool state ─────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState<"select" | "move" | "guides">(
    "move",
  );
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // ── Guide visibility ─────────────────────────────────────────────────────────
  const [guideVisible, setGuideVisible] = useState<Record<string, boolean>>({
    ascender: true,
    cap: true,
    xHeight: true,
    baseline: true,
    descender: true,
  });

  // ── Snap state ───────────────────────────────────────────────────────────────
  const [snapResult, setSnapResult] = useState<SnapResult>({
    snappedX: null,
    snappedY: null,
    snapXLabel: null,
    snapYLabel: null,
    snapYColor: null,
    snapXColor: null,
    snapEdge: null,
  });
  const [snapFlash, setSnapFlash] = useState<string | null>(null); // guide key that flashed
  const [isDragging, setIsDragging] = useState(false);
  const [isSnapping, setIsSnapping] = useState(false);

  // ── Drag internals ───────────────────────────────────────────────────────────
  const dragStartMouse = useRef({ x: 0, y: 0 });
  const dragStartOffset = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── SVG natural dimensions (parsed from svgContent) ──────────────────────────
  const [svgDims, setSvgDims] = useState({ w: 100, h: 100 });
  useEffect(() => {
    if (!glyph?.svgContent) return;
    const parser = new DOMParser();
    const doc = parser.parseFromString(glyph.svgContent, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) return;
    const vb = svg.getAttribute("viewBox");
    if (vb) {
      const [, , w, h] = vb
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (w && h) setSvgDims({ w, h });
    } else {
      const w = parseFloat(svg.getAttribute("width") ?? "100");
      const h = parseFloat(svg.getAttribute("height") ?? "100");
      setSvgDims({ w: w || 100, h: h || 100 });
    }
  }, [glyph?.svgContent]);

  // ── Canvas coordinate converter ───────────────────────────────────────────────
  const conv = makeConverter(metrics);

  // ── Guide Y positions on canvas ───────────────────────────────────────────────
  const guideCanvasY = (key: string) => {
    const cfg = GUIDE_CONFIGS.find((g) => g.key === key);
    if (!cfg) return 0;
    return conv.fontYToCanvas(cfg.getY(metrics));
  };

  // ── Drag handler with guide snapping ─────────────────────────────────────────
  const handleSVGMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool !== "move" && activeTool !== "select") return;
      e.preventDefault();
      e.stopPropagation();

      dragStartMouse.current = { x: e.clientX, y: e.clientY };
      dragStartOffset.current = { x: adj.offsetX, y: adj.offsetY };
      setIsDragging(true);

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - dragStartMouse.current.x;
        const dy = ev.clientY - dragStartMouse.current.y;

        // Convert pixel deltas to font units
        const fuPerPxX = metrics.unitsPerEm / CANVAS_W / canvasZoom;
        const fuPerPxY =
          (metrics.ascender - metrics.descender) / CANVAS_H / canvasZoom;

        let newOffsetX = dragStartOffset.current.x + dx * fuPerPxX;
        let newOffsetY = dragStartOffset.current.y - dy * fuPerPxY; // Y is flipped

        // Compute snap
        const snap = computeSnap(
          newOffsetX,
          newOffsetY,
          adj.scaleX,
          adj.scaleY,
          metrics,
          svgDims.w,
          svgDims.h,
          canvasZoom,
        );

        let snapping = false;

        if (snap.snappedX !== null) {
          newOffsetX = snap.snappedX;
          snapping = true;
        }
        if (snap.snappedY !== null) {
          newOffsetY = snap.snappedY;
          snapping = true;
        }

        setSnapResult(snap);
        setIsSnapping(snapping);

        // Flash the guide being snapped to
        if (snap.snapYLabel && snapping) {
          const cfg = GUIDE_CONFIGS.find((g) =>
            snap.snapYLabel?.includes(g.label),
          );
          setSnapFlash(cfg?.key ?? null);
        } else {
          setSnapFlash(null);
        }

        updateAdjustments(codepoint, {
          ...adj,
          offsetX: newOffsetX,
          offsetY: newOffsetY,
        });
      };

      const onUp = () => {
        setIsDragging(false);
        setIsSnapping(false);
        setSnapFlash(null);
        setSnapResult({
          snappedX: null,
          snappedY: null,
          snapXLabel: null,
          snapYLabel: null,
          snapYColor: null,
          snapXColor: null,
          snapEdge: null,
        });
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [
      activeTool,
      adj,
      codepoint,
      metrics,
      canvasZoom,
      svgDims,
      updateAdjustments,
    ],
  );

  // ── Keyboard navigation ───────────────────────────────────────────────────────
  const navigate = (cp: string) => {
    window.dispatchEvent(new CustomEvent("glyph-navigate", { detail: cp }));
  };

  // ── Undo/redo per-editor ──────────────────────────────────────────────────────
  const [localHistory, setLocalHistory] = useState([adj]);
  const [localIdx, setLocalIdx] = useState(0);

  const localUndo = () => {
    if (localIdx <= 0) return;
    const idx = localIdx - 1;
    setLocalIdx(idx);
    updateAdjustments(codepoint, localHistory[idx]);
  };
  const localRedo = () => {
    if (localIdx >= localHistory.length - 1) return;
    const idx = localIdx + 1;
    setLocalIdx(idx);
    updateAdjustments(codepoint, localHistory[idx]);
  };

  // ── Upload ────────────────────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      uploadGlyph(codepoint, content, file.name);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── Active tab ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<
    "transform" | "spacing" | "guides"
  >("transform");

  // ── Slider helper ─────────────────────────────────────────────────────────────
  const Slider = ({
    label,
    value,
    min,
    max,
    step = 1,
    unit,
    onChange,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    onChange: (v: number) => void;
  }) => (
    <div className={styles.fieldGroup}>
      <div className={styles.fieldLabelRow}>
        <span className={styles.fieldLabel}>{label}</span>
        {unit && <span className={styles.fieldUnit}>{unit}</span>}
      </div>
      <div className={styles.sliderRow}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className={styles.slider}
        />
        <div className={styles.numInputWrap}>
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value) || value)}
            className={styles.numInput}
          />
          {unit && <span className={styles.numUnit}>{unit}</span>}
        </div>
      </div>
    </div>
  );

  // ── Canvas dimensions ─────────────────────────────────────────────────────────
  const displayW = CANVAS_W * canvasZoom;
  const displayH = CANVAS_H * canvasZoom;

  // ── SVG transform for the glyph inside the canvas ────────────────────────────
  const { ascender, descender, unitsPerEm } = metrics;
  const totalH = ascender - descender;

  const svgScaleX = (CANVAS_W / unitsPerEm) * adj.scaleX * (adj.flipH ? -1 : 1);
  const svgScaleY = (CANVAS_H / totalH) * adj.scaleY * (adj.flipV ? -1 : 1);

  const svgOriginX = (adj.offsetX / unitsPerEm) * CANVAS_W;
  const svgOriginY = ((ascender - adj.offsetY) / totalH) * CANVAS_H;

  // ── Render guide lines on canvas ──────────────────────────────────────────────
  const renderGuideLines = () =>
    GUIDE_CONFIGS.map((cfg) => {
      if (!guideVisible[cfg.key]) return null;
      const y = conv.fontYToCanvas(cfg.getY(metrics)) * canvasZoom;
      const isSnapped = snapFlash === cfg.key;
      const isDraggingGuide = activeTool === "guides";

      return (
        <div
          key={cfg.key}
          className={`${styles.guideLine} ${isDraggingGuide ? styles.guideLineDraggable : ""} ${isSnapped ? styles.guideLineSnapped : ""}`}
          style={
            {
              top: y,
              "--guide-color": cfg.color,
              zIndex: isSnapped ? 15 : 10,
              opacity: isSnapped ? 1 : undefined,
            } as React.CSSProperties
          }
        >
          <div
            className={styles.vizLineFillCanvas}
            style={{ background: isSnapped ? cfg.color : undefined }}
          />
          <span
            className={`${styles.guideLabel} ${isSnapped ? styles.guideLabelSnapped : ""}`}
            style={{
              color: cfg.color,
              background: isSnapped ? `${cfg.color}18` : undefined,
            }}
          >
            {cfg.label}
          </span>
          {isSnapped && (
            <div
              className={styles.guideSnapPulse}
              style={{ background: cfg.color }}
            />
          )}
        </div>
      );
    });

  // ── Snap indicators ───────────────────────────────────────────────────────────
  const renderSnapIndicators = () => {
    if (!isDragging) return null;
    return (
      <>
        {snapResult.snappedX !== null && (
          <div
            className={styles.snapLineX}
            style={{
              left: (snapResult.snappedX / unitsPerEm) * CANVAS_W * canvasZoom,
            }}
          />
        )}
        {snapResult.snappedY !== null && (
          <div
            className={styles.snapLineY}
            style={{
              top: conv.fontYToCanvas(snapResult.snappedY) * canvasZoom,
            }}
          />
        )}
      </>
    );
  };

  // ── Snap label ────────────────────────────────────────────────────────────────
  const renderSnapLabel = () => {
    if (!isDragging || !isSnapping) return null;
    const parts = [snapResult.snapYLabel, snapResult.snapXLabel].filter(
      Boolean,
    );
    if (!parts.length) return null;
    return (
      <div
        className={styles.snapLabel}
        style={{
          color: snapResult.snapYColor ?? snapResult.snapXColor ?? "#3b82f6",
          background: `${snapResult.snapYColor ?? "#3b82f6"}18`,
          borderColor: `${snapResult.snapYColor ?? "#3b82f6"}44`,
        }}
      >
        {parts.join(" · ")}
      </div>
    );
  };

  return (
    <div className={styles.root}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M8 2L3 6l5 4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back
        </button>

        <div className={styles.glyphTitle}>
          <span className={styles.glyphChar}>{char}</span>
          <div className={styles.glyphMeta}>
            <span className={styles.glyphCp}>{codepoint}</span>
            <span className={styles.glyphStatus}>
              {glyph?.svgContent ? (
                <>
                  <span className={styles.dotGreen} /> {glyph.fileName}
                </>
              ) : (
                <>
                  <span className={styles.dotGray} /> No SVG uploaded
                </>
              )}
            </span>
          </div>
        </div>

        {/* Local undo/redo */}
        <div className={styles.localUndoRow}>
          <button
            className={styles.localUndoBtn}
            onClick={localUndo}
            disabled={localIdx <= 0}
            title="Undo"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M2 5h5a3.5 3.5 0 0 1 0 7H5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 5l2.5-2.5M2 5l2.5 2.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            className={styles.localUndoBtn}
            onClick={localRedo}
            disabled={localIdx >= localHistory.length - 1}
            title="Redo"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M11 5H6a3.5 3.5 0 0 0 0 7h2"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M11 5l-2.5-2.5M11 5l-2.5 2.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* Prev/Next navigation */}
        <div className={styles.navButtons}>
          <button
            className={styles.navBtn}
            onClick={() => prevCp && navigate(prevCp)}
            disabled={!prevCp}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M8 2L4 6l4 4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className={styles.navCount}>
            {cpIdx + 1} / {allCps.length}
          </span>
          <button
            className={styles.navBtn}
            onClick={() => nextCp && navigate(nextCp)}
            disabled={!nextCp}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M4 2l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className={styles.body}>
        {/* ── Canvas area ── */}
        <div className={styles.canvasArea}>
          {/* Tool palette */}
          <div className={styles.toolPalette}>
            {(
              [
                {
                  id: "select",
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M2 2l4 10 2-4 4-2L2 2z"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ),
                  label: "Select",
                },
                {
                  id: "move",
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M7 2v10M2 7h10M5 4l-3 3 3 3M9 4l3 3-3 3"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ),
                  label: "Move",
                },
                {
                  id: "guides",
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M2 4h10M2 7h10M2 10h10"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                    </svg>
                  ),
                  label: "Guides",
                },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                className={`${styles.toolBtn} ${activeTool === t.id ? styles.toolBtnActive : ""}`}
                onClick={() => setActiveTool(t.id)}
                title={t.label}
              >
                {t.icon}
                <span className={styles.toolBtnLabel}>{t.label}</span>
              </button>
            ))}
          </div>

          {/* Zoom controls */}
          <div className={styles.zoomControls}>
            <button
              className={styles.zoomBtn}
              onClick={() => setCanvasZoom((z) => Math.max(0.25, z - 0.25))}
              disabled={canvasZoom <= 0.25}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M2 5h6"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              className={styles.zoomLevel}
              onClick={() => setCanvasZoom(1)}
            >
              {Math.round(canvasZoom * 100)}%
            </button>
            <button
              className={styles.zoomBtn}
              onClick={() => setCanvasZoom((z) => Math.min(4, z + 0.25))}
              disabled={canvasZoom >= 4}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M5 2v6M2 5h6"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <div className={styles.zoomDivider} />
            <button
              className={styles.zoomFitBtn}
              onClick={() => setCanvasZoom(1)}
            >
              Fit
            </button>
          </div>

          {/* The canvas */}
          <div
            ref={canvasRef}
            className={styles.canvas}
            style={{ width: displayW, height: displayH }}
          >
            {/* Guide lines */}
            {renderGuideLines()}

            {/* Vertical guides: LSB and advance width */}
            <div
              className={styles.guideLineV}
              style={
                {
                  left: (adj.leftBearing / unitsPerEm) * CANVAS_W * canvasZoom,
                  "--guide-color": "#94a3b8",
                } as React.CSSProperties
              }
            />
            <div
              className={styles.guideLineV}
              style={
                {
                  left: (adj.advanceWidth / unitsPerEm) * CANVAS_W * canvasZoom,
                  "--guide-color": "#94a3b8",
                } as React.CSSProperties
              }
            />

            {/* SVG glyph */}
            {glyph?.svgContent ? (
              <div
                className={`${styles.svgWrapper} ${activeTool === "move" ? styles.svgWrapperMovable : ""}`}
                style={{
                  cursor:
                    activeTool === "move"
                      ? isDragging
                        ? "grabbing"
                        : "grab"
                      : "default",
                  position: "absolute",
                  inset: 0,
                  transformOrigin: "0 0",
                  transform: `scale(${canvasZoom})`,
                  zIndex: 5,
                }}
                onMouseDown={handleSVGMouseDown}
              >
                <svg
                  width={CANVAS_W}
                  height={CANVAS_H}
                  viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
                  style={{ position: "absolute", inset: 0 }}
                >
                  <g
                    transform={`
                      translate(${svgOriginX}, ${svgOriginY})
                      scale(${svgScaleX}, ${-svgScaleY})
                      rotate(${adj.rotate})
                    `}
                    style={{ transformBox: "fill-box" }}
                    dangerouslySetInnerHTML={{
                      __html: (() => {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(
                          glyph.svgContent!,
                          "image/svg+xml",
                        );
                        const svg = doc.querySelector("svg");
                        return svg?.innerHTML ?? "";
                      })(),
                    }}
                  />
                </svg>
              </div>
            ) : (
              <div className={styles.emptyCanvas}>
                <span className={styles.emptyChar}>{char}</span>
                <button
                  className={styles.uploadBtn}
                  onClick={() => fileInputRef.current?.click()}
                >
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

            {/* Replace button */}
            {glyph?.svgContent && (
              <button
                className={styles.replaceBtn}
                onClick={() => fileInputRef.current?.click()}
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path
                    d="M1 5.5A4.5 4.5 0 0 1 9.5 3M10 5.5A4.5 4.5 0 0 1 1.5 8"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                  <path
                    d="M9 1l.5 2-2 .5"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M2 9.5l-.5-2 2-.5"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Replace
              </button>
            )}

            {/* Snap indicators */}
            {renderSnapIndicators()}

            {/* Tool hint */}
            {activeTool === "move" && !isDragging && glyph?.svgContent && (
              <div className={styles.toolHint}>
                Drag to move · Snaps to guide lines
              </div>
            )}
            {activeTool === "guides" && (
              <div className={styles.toolHint}>
                Guide lines visible · Toggle in panel →
              </div>
            )}
          </div>

          {/* Snap label (outside canvas, over the whole area) */}
          {renderSnapLabel()}

          {/* Canvas info bar */}
          <div className={styles.canvasInfo}>
            <span>X: {Math.round(adj.offsetX)}</span>
            <span>Y: {Math.round(adj.offsetY)}</span>
            <span>Scale: {(adj.scaleX * 100).toFixed(0)}%</span>
            <span>
              {CANVAS_W} × {CANVAS_H} px
            </span>
          </div>
        </div>

        {/* ── Controls panel ── */}
        <div className={styles.controls}>
          <div className={styles.tabs}>
            {(["transform", "spacing", "guides"] as const).map((tab) => (
              <button
                key={tab}
                className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === "transform"
                  ? "Transform"
                  : tab === "spacing"
                    ? "Spacing"
                    : "Guides"}
              </button>
            ))}
          </div>

          <div className={styles.tabContent}>
            {/* ── Transform tab ── */}
            {activeTab === "transform" && (
              <div className={styles.section}>
                <Slider
                  label="Scale X"
                  value={Math.round(adj.scaleX * 100)}
                  min={10}
                  max={300}
                  unit="%"
                  onChange={(v) =>
                    updateAdjustments(codepoint, { ...adj, scaleX: v / 100 })
                  }
                />
                <Slider
                  label="Scale Y"
                  value={Math.round(adj.scaleY * 100)}
                  min={10}
                  max={300}
                  unit="%"
                  onChange={(v) =>
                    updateAdjustments(codepoint, { ...adj, scaleY: v / 100 })
                  }
                />
                <div className={styles.sectionDivider} />
                <Slider
                  label="Offset X"
                  value={Math.round(adj.offsetX)}
                  min={-500}
                  max={500}
                  onChange={(v) =>
                    updateAdjustments(codepoint, { ...adj, offsetX: v })
                  }
                />
                <Slider
                  label="Offset Y"
                  value={Math.round(adj.offsetY)}
                  min={-500}
                  max={500}
                  onChange={(v) =>
                    updateAdjustments(codepoint, { ...adj, offsetY: v })
                  }
                />
                <div className={styles.sectionDivider} />
                <Slider
                  label="Rotate"
                  value={adj.rotate}
                  min={-180}
                  max={180}
                  unit="°"
                  onChange={(v) =>
                    updateAdjustments(codepoint, { ...adj, rotate: v })
                  }
                />
                <div className={styles.flipRow}>
                  <button
                    className={`${styles.flipBtn} ${adj.flipH ? styles.flipBtnActive : ""}`}
                    onClick={() =>
                      updateAdjustments(codepoint, {
                        ...adj,
                        flipH: !adj.flipH,
                      })
                    }
                  >
                    Flip H
                  </button>
                  <button
                    className={`${styles.flipBtn} ${adj.flipV ? styles.flipBtnActive : ""}`}
                    onClick={() =>
                      updateAdjustments(codepoint, {
                        ...adj,
                        flipV: !adj.flipV,
                      })
                    }
                  >
                    Flip V
                  </button>
                </div>
                <button
                  className={styles.resetBtn}
                  onClick={() =>
                    updateAdjustments(codepoint, {
                      scaleX: 1,
                      scaleY: 1,
                      offsetX: 0,
                      offsetY: 0,
                      rotate: 0,
                      flipH: false,
                      flipV: false,
                      baseline: 0,
                      advanceWidth: adj.advanceWidth,
                      leftBearing: adj.leftBearing,
                    })
                  }
                >
                  Reset transform
                </button>
              </div>
            )}

            {/* ── Spacing tab ── */}
            {activeTab === "spacing" && (
              <div className={styles.section}>
                <Slider
                  label="Advance Width"
                  value={adj.advanceWidth}
                  min={0}
                  max={2000}
                  onChange={(v) =>
                    updateAdjustments(codepoint, { ...adj, advanceWidth: v })
                  }
                />
                <Slider
                  label="Left Bearing"
                  value={adj.leftBearing}
                  min={-200}
                  max={500}
                  onChange={(v) =>
                    updateAdjustments(codepoint, { ...adj, leftBearing: v })
                  }
                />
                <div className={styles.sectionDivider} />
                <div className={styles.infoBox}>
                  <div className={styles.infoRow}>
                    <span>Advance</span>
                    <strong>{adj.advanceWidth} u</strong>
                  </div>
                  <div className={styles.infoRow}>
                    <span>LSB</span>
                    <strong>{adj.leftBearing} u</strong>
                  </div>
                  <div className={styles.infoRow}>
                    <span>RSB</span>
                    <strong>
                      {Math.round(
                        adj.advanceWidth -
                          adj.leftBearing -
                          ((svgDims.w * adj.scaleX) / metrics.unitsPerEm) *
                            adj.advanceWidth,
                      )}{" "}
                      u
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {/* ── Guides tab ── */}
            {activeTab === "guides" && (
              <div className={styles.section}>
                <p className={styles.guidesNote}>
                  Guide lines appear on the canvas. When{" "}
                  <strong>dragging</strong> your glyph, it will{" "}
                  <strong>snap</strong> to nearby guide lines automatically.
                  Toggle visibility below.
                </p>

                <div className={styles.sectionDivider} />

                {GUIDE_CONFIGS.map((cfg) => {
                  const isVisible = guideVisible[cfg.key];
                  const yVal = cfg.getY(metrics);
                  return (
                    <div key={cfg.key} className={styles.guideToggleRow}>
                      <span
                        className={styles.guideColorDot}
                        style={{ background: cfg.color }}
                      />
                      <span className={styles.guideName}>{cfg.label}</span>
                      <span className={styles.guideYVal}>
                        {yVal > 0 ? "+" : ""}
                        {yVal}
                      </span>
                      <button
                        className={`${styles.toggleSmall} ${isVisible ? styles.toggleSmallOn : ""}`}
                        onClick={() =>
                          setGuideVisible((v) => ({
                            ...v,
                            [cfg.key]: !v[cfg.key],
                          }))
                        }
                        title={`${isVisible ? "Hide" : "Show"} ${cfg.label} guide`}
                      >
                        <span className={styles.toggleSmallThumb} />
                      </button>
                    </div>
                  );
                })}

                <div className={styles.sectionDivider} />

                {/* Snap sensitivity hint */}
                <div className={styles.snapHintBox}>
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 13 13"
                    fill="none"
                    style={{ flexShrink: 0 }}
                  >
                    <circle
                      cx="6.5"
                      cy="6.5"
                      r="5"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    />
                    <path
                      d="M6.5 5.5v3M6.5 4.5v.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span>
                    Drag the glyph within <strong>{SNAP_THRESHOLD_PX}px</strong>{" "}
                    of a guide line to snap. The glyph's top, baseline, or
                    bottom edge will lock to the nearest guide.
                  </span>
                </div>

                {/* Quick snap buttons */}
                <p className={styles.snapQuickLabel}>Quick snap</p>
                <div className={styles.snapQuickGrid}>
                  {GUIDE_CONFIGS.map((cfg) => (
                    <button
                      key={cfg.key}
                      className={styles.snapQuickBtn}
                      style={
                        { "--snap-color": cfg.color } as React.CSSProperties
                      }
                      onClick={() => {
                        // Snap baseline to this guide
                        const targetY = cfg.getY(metrics);
                        updateAdjustments(codepoint, {
                          ...adj,
                          offsetY: targetY,
                        });
                      }}
                      title={`Snap baseline to ${cfg.label} (${cfg.getY(metrics)})`}
                    >
                      <span
                        className={styles.snapQuickDot}
                        style={{ background: cfg.color }}
                      />
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
