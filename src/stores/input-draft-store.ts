import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { commandStorage } from '@/services/tauri-api/command-storage'
import type { SelectedFileItem } from '@/lib/chat/select-file-editor'

const MAX_INPUT_DRAFTS = 20
const TASK_DRAFT_PREFIX = 'task:'

export interface InputDraftValue {
  text: string
  selectedFiles: SelectedFileItem[]
}

interface PersistedInputDraft extends InputDraftValue {
  updatedAt: number
}

interface InputDraftStore {
  hydrated: boolean
  draftsByKey: Record<string, PersistedInputDraft>
  setHydrated: (hydrated: boolean) => void
  getDraft: (key: string) => InputDraftValue | null
  setDraft: (key: string, draft: InputDraftValue | null) => void
  removeDraft: (key: string) => void
  removeTaskDraft: (taskId: string) => void
  clearAllTaskDrafts: () => void
}

export function getTaskInputDraftKey(taskId: string): string {
  return `${TASK_DRAFT_PREFIX}${taskId}`
}

export function hasInputDraftContent(
  draft: Pick<InputDraftValue, 'text' | 'selectedFiles'>
): boolean {
  return draft.text.length > 0 || draft.selectedFiles.length > 0
}

function cloneSelectedFiles(files: SelectedFileItem[]): SelectedFileItem[] {
  return files.map((file) => ({ ...file }))
}

function toInputDraftValue(draft: PersistedInputDraft): InputDraftValue {
  return {
    text: draft.text,
    selectedFiles: cloneSelectedFiles(draft.selectedFiles)
  }
}

function createPersistedDraft(draft: InputDraftValue, updatedAt = Date.now()): PersistedInputDraft {
  return {
    text: draft.text,
    selectedFiles: cloneSelectedFiles(draft.selectedFiles),
    updatedAt
  }
}

function trimDraftMap(
  draftsByKey: Record<string, PersistedInputDraft>
): Record<string, PersistedInputDraft> {
  return Object.fromEntries(
    Object.entries(draftsByKey)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_INPUT_DRAFTS)
  )
}

export const useInputDraftStore = create<InputDraftStore>()(
  persist(
    (set, get) => ({
      hydrated: false,
      draftsByKey: {},

      setHydrated: (hydrated) => set({ hydrated }),

      getDraft: (key) => {
        const draft = get().draftsByKey[key]
        return draft ? toInputDraftValue(draft) : null
      },

      setDraft: (key, draft) => {
        if (!key) return

        set((state) => {
          const nextDrafts = { ...state.draftsByKey }

          if (!draft || !hasInputDraftContent(draft)) {
            delete nextDrafts[key]
            return { draftsByKey: nextDrafts }
          }

          nextDrafts[key] = createPersistedDraft(draft)
          return { draftsByKey: trimDraftMap(nextDrafts) }
        })
      },

      removeDraft: (key) => {
        if (!key) return

        set((state) => {
          if (!state.draftsByKey[key]) return state
          const nextDrafts = { ...state.draftsByKey }
          delete nextDrafts[key]
          return { draftsByKey: nextDrafts }
        })
      },

      removeTaskDraft: (taskId) => {
        get().removeDraft(getTaskInputDraftKey(taskId))
      },

      clearAllTaskDrafts: () => {
        set((state) => ({
          draftsByKey: Object.fromEntries(
            Object.entries(state.draftsByKey).filter(
              ([key]) => !key.startsWith(TASK_DRAFT_PREFIX)
            )
          )
        }))
      }
    }),
    {
      name: 'flint-input-drafts',
      storage: createJSONStorage(() => commandStorage),
      partialize: (state) => ({ draftsByKey: state.draftsByKey }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true)
      }
    }
  )
)
