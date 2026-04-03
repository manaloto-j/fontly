import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  FontProject,
  GlyphData,
  GlyphAdjustments,
  FontMetrics,
  FontMetadata,
  HistoryEntry,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_METRICS,
  DEFAULT_METADATA,
} from "../types/font";
import { CHAR_GROUPS, toCodepoint } from "../constants/charsets";

function buildInitialGlyphs(): Record<string, GlyphData> {
  const glyphs: Record<string, GlyphData> = {};
  for (const group of CHAR_GROUPS) {
    for (const ch of group.characters) {
      const cp = toCodepoint(ch);
      glyphs[cp] = {
        codepoint: cp,
        svgContent: null,
        fileName: null,
        adjustments: { ...DEFAULT_ADJUSTMENTS },
        uploadedAt: null,
      };
    }
  }
  return glyphs;
}

const INITIAL_PROJECT: FontProject = {
  id: crypto.randomUUID(),
  metadata: { ...DEFAULT_METADATA },
  metrics: { ...DEFAULT_METRICS },
  glyphs: buildInitialGlyphs(),
  specialCharsEnabled: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

interface FontStore {
  project: FontProject;
  history: HistoryEntry[];
  historyIndex: number;
  zoom: number;
  saveStatus: "saved" | "saving" | "unsaved";
  selectedCodepoint: string | null;

  // Glyph actions
  uploadGlyph: (codepoint: string, svgContent: string, fileName: string) => void;
  updateAdjustments: (codepoint: string, adjustments: GlyphAdjustments) => void;
  selectGlyph: (codepoint: string) => void;

  // Font metadata & metrics
  setFontName: (name: string) => void;
  updateMetrics: (patch: Partial<FontMetrics>) => void;
  updateMetadata: (patch: Partial<FontMetadata>) => void;

  // Special chars
  toggleSpecialChars: () => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Zoom
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;

  // Export (legacy .fontly JSON project file)
  exportProject: () => void;
}

export const useFontStore = create<FontStore>()(
  persist(
    (set, get) => {
      const pushHistory = (glyphs: Record<string, GlyphData>) => {
        const { history, historyIndex } = get();
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push({
          glyphs: JSON.parse(JSON.stringify(glyphs)),
          timestamp: Date.now(),
        });
        if (newHistory.length > 50) newHistory.shift();
        return { history: newHistory, historyIndex: newHistory.length - 1 };
      };

      const setSaveStatus = (status: "saved" | "saving" | "unsaved") =>
        set({ saveStatus: status });

      return {
        project: INITIAL_PROJECT,
        history: [
          {
            glyphs: JSON.parse(JSON.stringify(INITIAL_PROJECT.glyphs)),
            timestamp: Date.now(),
          },
        ],
        historyIndex: 0,
        zoom: 1,
        saveStatus: "saved",
        selectedCodepoint: null,

        uploadGlyph: (codepoint, svgContent, fileName) => {
          const { project } = get();
          const historyState = pushHistory(project.glyphs);
          set({
            project: {
              ...project,
              glyphs: {
                ...project.glyphs,
                [codepoint]: {
                  ...project.glyphs[codepoint],
                  svgContent,
                  fileName,
                  uploadedAt: Date.now(),
                },
              },
              updatedAt: Date.now(),
            },
            ...historyState,
            saveStatus: "unsaved",
          });
          setTimeout(() => setSaveStatus("saved"), 800);
        },

        updateAdjustments: (codepoint, adjustments) => {
          const { project } = get();
          set({
            project: {
              ...project,
              glyphs: {
                ...project.glyphs,
                [codepoint]: {
                  ...project.glyphs[codepoint],
                  adjustments,
                },
              },
              updatedAt: Date.now(),
            },
            saveStatus: "unsaved",
          });
          setTimeout(() => setSaveStatus("saved"), 800);
        },

        selectGlyph: (codepoint) => set({ selectedCodepoint: codepoint }),

        setFontName: (name) => {
          const { project } = get();
          set({
            project: {
              ...project,
              metadata: { ...project.metadata, familyName: name },
              updatedAt: Date.now(),
            },
            saveStatus: "unsaved",
          });
          setTimeout(() => setSaveStatus("saved"), 800);
        },

        updateMetrics: (patch) => {
          const { project } = get();
          set({
            project: {
              ...project,
              metrics: { ...project.metrics, ...patch },
              updatedAt: Date.now(),
            },
            saveStatus: "unsaved",
          });
          setTimeout(() => setSaveStatus("saved"), 800);
        },

        updateMetadata: (patch) => {
          const { project } = get();
          set({
            project: {
              ...project,
              metadata: { ...project.metadata, ...patch },
              updatedAt: Date.now(),
            },
            saveStatus: "unsaved",
          });
          setTimeout(() => setSaveStatus("saved"), 800);
        },

        toggleSpecialChars: () => {
          const { project } = get();
          set({
            project: {
              ...project,
              specialCharsEnabled: !project.specialCharsEnabled,
              updatedAt: Date.now(),
            },
          });
        },

        undo: () => {
          const { history, historyIndex, project } = get();
          if (historyIndex <= 0) return;
          const newIndex = historyIndex - 1;
          const snapshot = history[newIndex];
          set({
            historyIndex: newIndex,
            project: {
              ...project,
              glyphs: JSON.parse(JSON.stringify(snapshot.glyphs)),
              updatedAt: Date.now(),
            },
            saveStatus: "unsaved",
          });
        },

        redo: () => {
          const { history, historyIndex, project } = get();
          if (historyIndex >= history.length - 1) return;
          const newIndex = historyIndex + 1;
          const snapshot = history[newIndex];
          set({
            historyIndex: newIndex,
            project: {
              ...project,
              glyphs: JSON.parse(JSON.stringify(snapshot.glyphs)),
              updatedAt: Date.now(),
            },
            saveStatus: "unsaved",
          });
        },

        canUndo: () => get().historyIndex > 0,
        canRedo: () => get().historyIndex < get().history.length - 1,

        zoomIn: () =>
          set((s) => ({
            zoom: Math.min(2, Math.round((s.zoom + 0.25) * 100) / 100),
          })),
        zoomOut: () =>
          set((s) => ({
            zoom: Math.max(0.5, Math.round((s.zoom - 0.25) * 100) / 100),
          })),
        resetZoom: () => set({ zoom: 1 }),

        exportProject: () => {
          const { project } = get();
          const json = JSON.stringify(project, null, 2);
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${project.metadata.familyName.replace(/\s+/g, "-").toLowerCase()}.fontly`;
          a.click();
          URL.revokeObjectURL(url);
        },
      };
    },
    {
      name: "fontly-project",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ project: state.project }),
    },
  ),
);
