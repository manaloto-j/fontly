import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  FontProject,
  GlyphData,
  GlyphAdjustments,
  FontMetrics,
  FontMetadata,
  HistoryEntry,
  DEFAULT_METRICS,
  DEFAULT_METADATA,
  makeGlyph,
} from '../types/font'
import { ALL_CHARACTERS, toCodepoint } from '../constants/charsets'

// ── Initial project factory ───────────────────────────────────────────────────

function createDefaultProject(): FontProject {
  const glyphs: Record<string, GlyphData> = {}
  for (const char of ALL_CHARACTERS) {
    const glyph = makeGlyph(char)
    glyphs[glyph.codepoint] = glyph
  }
  return {
    id: crypto.randomUUID(),
    metadata: { ...DEFAULT_METADATA },
    metrics: { ...DEFAULT_METRICS },
    glyphs,
    specialCharsEnabled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// ── Store shape ───────────────────────────────────────────────────────────────

interface FontStore {
  project: FontProject
  past: HistoryEntry[]
  future: HistoryEntry[]
  zoom: number          // 0.5 – 2.0
  saveStatus: 'saved' | 'saving' | 'unsaved'
  selectedGlyph: string | null  // codepoint

  // Project actions
  setFontName: (name: string) => void
  setMetrics: (metrics: Partial<FontMetrics>) => void
  setMetadata: (metadata: Partial<FontMetadata>) => void
  toggleSpecialChars: () => void
  newProject: () => void
  importProject: (json: string) => void
  exportProject: () => void

  // Glyph actions
  uploadGlyph: (codepoint: string, svgContent: string, fileName: string) => void
  removeGlyph: (codepoint: string) => void
  updateAdjustments: (codepoint: string, adj: Partial<GlyphAdjustments>) => void
  selectGlyph: (codepoint: string | null) => void

  // Undo / redo
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  // Zoom
  setZoom: (zoom: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
}

// ── History helpers ───────────────────────────────────────────────────────────

const MAX_HISTORY = 50

function snapshot(project: FontProject): HistoryEntry {
  return {
    glyphs: structuredClone(project.glyphs),
    metrics: { ...project.metrics },
    metadata: { ...project.metadata },
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useFontStore = create<FontStore>()(
  persist(
    (set, get) => ({
      project: createDefaultProject(),
      past: [],
      future: [],
      zoom: 1,
      saveStatus: 'saved',
      selectedGlyph: null,

      // ── Project ──────────────────────────────────────────────────────────

      setFontName: (name) => set((s) => ({
        project: { ...s.project, metadata: { ...s.project.metadata, familyName: name }, updatedAt: Date.now() },
        saveStatus: 'saved',
      })),

      setMetrics: (metrics) => set((s) => ({
        project: { ...s.project, metrics: { ...s.project.metrics, ...metrics }, updatedAt: Date.now() },
        saveStatus: 'saved',
      })),

      setMetadata: (metadata) => set((s) => ({
        project: { ...s.project, metadata: { ...s.project.metadata, ...metadata }, updatedAt: Date.now() },
        saveStatus: 'saved',
      })),

      toggleSpecialChars: () => set((s) => ({
        project: { ...s.project, specialCharsEnabled: !s.project.specialCharsEnabled, updatedAt: Date.now() },
      })),

      newProject: () => set({
        project: createDefaultProject(),
        past: [],
        future: [],
        zoom: 1,
        selectedGlyph: null,
        saveStatus: 'saved',
      }),

      importProject: (json) => {
        try {
          const project = JSON.parse(json) as FontProject
          set({ project, past: [], future: [], selectedGlyph: null, saveStatus: 'saved' })
        } catch {
          console.error('Invalid .fontly file')
        }
      },

      exportProject: () => {
        const { project } = get()
        const json = JSON.stringify(project, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${project.metadata.familyName.replace(/\s+/g, '-')}.fontly`
        a.click()
        URL.revokeObjectURL(url)
      },

      // ── Glyphs ───────────────────────────────────────────────────────────

      uploadGlyph: (codepoint, svgContent, fileName) => {
        const { project, past } = get()
        const entry = snapshot(project)
        const newPast = [...past.slice(-MAX_HISTORY + 1), entry]
        set((s) => ({
          past: newPast,
          future: [],
          project: {
            ...s.project,
            updatedAt: Date.now(),
            glyphs: {
              ...s.project.glyphs,
              [codepoint]: {
                ...s.project.glyphs[codepoint],
                svgContent,
                svgFileName: fileName,
                uploadedAt: Date.now(),
              },
            },
          },
          saveStatus: 'saved',
        }))
      },

      removeGlyph: (codepoint) => {
        const { project, past } = get()
        const entry = snapshot(project)
        const newPast = [...past.slice(-MAX_HISTORY + 1), entry]
        set((s) => ({
          past: newPast,
          future: [],
          project: {
            ...s.project,
            updatedAt: Date.now(),
            glyphs: {
              ...s.project.glyphs,
              [codepoint]: {
                ...s.project.glyphs[codepoint],
                svgContent: null,
                svgFileName: null,
                uploadedAt: null,
              },
            },
          },
          saveStatus: 'saved',
        }))
      },

      updateAdjustments: (codepoint, adj) => {
        set((s) => ({
          project: {
            ...s.project,
            updatedAt: Date.now(),
            glyphs: {
              ...s.project.glyphs,
              [codepoint]: {
                ...s.project.glyphs[codepoint],
                adjustments: { ...s.project.glyphs[codepoint].adjustments, ...adj },
              },
            },
          },
          saveStatus: 'saved',
        }))
      },

      selectGlyph: (codepoint) => set({ selectedGlyph: codepoint }),

      // ── Undo / redo ──────────────────────────────────────────────────────

      undo: () => {
        const { past, project, future } = get()
        if (past.length === 0) return
        const prev = past[past.length - 1]
        const newPast = past.slice(0, -1)
        const entry = snapshot(project)
        set({
          past: newPast,
          future: [entry, ...future.slice(0, MAX_HISTORY - 1)],
          project: {
            ...project,
            glyphs: prev.glyphs,
            metrics: prev.metrics,
            metadata: prev.metadata,
            updatedAt: Date.now(),
          },
          saveStatus: 'saved',
        })
      },

      redo: () => {
        const { past, project, future } = get()
        if (future.length === 0) return
        const next = future[0]
        const entry = snapshot(project)
        set({
          past: [...past.slice(-MAX_HISTORY + 1), entry],
          future: future.slice(1),
          project: {
            ...project,
            glyphs: next.glyphs,
            metrics: next.metrics,
            metadata: next.metadata,
            updatedAt: Date.now(),
          },
          saveStatus: 'saved',
        })
      },

      canUndo: () => get().past.length > 0,
      canRedo: () => get().future.length > 0,

      // ── Zoom ─────────────────────────────────────────────────────────────

      setZoom: (zoom) => set({ zoom: Math.min(2, Math.max(0.5, zoom)) }),
      zoomIn: () => set((s) => ({ zoom: Math.min(2, parseFloat((s.zoom + 0.25).toFixed(2))) })),
      zoomOut: () => set((s) => ({ zoom: Math.max(0.5, parseFloat((s.zoom - 0.25).toFixed(2))) })),
      resetZoom: () => set({ zoom: 1 }),
    }),
    {
      name: 'fontly-project',
      partialize: (s) => ({ project: s.project, zoom: s.zoom }),
    }
  )
)

// ── Selector helpers (use these in components) ────────────────────────────────

export const selectProject = (s: FontStore) => s.project
export const selectGlyph = (codepoint: string) => (s: FontStore) =>
  s.project.glyphs[codepoint]
export const selectUploadedCount = (s: FontStore) =>
  Object.values(s.project.glyphs).filter(g => g.svgContent !== null).length
export const selectTotalCount = (s: FontStore) => {
  const { project } = s
  if (project.specialCharsEnabled) return Object.keys(project.glyphs).length
  // count only non-special glyphs
  let count = 0
  for (const g of Object.values(project.glyphs)) {
    const cp = g.character.codePointAt(0)!
    if (cp < 0xC0) count++ // rough cut: basic latin + punctuation
  }
  return count
}

// Re-export toCodepoint for convenience
export { toCodepoint }
