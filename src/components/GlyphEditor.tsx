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
const DEFAULT_SPACING = { advanceWidth: 600, leftBearing: 50 };

const CANVAS_W = 480;
const CANVAS_H = 520;
const BASELINE_Y = 0.75;
const CAP_HEIGHT_Y = 0.18;
const ZOOM_MIN = 0.25,
  ZOOM_MAX = 8,
  ZOOM_STEP_KEY = 0.25,
  ZOOM_WHEEL_K = 0.001;

// Snap threshold in canvas-space px — tested against actual bbox edges
const SNAP_THRESHOLD = 10;

type SnapEdgeY = {
  guideKey: string;
  label: string;
  color: string;
  canvasY: number;
};
type SnapEdgeX = { label: string; color: string; canvasX: number };
type SnapTarget = { edgeY?: SnapEdgeY; edgeX?: SnapEdgeX } | null;

interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function parseSVGContent(svgString: string) {
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
    const p = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (p.length === 4) {
      vbW = p[2];
      vbH = p[3];
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
}): Partial<GlyphAdjustments> {
  const capY_px = CAP_HEIGHT_Y * CANVAS_H;
  const baseY_px = BASELINE_Y * CANVAS_H;
  const targetH = baseY_px - capY_px;
  const padding = 40;
  const fit = Math.min(
    (CANVAS_W - padding * 2) / parsedSVG.width,
    (CANVAS_H - padding * 2) / parsedSVG.height,
  );
  const scale = parseFloat((targetH / (parsedSVG.height * fit)).toFixed(3));
  const offsetY = Math.round(
    baseY_px - (CANVAS_H / 2 + (parsedSVG.height * fit * scale) / 2),
  );
  return {
    scaleX: scale,
    scaleY: scale,
    offsetX: 0,
    offsetY,
    rotate: 0,
    baseline: 0,
  };
}

function clampZoom(z: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}
function centredViewport(w: number, h: number): Viewport {
  return { zoom: 1, panX: (w - CANVAS_W) / 2, panY: (h - CANVAS_H) / 2 };
}

// Bottom-anchor: pivot = baseline centre; scale grows upward from there
function buildTransform(
  adj: GlyphAdjustments,
  baselineCanvasY: number,
): string {
  const fsx = adj.flipH ? -1 : 1,
    fsy = adj.flipV ? -1 : 1;
  const pivotX = CANVAS_W / 2,
    pivotY = baselineCanvasY + adj.baseline;
  return [
    `translate(${pivotX + adj.offsetX}, ${pivotY + adj.offsetY})`,
    adj.rotate !== 0 ? `rotate(${adj.rotate})` : "",
    `scale(${adj.scaleX * fsx}, ${adj.scaleY * fsy})`,
    `translate(${-pivotX}, ${-pivotY})`,
  ]
    .filter(Boolean)
    .join(" ");
}

