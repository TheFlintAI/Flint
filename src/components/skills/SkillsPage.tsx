import { useEffect, useMemo, useState } from 'react'
import { Search, Plus, Sparkles, Loader2, ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useSkillsStore } from '@/stores/skills-store'
import { useUIStore } from '@/stores/ui-store'
import { PanelEmptyState } from '@/components/ui/PanelEmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ToolbarButton } from '@/components/ui/toolbar-button'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { confirm } from '@/components/ui/confirm-dialog'
import { SkillInstallDialog } from './SkillInstallDialog'
import { SkillCard } from './SkillCard'

export function SkillsPage({ embedded = false }: { embedded?: boolean }): React.JSX.Element {
  const { t } = useTranslation('layout')
  const skills = useSkillsStore((s) => s.skills)
  const loading = useSkillsStore((s) => s.loading)
  const loadSkills = useSkillsStore((s) => s.loadSkills)

  const [searchQuery, setSearchQuery] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())

  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills
    const q = searchQuery.toLowerCase()
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    )
  }, [skills, searchQuery])

  // Sort: preserve store order in edit mode, else alphabetical
  const sortedSkills = useMemo(() => {
    const list = [...filteredSkills]
    if (editMode) {
      return list.sort((a, b) => skills.indexOf(a) - skills.indexOf(b))
    }
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [filteredSkills, editMode])

  const handleAddSkill = async (): Promise<void> => {
    const result = (await tauriCommands.invoke('fs:select-folder')) as {
      canceled?: boolean
      path?: string
    }
    if (result.canceled || !result.path) return
    useSkillsStore.getState().openInstallDialog(result.path)
  }

  const handleBack = (): void => useUIStore.getState().navigateToHome()

  // -- Edit mode --

  const enterEditMode = (): void => {
    setEditMode(true)
    setSelectedNames(new Set())
  }

  const exitEditMode = (): void => {
    setEditMode(false)
    setSelectedNames(new Set())
  }

  // Auto-exit when all skills deleted
  useEffect(() => {
    if (editMode && skills.length === 0) {
      setEditMode(false)
      setSelectedNames(new Set())
    }
  }, [editMode, skills.length])

  const toggleSelect = (name: string): void => {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleSelectAll = (): void => {
    if (selectedNames.size === sortedSkills.length) {
      setSelectedNames(new Set())
    } else {
      setSelectedNames(new Set(sortedSkills.map((s) => s.name)))
    }
  }

  const handleBatchDelete = async (): Promise<void> => {
    if (selectedNames.size === 0) return
    const ok = await confirm({
      title: t('skillsPage.deleteSelected'),
      description: t('skillsPage.deleteSelectedConfirm', { count: selectedNames.size }),
      variant: 'destructive'
    })
    if (!ok) return
    await useSkillsStore.getState().deleteSkills([...selectedNames])
    setSelectedNames(new Set())
  }

  const allSelected = sortedSkills.length > 0 && selectedNames.size === sortedSkills.length
  const hasSkills = skills.length > 0
  const showResults = sortedSkills.length > 0
  const showNoResults = !loading && hasSkills && !showResults

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      {editMode ? (
        <div className="px-4 pt-3 pb-1 shrink-0">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              {allSelected ? t('skillsPage.deselectAll') : t('skillsPage.selectAll')}
            </button>
            <span className="text-xs text-muted-foreground/70">
              {selectedNames.size > 0
                ? t('skillsPage.selectedCount', { count: selectedNames.size })
                : ''}
            </span>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              disabled={selectedNames.size === 0}
              onClick={() => void handleBatchDelete()}
            >
              <Trash2 className="size-3.5 mr-1" />
              {t('skillsPage.deleteSelected')}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={exitEditMode}>
              {t('skillsPage.done')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-4 py-3 shrink-0">
          {!embedded && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleBack}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                >
                  <ArrowLeft className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Back</TooltipContent>
            </Tooltip>
          )}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/40" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('skillsPage.searchPlaceholder')}
              className="h-8 pl-8 text-xs bg-transparent border hover:border-border/40 focus:border-border/60 rounded-lg shadow-none focus-visible:ring-0"
            />
          </div>
          <ToolbarButton onClick={enterEditMode} disabled={sortedSkills.length === 0}>
            <Pencil className="size-3.5" />
            {t('skillsPage.edit')}
          </ToolbarButton>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs shrink-0"
            onClick={() => void handleAddSkill()}
          >
            <Plus className="size-3.5" />
            {t('skillsPage.addSkill')}
          </Button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-16">
        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading...
          </div>
        )}

        {/* Empty */}
        {!loading && !hasSkills && (
          <PanelEmptyState
            icon={<Sparkles className="size-7 text-muted-foreground" />}
            title={t('skillsPage.noSkills')}
            className="py-16"
          />
        )}

        {/* Single column list */}
        {!loading && showResults && (
          <div className="flex flex-col space-y-1.5 py-1">
            <AnimatePresence mode="popLayout">
              {sortedSkills.map((skill) => (
                <motion.div
                  key={skill.name}
                  layout
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                  <SkillCard
                    name={skill.name}
                    description={skill.description}
                    enabled={skill.enabled}
                    editMode={editMode}
                    selected={selectedNames.has(skill.name)}
                    onToggleSelect={() => toggleSelect(skill.name)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* No results */}
        {showNoResults && (
          <PanelEmptyState
            icon={<Search className="size-7 text-muted-foreground" />}
            title={t('skillsPage.noResults')}
            className="py-16"
          />
        )}
      </div>

      <SkillInstallDialog />
    </div>
  )
}
