import { create } from 'zustand'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { refreshDynamicToolCatalog } from '@/lib/tools/dynamic-tool-catalog'
import type { SkillInfo } from '@/lib/resources/resource-manager'

interface SkillsStore {
  skills: SkillInfo[]
  loading: boolean

  // Install dialog state
  installDialogOpen: boolean
  installSourcePath: string | null
  installSkillName: string
  installSkillDescription: string
  installSkillMdContent: string
  installing: boolean

  // Actions
  loadSkills: () => Promise<void>
  deleteSkills: (names: string[]) => Promise<boolean>
  openSkillFolder: (name: string) => Promise<void>
  addSkillFromFolder: (
    sourcePath: string
  ) => Promise<{ success: boolean; name?: string; error?: string }>
  setSkillEnabled: (name: string, enabled: boolean) => Promise<void>
  toggleSkill: (name: string) => Promise<void>

  // Install dialog actions
  openInstallDialog: (sourcePath: string) => void
  closeInstallDialog: () => void
  confirmInstall: () => Promise<{ success: boolean; name?: string; error?: string }>
}

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  skills: [],
  loading: false,

  installDialogOpen: false,
  installSourcePath: null,
  installSkillName: '',
  installSkillDescription: '',
  installSkillMdContent: '',
  installing: false,

  loadSkills: async () => {
    set({ loading: true })
    try {
      const result = (await tauriCommands.invoke('skills:list')) as SkillInfo[]
      set({ skills: Array.isArray(result) ? result : [] })
    } catch {
      set({ skills: [] })
    } finally {
      set({ loading: false })
    }
  },

  deleteSkills: async (names) => {
    try {
      let allSuccess = true
      for (const name of names) {
        const result = (await tauriCommands.invoke('skills:delete', { name })) as { success: boolean }
        if (!result.success) allSuccess = false
      }
      if (allSuccess) {
        const nameSet = new Set(names)
        set((state) => ({
          skills: state.skills.filter((s) => !nameSet.has(s.name))
        }))
        await refreshDynamicToolCatalog()
        return true
      }
      return false
    } catch {
      return false
    }
  },

  openSkillFolder: async (name) => {
    try {
      await tauriCommands.invoke('skills:open-folder', { name })
    } catch {
      // ignore
    }
  },

  addSkillFromFolder: async (sourcePath) => {
    try {
      const result = (await tauriCommands.invoke('skills:add-from-folder', { sourcePath })) as {
        success: boolean
        name?: string
        error?: string
      }
      if (result.success) {
        await get().loadSkills()
        await refreshDynamicToolCatalog()
      }
      return result
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },

  setSkillEnabled: async (name, enabled) => {
    set((state) => ({
      skills: state.skills.map((s) =>
        s.name === name ? { ...s, enabled } : s
      )
    }))
    try {
      await tauriCommands.invoke('skills:set-enabled', { name, enabled })
      await refreshDynamicToolCatalog()
    } catch {
      // Revert only if the optimistic value is still set (avoids interleaving race)
      set((state) => {
        const skill = state.skills.find((s) => s.name === name)
        if (skill && skill.enabled === enabled) {
          return {
            skills: state.skills.map((s) =>
              s.name === name ? { ...s, enabled: !enabled } : s
            )
          }
        }
        return {}
      })
    }
  },

  toggleSkill: async (name) => {
    const skill = get().skills.find((s) => s.name === name)
    if (!skill) return
    await get().setSkillEnabled(name, !skill.enabled)
  },

  // Install dialog actions
  openInstallDialog: (sourcePath) => {
    const name = sourcePath.split(/[/\\]/).pop() ?? 'skill'
    set({
      installDialogOpen: true,
      installSourcePath: sourcePath,
      installSkillName: name,
      installSkillDescription: '',
      installSkillMdContent: '',
      installing: false
    })
    // Fetch SKILL.md preview
    tauriCommands
      .invoke('skills:preview', { sourcePath })
      .then((result) => {
        const r = result as { name?: string; description?: string; content?: string }
        set({
          installSkillName: r.name ?? name,
          installSkillDescription: r.description ?? '',
          installSkillMdContent: r.content ?? ''
        })
      })
      .catch(() => {})
  },

  closeInstallDialog: () => {
    set({
      installDialogOpen: false,
      installSourcePath: null,
      installSkillName: '',
      installSkillDescription: '',
      installSkillMdContent: '',
      installing: false
    })
  },

  confirmInstall: async () => {
    const state = get()
    if (!state.installSourcePath) return { success: false, error: 'No source path' }
    set({ installing: true })
    try {
      const result = await state.addSkillFromFolder(state.installSourcePath)
      if (result.success) {
        set({
          installDialogOpen: false,
          installSourcePath: null,
          installing: false
        })
      } else {
        set({ installing: false })
      }
      return result
    } catch (err) {
      set({ installing: false })
      return { success: false, error: String(err) }
    }
  }
}))
