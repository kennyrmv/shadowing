import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Phrase, LoopState, SRSEntry, SRSRating } from '@/types'

// ─── Practice phase types (stub — used fully in Task 6) ──────────────────────
export type PracticePhase = 'listen' | 'shadow-no-text' | 'shadow-with-text' | 'assess' | 'idle'

// ─── Saved video type (used in Task 2+) ──────────────────────────────────────
export interface SavedVideo {
  videoId: string
  title: string
  url: string
  phrases: Phrase[]
  savedAt: string
  totalPhrases: number
}

// ─── Score record type (used in Task 3+) ──────────────────────────────────────
export interface ScoreRecord {
  id: string
  phraseId: string
  videoId: string
  timestamp: string
  pronunciation: number
  accuracy: number
  fluency: number
  completeness: number
  words: { word: string; accuracy: number; errorType: string }[]
}

// ─── Daily session type (used in Task 5+) ─────────────────────────────────────
export interface DailySession {
  id: string
  date: string
  reviewPhrases: SRSEntry[]
  newPhrases: Phrase[]
  completed: string[]
  startedAt: string | null
  completedAt: string | null
}

// ─── Azure scores type (used in Task 4+) ──────────────────────────────────────
export interface AzureScores {
  accuracy: number
  fluency: number
  completeness: number
}

// ─── Store shape ──────────────────────────────────────────────────────────────
interface AppState {
  // Player state (migrated from PhrasePlayer)
  activePhrase: Phrase | null
  loopState: LoopState
  playbackRate: number
  drillMode: boolean
  loopsTarget: number
  loopCount: number

  // Video library (Task 2)
  savedVideos: SavedVideo[]

  // Score history (Task 3)
  scoreHistory: ScoreRecord[]

  // Daily practice (Task 5)
  dailySession: DailySession | null
  currentPhase: PracticePhase

  // Player actions
  setActivePhrase: (phrase: Phrase | null) => void
  setLoopState: (state: LoopState) => void
  setPlaybackRate: (rate: number) => void
  setDrillMode: (on: boolean) => void
  setLoopsTarget: (n: number) => void
  setLoopCount: (n: number) => void
  incrementLoopCount: () => void

  // Video library actions (Task 2)
  saveVideo: (video: SavedVideo) => void
  removeVideo: (videoId: string) => void

  // Score history actions (Task 3)
  addScore: (record: ScoreRecord) => void

  // Daily practice actions (Task 5)
  setDailySession: (session: DailySession | null) => void
  setCurrentPhase: (phase: PracticePhase) => void
  markPhraseCompleted: (phraseId: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // ── Player state defaults ──
      activePhrase: null,
      loopState: 'idle' as LoopState,
      playbackRate: 1,
      drillMode: false,
      loopsTarget: 3,
      loopCount: 0,

      // ── Future task stubs ──
      savedVideos: [],
      scoreHistory: [],
      dailySession: null,
      currentPhase: 'idle' as PracticePhase,

      // ── Player actions ──
      setActivePhrase: (phrase) => set({ activePhrase: phrase, loopCount: 0 }),
      setLoopState: (state) => set({ loopState: state }),
      setPlaybackRate: (rate) => set({ playbackRate: rate }),
      setDrillMode: (on) => set({ drillMode: on }),
      setLoopsTarget: (n) => set({ loopsTarget: n }),
      setLoopCount: (n) => set({ loopCount: n }),
      incrementLoopCount: () => set((s) => ({ loopCount: s.loopCount + 1 })),

      // ── Video library actions (Task 2) ──
      saveVideo: (video) => set((s) => {
        const exists = s.savedVideos.findIndex((v) => v.videoId === video.videoId)
        if (exists >= 0) {
          const updated = [...s.savedVideos]
          updated[exists] = video
          return { savedVideos: updated }
        }
        if (s.savedVideos.length >= 20) return s // limit
        return { savedVideos: [...s.savedVideos, video] }
      }),
      removeVideo: (videoId) => set((s) => ({
        savedVideos: s.savedVideos.filter((v) => v.videoId !== videoId),
      })),

      // ── Score history actions (Task 3) ──
      addScore: (record) => set((s) => {
        const updated = [...s.scoreHistory, record]
        // Rotation: keep last 500 records
        if (updated.length > 500) updated.splice(0, updated.length - 500)
        return { scoreHistory: updated }
      }),

      // ── Daily practice actions (Task 5) ──
      setDailySession: (session) => set({ dailySession: session }),
      setCurrentPhase: (phase) => set({ currentPhase: phase }),
      markPhraseCompleted: (phraseId) => set((s) => {
        if (!s.dailySession) return s
        return {
          dailySession: {
            ...s.dailySession,
            completed: [...s.dailySession.completed, phraseId],
          },
        }
      }),
    }),
    {
      name: 'shadowing-store',
      // Only persist user preferences + library + scores. Ephemeral state resets on reload.
      partialize: (state) => ({
        playbackRate: state.playbackRate,
        drillMode: state.drillMode,
        loopsTarget: state.loopsTarget,
        savedVideos: state.savedVideos,
        scoreHistory: state.scoreHistory,
      }),
      storage: {
        getItem: (name) => {
          try {
            const raw = localStorage.getItem(name)
            return raw ? JSON.parse(raw) : null
          } catch {
            console.warn('[store] corrupt localStorage, resetting')
            localStorage.removeItem(name)
            return null
          }
        },
        setItem: (name, value) => {
          try {
            localStorage.setItem(name, JSON.stringify(value))
          } catch (err) {
            if (err instanceof DOMException && err.name === 'QuotaExceededError') {
              window.dispatchEvent(new CustomEvent('srs:storage-full'))
            }
          }
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
)