function useAdjustmentHistory(initial: GlyphAdjustments) {
  const [stack, setStack] = useState<GlyphAdjustments[]>([initial]);
  const [index, setIndex] = useState(0);
  const push = useCallback(
    (adj: GlyphAdjustments) => {
      setStack((prev) => {
        const n = prev.slice(0, index + 1);
        n.push({ ...adj });
        if (n.length > 60) n.shift();
        return n;
      });
      setIndex((prev) => Math.min(prev + 1, 59));
    },
    [index],
  );
  const undo = useCallback(() => {
    if (index <= 0) return null;
    const ni = index - 1;
    setIndex(ni);
    return stack[ni];
  }, [index, stack]);
  const redo = useCallback(() => {
    if (index >= stack.length - 1) return null;
    const ni = index + 1;
    setIndex(ni);
    return stack[ni];
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

// ── Bbox-edge snap ─────────────────────────────────────────────────────────────
// Writes rawOffset transform → reads getBBox() → computes closest edge-to-guide
// delta → returns snapped offsets + which targets fired.
// The caller must write the final snapped transform after this returns.
function computeBBoxSnap(
  svgGEl: SVGGElement,
  rawOffX: number,
  rawOffY: number,
  snap: GlyphAdjustments,
  baselineCanvasY: number,
  guidePositions: Record<string, number>,
  visibleGuides: Record<string, boolean>,
): { offX: number; offY: number; target: SnapTarget } {
  const fsx = snap.flipH ? -1 : 1,
    fsy = snap.flipV ? -1 : 1;
  const pivotX = CANVAS_W / 2,
    pivotY = baselineCanvasY + snap.baseline;

  // Write tentative raw transform so getBBox() reflects it
  const tRaw = [
    `translate(${pivotX + rawOffX}, ${pivotY + rawOffY})`,
    snap.rotate !== 0 ? `rotate(${snap.rotate})` : "",
    `scale(${snap.scaleX * fsx}, ${snap.scaleY * fsy})`,
    `translate(${-pivotX}, ${-pivotY})`,
  ]
    .filter(Boolean)
    .join(" ");
  svgGEl.setAttribute("transform", tRaw);

  let bbox: DOMRect;
  try {
    bbox = svgGEl.getBBox();
  } catch {
    return { offX: rawOffX, offY: rawOffY, target: null };
  }

  if (bbox.width === 0 && bbox.height === 0)
    return { offX: rawOffX, offY: rawOffY, target: null };

  const bTop = bbox.y;
  const bBottom = bbox.y + bbox.height;
  const bLeft = bbox.x;
  const bRight = bbox.x + bbox.width;
  const bCX = bbox.x + bbox.width / 2;

  // ── Y: snap top or bottom edge to any visible guide ───────────────────────
  let bestYDist = SNAP_THRESHOLD + 1;
  let bestEdgeY: SnapEdgeY | undefined;
  let snappedOffY = rawOffY;

  for (const g of GUIDE_LINES) {
    if (!visibleGuides[g.key]) continue;
    const guideY = guidePositions[g.key] * CANVAS_H;

    const distTop = Math.abs(bTop - guideY);
    if (distTop < bestYDist) {
      bestYDist = distTop;
      snappedOffY = rawOffY + (guideY - bTop);
      bestEdgeY = {
        guideKey: g.key,
        label: `Top → ${g.label}`,
        color: g.color,
        canvasY: guideY,
      };
    }

    const distBot = Math.abs(bBottom - guideY);
    if (distBot < bestYDist) {
      bestYDist = distBot;
      snappedOffY = rawOffY + (guideY - bBottom);
      bestEdgeY = {
        guideKey: g.key,
        label: `Bottom → ${g.label}`,
        color: g.color,
        canvasY: guideY,
      };
    }
  }

  // ── X: snap left edge, right edge, or centre-X to canvas centre ───────────
  const canvasCX = CANVAS_W / 2;
  let bestXDist = SNAP_THRESHOLD + 1;
  let bestEdgeX: SnapEdgeX | undefined;
  let snappedOffX = rawOffX;

  const xCandidates: { dist: number; delta: number; label: string }[] = [
    {
      dist: Math.abs(bCX - canvasCX),
      delta: canvasCX - bCX,
      label: "Center X",
    },
    {
      dist: Math.abs(bLeft - canvasCX),
      delta: canvasCX - bLeft,
      label: "Left → Center",
    },
    {
      dist: Math.abs(bRight - canvasCX),
      delta: canvasCX - bRight,
      label: "Right → Center",
    },
  ];
  for (const c of xCandidates) {
    if (c.dist < bestXDist) {
      bestXDist = c.dist;
      snappedOffX = rawOffX + c.delta;
      bestEdgeX = { label: c.label, color: "#94a3b8", canvasX: canvasCX };
    }
  }

  const target: SnapTarget =
    bestEdgeX || bestEdgeY ? { edgeX: bestEdgeX, edgeY: bestEdgeY } : null;

  return { offX: snappedOffX, offY: snappedOffY, target };
}

// ─────────────────────────────────────────────────────────────────────────────
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

  // ── Guide state ──────────────────────────────────────────────────────────────
  const [visibleGuides, setVisibleGuides] = useState<Record<string, boolean>>({
    ascender: true,
    capHeight: true,
    xHeight: true,
    baseline: true,
    descender: true,
    leftBearing: true,
    rightBearing: true,
  });
  const [guidePositions, setGuidePositions] = useState<Record<string, number>>(
    Object.fromEntries(GUIDE_LINES.map((g) => [g.key, g.defaultY])),
  );

  // Stable refs so drag closures always read latest values
  const guidePositionsRef = useRef(guidePositions);
  guidePositionsRef.current = guidePositions;
  const visibleGuidesRef = useRef(visibleGuides);
  visibleGuidesRef.current = visibleGuides;

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<
    "transform" | "spacing" | "guides"
  >("transform");
  const [scaleLocked, setScaleLocked] = useState(true);
  const [toolMode, setToolMode] = useState<"select" | "move" | "guides">(
    "select",
  );

  // ── Viewport ─────────────────────────────────────────────────────────────────
  const [viewport, setViewport] = useState<Viewport>({
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoFitApplied = useRef(false);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgGRef = useRef<SVGGElement>(null);

  // Snap feedback — zero React re-renders during drag
  const snapLineXRef = useRef<HTMLDivElement>(null);
  const snapLineYRef = useRef<HTMLDivElement>(null);
  const snapLabelRef = useRef<HTMLDivElement>(null);
  const snapGuideRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ── Drag state ────────────────────────────────────────────────────────────────
  const glyphDragRef = useRef<{
    startX: number;
    startY: number;
    startOffX: number;
    startOffY: number;
    adjSnapshot: GlyphAdjustments;
  } | null>(null);
  const [isDraggingGlyph, setIsDraggingGlyph] = useState(false);

  const panDragRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const spaceHeldRef = useRef(false);

  const guideDragRef = useRef<{
    key: string;
    startMouseY: number;
    startFrac: number;
  } | null>(null);
  const [draggingGuideKey, setDraggingGuideKey] = useState<string | null>(null);

  // ── Parsed SVG ────────────────────────────────────────────────────────────────
  const parsedSVG = useMemo(() => {
    if (!glyph?.svgContent) return null;
    return parseSVGContent(glyph.svgContent);
  }, [glyph?.svgContent]);

  const baselineCanvasY = BASELINE_Y * CANVAS_H;

  // ── Init viewport ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasAreaRef.current) return;
    const { width, height } = canvasAreaRef.current.getBoundingClientRect();
    if (width && height) setViewport(centredViewport(width, height));
  }, []);

  // ── Auto-fit ─────────────────────────────────────────────────────────────────
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

  // ── Snap to Origin ────────────────────────────────────────────────────────────
  const snapToOrigin = useCallback(() => {
    const next = { ...adj, offsetX: 0, offsetY: 0 };
    adjHistory.push(next);
    updateAdjustments(codepoint, next);
  }, [adj, adjHistory, codepoint, updateAdjustments]);

  // ── Navigation ───────────────────────────────────────────────────────────────
  const goTo = useCallback(
    (dir: -1 | 1) => {
      const ni = currentIndex + dir;
      if (ni < 0 || ni >= orderedCps.length) return;
      window.dispatchEvent(
        new CustomEvent("glyph-navigate", { detail: orderedCps[ni] }),
      );
    },
    [currentIndex, orderedCps],
  );

  // ── Zoom helpers ─────────────────────────────────────────────────────────────
  const zoomToPoint = useCallback((nz: number, ox: number, oy: number) => {
    setViewport((vp) => {
      const c = clampZoom(nz),
        r = c / vp.zoom;
      return {
        zoom: c,
        panX: ox - r * (ox - vp.panX),
        panY: oy - r * (oy - vp.panY),
      };
    });
  }, []);
  const zoomCentred = useCallback(
    (nz: number) => {
      if (!canvasAreaRef.current) return;
      const { width, height } = canvasAreaRef.current.getBoundingClientRect();
      zoomToPoint(nz, width / 2, height / 2);
    },
    [zoomToPoint],
  );
  const zoomReset = useCallback(() => {
    if (!canvasAreaRef.current) return;
    const { width, height } = canvasAreaRef.current.getBoundingClientRect();
    setViewport(centredViewport(width, height));
  }, []);
  const zoomFit = useCallback(() => {
    if (!canvasAreaRef.current) return;
    const { width, height } = canvasAreaRef.current.getBoundingClientRect();
    const fz = clampZoom(Math.min(width / CANVAS_W, height / CANVAS_H) * 0.85);
    setViewport({
      zoom: fz,
      panX: (width - CANVAS_W * fz) / 2,
      panY: (height - CANVAS_H * fz) / 2,
    });
  }, []);

  // ── Wheel ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect(),
        vp = viewportRef.current;
      if (e.ctrlKey || e.metaKey)
        zoomToPoint(
          clampZoom(vp.zoom * (1 - e.deltaY * ZOOM_WHEEL_K * 10)),
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
      else
        setViewport((v) => ({
          ...v,
          panX: v.panX - e.deltaX,
          panY: v.panY - e.deltaY,
        }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomToPoint]);

  // ── Spacebar ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        spaceHeldRef.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeldRef.current = false;
        setIsPanning(false);
      }
    };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.code === "Space") return;
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowLeft" && (ctrl || e.altKey)) {
        e.preventDefault();
        goTo(-1);
      }
      if (e.key === "ArrowRight" && (ctrl || e.altKey)) {
        e.preventDefault();
        goTo(1);
      }
      if (e.altKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        snapToOrigin();
        return;
      }
      if (ctrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const p = adjHistory.undo();
        if (p) updateAdjustments(codepoint, p);
      }
      if (ctrl && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        e.stopPropagation();
        const n = adjHistory.redo();
        if (n) updateAdjustments(codepoint, n);
      }
      if (ctrl && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomCentred(clampZoom(viewportRef.current.zoom + ZOOM_STEP_KEY));
      }
      if (ctrl && e.key === "-") {
        e.preventDefault();
        zoomCentred(clampZoom(viewportRef.current.zoom - ZOOM_STEP_KEY));
      }
      if (ctrl && e.key === "0") {
        e.preventDefault();
        zoomReset();
      }
      if (ctrl && e.key === "9") {
        e.preventDefault();
        zoomFit();
      }
      if (!ctrl && !e.altKey) {
        if (e.key === "v") setToolMode("select");
        if (e.key === "m") setToolMode("move");
        if (e.key === "g") setToolMode("guides");
        if (e.key === "+" || e.key === "=")
          zoomCentred(clampZoom(viewportRef.current.zoom + ZOOM_STEP_KEY));
        if (e.key === "-")
          zoomCentred(clampZoom(viewportRef.current.zoom - ZOOM_STEP_KEY));
      }
    };
    window.addEventListener("keydown", h, { capture: true });
    return () => window.removeEventListener("keydown", h, { capture: true });
  }, [
    onClose,
    goTo,
    adjHistory,
    codepoint,
    updateAdjustments,
    zoomCentred,
    zoomReset,
    zoomFit,
    snapToOrigin,
  ]);

  const update = (patch: Partial<GlyphAdjustments>) => {
    const next = { ...adj, ...patch };
    adjHistory.push(next);
    updateAdjustments(codepoint, next);
  };

  // ── DOM snap feedback ─────────────────────────────────────────────────────────
  const applySnapFeedbackDOM = useCallback((target: SnapTarget) => {
    // Vertical line at canvas centre (X snap)
    if (snapLineXRef.current) {
      if (target?.edgeX) {
        snapLineXRef.current.style.display = "block";
        snapLineXRef.current.style.left = `${CANVAS_W / 2}px`;
        snapLineXRef.current.style.background = target.edgeX.color;
      } else {
        snapLineXRef.current.style.display = "none";
      }
    }

    // Horizontal line at matched guide (Y snap)
    if (snapLineYRef.current) {
      if (target?.edgeY) {
        snapLineYRef.current.style.display = "block";
        snapLineYRef.current.style.top = `${target.edgeY.canvasY}px`;
        snapLineYRef.current.style.background = target.edgeY.color;
      } else {
        snapLineYRef.current.style.display = "none";
      }
    }

    // Label pill
    if (snapLabelRef.current) {
      const parts: string[] = [];
      if (target?.edgeX) parts.push(`⊡ ${target.edgeX.label}`);
      if (target?.edgeY) parts.push(`⊡ ${target.edgeY.label}`);
      if (parts.length > 0) {
        const c = target?.edgeY?.color ?? target?.edgeX?.color ?? "#94a3b8";
        snapLabelRef.current.style.display = "block";
        snapLabelRef.current.style.color = c;
        snapLabelRef.current.style.borderColor = c;
        snapLabelRef.current.style.background = `${c}1a`;
        snapLabelRef.current.textContent = parts.join("  ·  ");
      } else {
        snapLabelRef.current.style.display = "none";
      }
    }

    // Highlight the snapped guide line
    for (const g of GUIDE_LINES) {
      const el = snapGuideRefs.current[g.key];
      if (!el) continue;
      const snapped = target?.edgeY?.guideKey === g.key;
      el.style.opacity = snapped ? "1" : "";
      el.style.zIndex = snapped ? "16" : "";
    }
  }, []);

  const clearSnapFeedbackDOM = useCallback(() => {
    if (snapLineXRef.current) snapLineXRef.current.style.display = "none";
    if (snapLineYRef.current) snapLineYRef.current.style.display = "none";
    if (snapLabelRef.current) snapLabelRef.current.style.display = "none";
    for (const g of GUIDE_LINES) {
      const el = snapGuideRefs.current[g.key];
      if (!el) continue;
      el.style.opacity = "";
      el.style.zIndex = "";
    }
  }, []);

  // ── Pan ───────────────────────────────────────────────────────────────────────
  const handleAreaPointerDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && spaceHeldRef.current)) {
      e.preventDefault();
      panDragRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startPanX: viewportRef.current.panX,
        startPanY: viewportRef.current.panY,
      };
      setIsPanning(true);
    }
  }, []);

  const handleCanvasAreaMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (spaceHeldRef.current || e.button !== 0 || toolMode !== "move") return;
      const inside = canvasRef.current
        ? (() => {
            const r = canvasRef.current!.getBoundingClientRect();
            return (
              e.clientX >= r.left &&
              e.clientX <= r.right &&
              e.clientY >= r.top &&
              e.clientY <= r.bottom
            );
          })()
        : false;

      if (inside && parsedSVG) {
        e.preventDefault();
        glyphDragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startOffX: adj.offsetX,
          startOffY: adj.offsetY,
          adjSnapshot: { ...adj },
        };
        setIsDraggingGlyph(true);
      } else {
        e.preventDefault();
        panDragRef.current = {
          startMouseX: e.clientX,
          startMouseY: e.clientY,
          startPanX: viewportRef.current.panX,
          startPanY: viewportRef.current.panY,
        };
        setIsPanning(true);
      }
    },
    [toolMode, parsedSVG, adj],
  );

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      if (!panDragRef.current) return;
      setViewport((v) => ({
        ...v,
        panX:
          panDragRef.current!.startPanX +
          (e.clientX - panDragRef.current!.startMouseX),
        panY:
          panDragRef.current!.startPanY +
          (e.clientY - panDragRef.current!.startMouseY),
      }));
    };
    const onUp = () => {
      panDragRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isPanning]);

  // ── Glyph drag — bbox-edge snap, direct DOM ───────────────────────────────────
  useEffect(() => {
    if (!isDraggingGlyph) return;

    const onMove = (e: MouseEvent) => {
      if (!glyphDragRef.current || !svgGRef.current) return;
      const z = viewportRef.current.zoom;
      const snap = glyphDragRef.current.adjSnapshot;
      const rawOffX =
        glyphDragRef.current.startOffX +
        (e.clientX - glyphDragRef.current.startX) / z;
      const rawOffY =
        glyphDragRef.current.startOffY +
        (e.clientY - glyphDragRef.current.startY) / z;

      // computeBBoxSnap writes a temp transform internally; we overwrite with snapped one below
      const { offX, offY, target } = computeBBoxSnap(
        svgGRef.current,
        rawOffX,
        rawOffY,
        snap,
        baselineCanvasY,
        guidePositionsRef.current,
        visibleGuidesRef.current,
      );

      // Write final snapped transform
      const fsx = snap.flipH ? -1 : 1,
        fsy = snap.flipV ? -1 : 1;
      const pivotX = CANVAS_W / 2,
        pivotY = baselineCanvasY + snap.baseline;
      svgGRef.current.setAttribute(
        "transform",
        [
          `translate(${pivotX + offX}, ${pivotY + offY})`,
          snap.rotate !== 0 ? `rotate(${snap.rotate})` : "",
          `scale(${snap.scaleX * fsx}, ${snap.scaleY * fsy})`,
          `translate(${-pivotX}, ${-pivotY})`,
        ]
          .filter(Boolean)
          .join(" "),
      );

      applySnapFeedbackDOM(target);
    };

    const onUp = (e: MouseEvent) => {
      if (!glyphDragRef.current || !svgGRef.current) return;
      const z = viewportRef.current.zoom;
      const snap = glyphDragRef.current.adjSnapshot;
      const rawOffX =
        glyphDragRef.current.startOffX +
        (e.clientX - glyphDragRef.current.startX) / z;
      const rawOffY =
        glyphDragRef.current.startOffY +
        (e.clientY - glyphDragRef.current.startY) / z;
      const { offX, offY } = computeBBoxSnap(
        svgGRef.current,
        rawOffX,
        rawOffY,
        snap,
        baselineCanvasY,
        guidePositionsRef.current,
        visibleGuidesRef.current,
      );

      adjHistory.push({
        ...snap,
        offsetX: Math.round(offX),
        offsetY: Math.round(offY),
      });
      updateAdjustments(codepoint, {
        ...snap,
        offsetX: Math.round(offX),
        offsetY: Math.round(offY),
      });
      glyphDragRef.current = null;
      setIsDraggingGlyph(false);
      clearSnapFeedbackDOM();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingGlyph, applySnapFeedbackDOM, clearSnapFeedbackDOM]);

  // ── Guide drag ────────────────────────────────────────────────────────────────
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
      if (!guideDragRef.current) return;
      const fracDelta =
        (e.clientY - guideDragRef.current.startMouseY) /
        viewportRef.current.zoom /
        CANVAS_H;
      setGuidePositions((prev) => ({
        ...prev,
        [guideDragRef.current!.key]: Math.max(
          0.01,
          Math.min(0.99, guideDragRef.current!.startFrac + fracDelta),
        ),
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

  // ── Upload ────────────────────────────────────────────────────────────────────
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

  const getFitDefaults = () =>
    parsedSVG
      ? { ...DEFAULT_ADJUSTMENTS, ...computeAutoFit(parsedSVG) }
      : { ...DEFAULT_ADJUSTMENTS };
  const resetAdj = () => {
    const n = getFitDefaults();
    adjHistory.push(n);
    updateAdjustments(codepoint, n);
  };
  const resetSpacing = () => {
    const n = { ...adj, ...DEFAULT_SPACING };
    adjHistory.push(n);
    updateAdjustments(codepoint, n);
  };

  const adjustTransform = useMemo(() => {
    if (!parsedSVG) return "";
    return buildTransform(adj, baselineCanvasY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adj, parsedSVG, baselineCanvasY]);

  const canvasCursor = isPanning
    ? "grabbing"
    : spaceHeldRef.current
      ? "grab"
      : toolMode === "move"
        ? isDraggingGlyph
          ? "grabbing"
          : "grab"
        : "default";

  const zoomPct = Math.round(viewport.zoom * 100);
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

  const atOrigin = adj.offsetX === 0 && adj.offsetY === 0;

  // ─────────────────────────────────────────────────────────────────────────────
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
        <div
          ref={canvasAreaRef}
          className={styles.canvasArea}
          onMouseDown={(e) => {
            if (e.button === 1 || (e.button === 0 && spaceHeldRef.current)) {
              handleAreaPointerDown(e);
              return;
            }
            if (toolMode === "move" && e.button === 0)
              handleCanvasAreaMouseDown(e);
          }}
          style={{
            cursor: isPanning
              ? "grabbing"
              : spaceHeldRef.current
                ? "grab"
                : toolMode === "move"
                  ? isDraggingGlyph
                    ? "grabbing"
                    : "grab"
                  : undefined,
          }}
        >
          {/* ── Tool palette ── */}
          <div className={styles.toolPalette}>
            {/* Select */}
            <button
              className={`${styles.toolBtn} ${toolMode === "select" ? styles.toolBtnActive : ""}`}
              onClick={() => setToolMode("select")}
              title="Select (V)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3 2l8 5-4.5 1.5L5 13 3 2z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                  fill="currentColor"
                  fillOpacity={toolMode === "select" ? 0.15 : 0}
                />
              </svg>
              <span className={styles.toolBtnLabel}>Select</span>
            </button>

            {/* Move */}
            <button
              className={`${styles.toolBtn} ${toolMode === "move" ? styles.toolBtnActive : ""}`}
              onClick={() => setToolMode("move")}
              title="Move (M) — edges snap to guides"
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

            {/* ── Snap to Origin — prominent accent button ── */}
            <button
              className={`${styles.snapOriginBtn} ${atOrigin ? styles.snapOriginBtnAt : ""}`}
              onClick={snapToOrigin}
              disabled={atOrigin}
              title="Snap to Origin — zero offsetX/Y (Alt+O)"
            >
              {/* Crosshair + centre dot */}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle
                  cx="7"
                  cy="7"
                  r="5.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
                <circle cx="7" cy="7" r="2" fill="currentColor" />
              </svg>
              <span className={styles.toolBtnLabel}>Origin</span>
              {/* Keyboard badge */}
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  background: "rgba(255,255,255,0.18)",
                  borderRadius: 3,
                  padding: "1px 4px",
                  lineHeight: 1.5,
                  whiteSpace: "nowrap",
                }}
              >
                ⌥O
              </span>
            </button>

            {/* Thin rule */}
            <div
              style={{
                height: 1,
                background: "var(--border)",
                margin: "3px 5px",
              }}
            />

            {/* Guides */}
            <button
              className={`${styles.toolBtn} ${toolMode === "guides" ? styles.toolBtnActive : ""}`}
              onClick={() => setToolMode("guides")}
              title="Guides (G)"
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

          {/* Zoom controls */}
          <div className={styles.zoomControls}>
            <button
              className={styles.zoomBtn}
              onClick={() =>
                zoomCentred(clampZoom(viewport.zoom - ZOOM_STEP_KEY))
              }
              disabled={viewport.zoom <= ZOOM_MIN}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2 6h8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              className={styles.zoomLevel}
              onClick={zoomReset}
              onDoubleClick={zoomFit}
            >
              {zoomPct}%
            </button>
            <button
              className={styles.zoomBtn}
              onClick={() =>
                zoomCentred(clampZoom(viewport.zoom + ZOOM_STEP_KEY))
              }
              disabled={viewport.zoom >= ZOOM_MAX}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M6 2v8M2 6h8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <div className={styles.zoomDivider} />
            <button className={styles.zoomFitBtn} onClick={zoomFit}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Fit
            </button>
          </div>

          {viewport.zoom !== 1 && (
            <div className={styles.zoomHint}>
              <kbd>Ctrl+scroll</kbd> zoom · <kbd>Space</kbd>+drag pan ·{" "}
              <kbd>Ctrl+0</kbd> reset
            </div>
          )}

          {/* Zoom layer */}
          <div
            className={styles.zoomLayer}
            style={{
              transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
              transformOrigin: "0 0",
              width: CANVAS_W,
              height: CANVAS_H,
            }}
          >
            <div
              ref={canvasRef}
              className={styles.canvas}
              style={{
                width: CANVAS_W,
                height: CANVAS_H,
                cursor: canvasCursor,
              }}
            >
              {/* Guide lines */}
              {GUIDE_LINES.map(
                (g) =>
                  visibleGuides[g.key] && (
                    <div
                      key={g.key}
                      ref={(el) => {
                        snapGuideRefs.current[g.key] = el;
                      }}
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
                          <svg
                            width="8"
                            height="8"
                            viewBox="0 0 8 8"
                            fill="none"
                          >
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

              {/* Snap feedback — shown/hidden via DOM ref during drag */}
              {toolMode === "move" && (
                <>
                  {/* Vertical line (X snap) */}
                  <div
                    ref={snapLineXRef}
                    style={{
                      display: "none",
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      width: 2,
                      pointerEvents: "none",
                      zIndex: 22,
                      opacity: 0.9,
                    }}
                  />
                  {/* Horizontal line (Y snap) */}
                  <div
                    ref={snapLineYRef}
                    style={{
                      display: "none",
                      position: "absolute",
                      left: 0,
                      right: 0,
                      height: 2,
                      pointerEvents: "none",
                      zIndex: 22,
                      opacity: 0.9,
                    }}
                  />
                  {/* Label pill */}
                  <div
                    ref={snapLabelRef}
                    style={{
                      display: "none",
                      position: "absolute",
                      bottom: 54,
                      left: "50%",
                      transform: "translateX(-50%)",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "var(--font-sans)",
                      padding: "4px 14px",
                      borderRadius: 99,
                      whiteSpace: "nowrap",
                      zIndex: 30,
                      pointerEvents: "none",
                      letterSpacing: "0.04em",
                      border: "1px solid",
                      backdropFilter: "blur(4px)",
                    }}
                  />
                </>
              )}

              {/* SVG glyph */}
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
                <button className={styles.replaceBtn} onClick={handleUpload}>
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

              {toolMode === "move" && !isDraggingGlyph && (
                <div className={styles.toolHint}>
                  Drag to move · edges snap to guides · Alt+O origin
                </div>
              )}
              {toolMode === "guides" && !draggingGuideKey && (
                <div className={styles.toolHint}>
                  Drag a guide line to reposition it
                </div>
              )}
            </div>
          </div>

          {/* Canvas info bar */}
          <div className={styles.canvasInfo}>
            <span>Em: 1000 UPM</span>
            <span>Advance: {adj.advanceWidth}u</span>
            <span>LSB: {adj.leftBearing}u</span>
            <span>Rotate: {adj.rotate}°</span>
            <span>
              Scale: {adj.scaleX.toFixed(2)}×{adj.scaleY.toFixed(2)}
            </span>
            <span>
              Offset: {adj.offsetX},{adj.offsetY}
            </span>
            {parsedSVG && (
              <span style={{ color: "var(--text-tertiary)", opacity: 0.6 }}>
                vb: {parsedSVG.viewBox}
              </span>
            )}
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
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <div className={styles.tabContent}>
            {activeTab === "transform" && (
              <div className={styles.section}>
                {/* Scale X */}
                <div className={styles.fieldGroup}>
                  <div className={styles.fieldLabelRow}>
                    <span className={styles.fieldLabel}>Scale X</span>
                    <button
                      className={`${styles.lockBtn} ${scaleLocked ? styles.lockBtnActive : ""}`}
                      onClick={() => setScaleLocked((l) => !l)}
                    >
                      {scaleLocked ? (
                        <svg
                          width="11"
                          height="11"
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
                            strokeWidth="1.3"
                          />
                          <path
                            d="M3.5 5V3.5a2 2 0 0 1 4 0V5"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                          />
                        </svg>
                      ) : (
                        <svg
                          width="11"
                          height="11"
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
                            strokeWidth="1.3"
                          />
                          <path
                            d="M3.5 5V3a2 2 0 0 1 4 0"
                            stroke="currentColor"
                            strokeWidth="1.3"
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

                {/* Scale Y */}
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

                {/* Offset X */}
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

                {/* Offset Y */}
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

                {/* Rotate */}
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

                {/* Baseline shift */}
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

                {/* Flip */}
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

            {activeTab === "guides" && (
              <div className={styles.section}>
                <p className={styles.guidesNote}>
                  Toggle visibility. Use <strong>Guides tool</strong> (G) to
                  drag on canvas.
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
                        setVisibleGuides((p) => ({ ...p, [g.key]: !p[g.key] }))
                      }
                      role="switch"
                      aria-checked={visibleGuides[g.key]}
                    >
                      <span className={styles.toggleSmallThumb} />
                    </button>
                  </div>
                ))}
                <div className={styles.guideDivider} />
                {[
                  { id: "leftBearing", label: "Left bearing" },
                  { id: "rightBearing", label: "Right bearing" },
                ].map(({ id, label }) => (
                  <div key={id} className={styles.guideToggleRow}>
                    <span
                      className={styles.guideColorDot}
                      style={{ background: "#94a3b8" }}
                    />
                    <span className={styles.guideName}>{label}</span>
                    <button
                      className={`${styles.toggleSmall} ${visibleGuides[id] ? styles.toggleSmallOn : ""}`}
                      onClick={() =>
                        setVisibleGuides((p) => ({ ...p, [id]: !p[id] }))
                      }
                      role="switch"
                      aria-checked={visibleGuides[id]}
                    >
                      <span className={styles.toggleSmallThumb} />
                    </button>
                  </div>
                ))}
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
