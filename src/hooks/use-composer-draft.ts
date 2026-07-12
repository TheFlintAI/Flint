import * as React from 'react'
import { useInputDraftStore, getTaskInputDraftKey, hasInputDraftContent } from '@/stores/input-draft-store'
import type { SelectedFileItem } from '@/lib/chat/select-file-editor'

interface PersistedDraftSnapshot {
  text: string
  selectedFiles: SelectedFileItem[]
}

interface UseComposerDraftOptions {
  taskId: string | null | undefined
  draftKeyOverride: string | null | undefined
  inputDraftHydrated: boolean
}

interface DraftConnection {
  /** The resolved draft key in use (null if unavailable). */
  activeDraftKey: string | null
  /** The persisted draft from store (null if not hydrated or no key). */
  persistedDraft: PersistedDraftSnapshot | null
  /** Saves current composer state to the draft store (debounced). */
  saveDraft: (snapshot: {
    serializedText: string
    selectedFiles: SelectedFileItem[]
  }) => void
}

/**
 * Connects the composer to the persisted draft store.
 * Handles key resolution, hydration gating, and debounced save.
 */
export function useComposerDraft({
  taskId,
  draftKeyOverride,
  inputDraftHydrated
}: UseComposerDraftOptions): DraftConnection {
  const draftTaskId = taskId ?? null
  const activeDraftKey = React.useMemo(
    () => draftKeyOverride ?? (draftTaskId ? getTaskInputDraftKey(draftTaskId) : null),
    [draftKeyOverride, draftTaskId]
  )

  const persistedDraft = useInputDraftStore(
    React.useCallback(
      (state) => (activeDraftKey ? (state.draftsByKey[activeDraftKey] ?? null) : null),
      [activeDraftKey]
    )
  )

  const setPersistedDraft = useInputDraftStore((s) => s.setDraft)
  const removePersistedDraft = useInputDraftStore((s) => s.removeDraft)

  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined)

  const saveDraft = React.useCallback(
    (snapshot: {
      serializedText: string
      selectedFiles: SelectedFileItem[]
    }) => {
      const key = activeDraftKey
      if (!key || !inputDraftHydrated) return

      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        const nextDraft = {
          text: snapshot.serializedText,
          selectedFiles: snapshot.selectedFiles.map((file) => ({ ...file }))
        }

        if (hasInputDraftContent(nextDraft)) {
          setPersistedDraft(key, nextDraft)
          return
        }

        removePersistedDraft(key)
      }, 400)
    },
    [activeDraftKey, inputDraftHydrated, setPersistedDraft, removePersistedDraft]
  )

  // Cleanup timer on unmount
  React.useEffect(() => {
    return () => clearTimeout(saveTimerRef.current)
  }, [])

  return {
    activeDraftKey,
    persistedDraft: inputDraftHydrated ? (persistedDraft ?? null) : null,
    saveDraft
  }
}
