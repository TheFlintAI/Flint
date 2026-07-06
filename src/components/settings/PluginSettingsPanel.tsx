import { useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  AlertCircle,
  Loader2,
  Pencil,
  Plus,
  Puzzle,
  Search,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePluginStore } from '@/stores/plugin-store'
import { resolveDisplayName, resolveDisplayDescription } from '@/lib/plugin/display'
import { PluginCard } from './PluginCard'
import { PanelEmptyState } from '@/components/ui/PanelEmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToolbarButton } from '@/components/ui/toolbar-button'
import { confirm as confirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from 'sonner'
import { tauriCommands } from '@/services/tauri-api/command-client'

function LoadingState(): React.JSX.Element {
  const { t } = useTranslation('settings')
  return (
    <div className="flex h-full min-h-72 items-center justify-center gap-2.5 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
      <span className="text-[14px]">{t('plugin.loading', { defaultValue: 'Loading plugins...' })}</span>
    </div>
  )
}

function EmptyState({ hasSearch }: { hasSearch: boolean }): React.JSX.Element {
  const { t } = useTranslation('settings')
  return (
    <PanelEmptyState
      icon={
        hasSearch ? (
          <Search className="size-7 text-muted-foreground" />
        ) : (
          <Puzzle className="size-7 text-muted-foreground" />
        )
      }
      title={
        hasSearch
          ? t('plugin.noMatch', { defaultValue: 'No plugins match your search' })
          : t('plugin.empty', { defaultValue: 'No plugins installed' })
      }
    />
  )
}

export function PluginSettingsPanel(): React.JSX.Element {
  const { t, i18n } = useTranslation('settings')
  const plugins = usePluginStore((state) => state.plugins)
  const initialized = usePluginStore((state) => state.initialized)
  const error = usePluginStore((state) => state.error)
  const importFlp = usePluginStore((state) => state.importFlp)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [importing, setImporting] = useState(false)

  const [editMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const deletePlugins = usePluginStore((state) => state.deletePlugins)
  const refreshPlugins = usePluginStore((state) => state.refreshPlugins)

  const enterEditMode = (): void => {
    setEditMode(true)
    setSelectedIds(new Set())
    setExpandedId(null)
  }

  const exitEditMode = (): void => {
    setEditMode(false)
    setSelectedIds(new Set())
  }

  useEffect(() => {
    if (editMode && plugins.length === 0) {
      setEditMode(false)
      setSelectedIds(new Set())
    }
  }, [editMode, plugins.length])

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filteredPlugins = useMemo(() => {
    if (!searchQuery.trim()) return plugins
    const q = searchQuery.toLowerCase()
    return plugins.filter(
      (p) => {
        const name = resolveDisplayName(p.manifest.displayName, p.manifest.name, i18n.language)
        const desc = resolveDisplayDescription(p.manifest.displayDescription, i18n.language)
        return name.toLowerCase().includes(q) || (desc ?? '').toLowerCase().includes(q)
      }
    )
  }, [i18n.language, plugins, searchQuery])

  const allSelected = filteredPlugins.length > 0 && selectedIds.size === filteredPlugins.length

  const handleSelectAll = (): void => {
    if (selectedIds.size === filteredPlugins.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredPlugins.map((p) => p.id)))
    }
  }

  const handleBatchDelete = async (): Promise<void> => {
    if (selectedIds.size === 0) return
    const ok = await confirmDialog({
      title: t('plugin.deleteSelected', { defaultValue: 'Delete Selected' }),
      description: t('plugin.deleteSelectedConfirm', { count: selectedIds.size }),
      variant: 'destructive'
    })
    if (!ok) return
    await deletePlugins([...selectedIds])
    await refreshPlugins()
    setSelectedIds(new Set())
  }

  const handleImportFlp = async (): Promise<void> => {
    if (importing) return
    const result = await tauriCommands.invoke<{
      success: boolean
      canceled: boolean
      path?: string
    }>('fs:select-file', {
      filters: [{ name: t('plugin.flpFilter'), extensions: ['flp'] }]
    })
    if (!result?.success || !result.path) return

    setImporting(true)
    try {
      const plugin = await importFlp(result.path)
      toast.success(
        t('plugin.importSuccess', { name: plugin?.manifest?.displayName ?? plugin?.id ?? '' })
      )
    } catch (err) {
      toast.error(t('plugin.importFailed'), {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setImporting(false)
    }
  }

  if (!initialized) return <LoadingState />

  return (
    <div className="flex flex-col h-full">
      {editMode ? (
        <div className="px-4 pt-3 pb-1 shrink-0">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              {allSelected ? t('plugin.deselectAll') : t('plugin.selectAll')}
            </button>
            <span className="text-xs text-muted-foreground/70">
              {selectedIds.size > 0
                ? t('plugin.selectedCount', { count: selectedIds.size })
                : ''}
            </span>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              disabled={selectedIds.size === 0}
              onClick={() => void handleBatchDelete()}
            >
              <Trash2 className="size-3.5 mr-1" />
              {t('plugin.deleteSelected')}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={exitEditMode}>
              {t('plugin.done')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-4 py-2.5 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
            <Input
              placeholder={t('plugin.search', { defaultValue: 'Search plugins...' })}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-transparent border border-input shadow-none focus-visible:ring-0 rounded-lg"
            />
          </div>
          <ToolbarButton onClick={enterEditMode} disabled={filteredPlugins.length === 0}>
            <Pencil className="size-3.5" />
            {t('plugin.edit')}
          </ToolbarButton>
          <ToolbarButton onClick={() => void handleImportFlp()} disabled={importing}>
            {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {t('plugin.add')}
          </ToolbarButton>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2.5 space-y-1.5 pb-20">
          {filteredPlugins.length === 0 ? (
            <EmptyState hasSearch={searchQuery.trim().length > 0} />
          ) : (
            <AnimatePresence mode="popLayout">
            {filteredPlugins.map((plugin) => (
              <motion.div
                key={plugin.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
              <PluginCard
                plugin={plugin}
                isExpanded={expandedId === plugin.id}
                onToggleExpand={() =>
                  setExpandedId(expandedId === plugin.id ? null : plugin.id)
                }
                editMode={editMode}
                selected={selectedIds.has(plugin.id)}
                onToggleSelect={() => toggleSelect(plugin.id)}
              />
              </motion.div>
            ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      {error ? (
        <div className="shrink-0 bg-destructive/5 px-5 py-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-destructive">
                {t('plugin.loadError', { defaultValue: 'Failed to load plugins' })}
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{error}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
