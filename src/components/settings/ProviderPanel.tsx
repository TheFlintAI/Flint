import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { confirm } from '@/components/ui/confirm-dialog'
import {
  Plus,
  Search,
  Trash2,
  Pencil,
  ChevronDown,
  GripVertical,
  Check,
  Server
} from 'lucide-react'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ToolbarButton } from '@/components/ui/toolbar-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { PanelEmptyState } from '@/components/ui/PanelEmptyState'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent
} from '@/components/ui/dropdown-menu'
import {
  useProviderStore,
  getBuiltinPresets,
  createProviderFromPreset,
  isProviderAvailableForModelSelection,
  type BuiltinProviderPreset
} from '@/stores/provider-store'
import type { ProviderType, ModelProvider } from '@/lib/api/types'
import { SettingsRow } from '@/components/ui/settings-row'
import { SlideIn, AnimatePresence } from '@/components/animate-ui/transitions'
import { motion } from 'motion/react'
import { ProviderIcon, ModelIcon } from './provider-icons'
import { ProviderConfigPanel } from './providers/ProviderConfigPanel'
import { ModelMetaBadges } from './providers/model-meta'
import { ThinkingLevelSelect } from './providers/ThinkingLevelSelect'
import { displayName } from '@/lib/localized-string'

// --- Add Provider Menu (dropdown with builtin presets) ---

function AddProviderMenu(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const addProvider = useProviderStore((s) => s.addProvider)
  const providers = useProviderStore((s) => s.providers)
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [menuSearch, setMenuSearch] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setMenuSearch('')
      return
    }
    // Focus search input on open
    setTimeout(() => searchInputRef.current?.focus(), 50)
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelectPreset = (preset: BuiltinProviderPreset): void => {
    const existing = providers.find((p) => p.builtinId === preset.builtinId)
    if (existing) {
      toast.error(t('provider.providerAlreadyExists', { name: displayName(preset.name) }))
      setOpen(false)
      return
    }
    const provider = createProviderFromPreset(preset)
    addProvider(provider)
    setOpen(false)
    toast.success(t('provider.addedProvider', { name: displayName(preset.name) }))
  }

  const addedBuiltinIds = new Set(providers.map((p) => p.builtinId).filter(Boolean))

  const filteredPresets = menuSearch
    ? getBuiltinPresets().filter((p) =>
        displayName(p.name).toLowerCase().includes(menuSearch.toLowerCase())
      )
    : getBuiltinPresets()

  const hasAnyItems = filteredPresets.length > 0

  return (
    <>
      <div className="relative" ref={menuRef}>
        <ToolbarButton onClick={() => setOpen((v) => !v)}>
          <Plus className="size-3.5" />
          {t('provider.add')}
        </ToolbarButton>
        {open && (
          <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border bg-popover shadow-lg flex flex-col max-h-80">
            {/* Search inside menu */}
            <div className="relative shrink-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
              <Input
                ref={searchInputRef}
                placeholder={t('provider.searchProviders')}
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                className="h-8 pl-7 pr-3 text-[11px] bg-transparent border border-input shadow-none focus-visible:ring-0 rounded-t-lg"
              />
            </div>

            {/* Scrollable list */}
            <div className="overflow-y-auto flex-1 py-1">
              {/* Builtin presets */}
              {filteredPresets.length > 0 && (
                <>
                  {!menuSearch && (
                    <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                      {t('provider.availablePresets')}
                    </p>
                  )}
                  {filteredPresets.map((preset) => {
                    const alreadyAdded = addedBuiltinIds.has(preset.builtinId)
                    return (
                      <button
                        key={preset.builtinId}
                        type="button"
                        disabled={alreadyAdded}
                        onClick={() => handleSelectPreset(preset)}
                        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ProviderIcon builtinId={preset.builtinId} size={16} />
                        <span className="flex-1 text-left truncate">{displayName(preset.name)}</span>
                        {alreadyAdded && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {t('provider.alreadyAdded')}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </>
              )}

              {!hasAnyItems && (
                <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                  {t('provider.noMatchResults')}
                </p>
              )}
            </div>

            {/* Custom provider option */}
            <div className="border-t shrink-0">
              <button
                type="button"
                onClick={() => {
                  setCustomOpen(true)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-4" />
                {t('provider.addCustomProvider')}
              </button>
            </div>
          </div>
        )}
      </div>
      <AddCustomProviderDialog open={customOpen} onOpenChange={setCustomOpen} />
    </>
  )
}

// --- Add Custom Provider Dialog (simplified) ---

function AddCustomProviderDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const addProvider = useProviderStore((s) => s.addProvider)
  const [name, setName] = useState('')
  const [type, setType] = useState<ProviderType>('openai-chat')
  const [baseUrl, setBaseUrl] = useState('')

  const handleAdd = (): void => {
    if (!name.trim()) return
    addProvider({
      id: nanoid(),
      name: { en: name.trim(), zh: name.trim() },
      type,
      apiKey: '',
      baseUrl: baseUrl.trim(),
      enabled: false,
      models: [],
      createdAt: Date.now()
    })
    toast.success(t('provider.addedProvider', { name: name.trim() }))
    setName('')
    setBaseUrl('')
    setType('openai-chat')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('provider.addCustomProvider')}</DialogTitle>
          <DialogDescription>{t('provider.addCustomProviderDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <SettingsRow layout="vertical" label={t('provider.providerName')}>
            <Input
              placeholder={t('provider.providerNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </SettingsRow>
          <SettingsRow layout="vertical" label={t('provider.protocolType')}>
            <Select value={type} onValueChange={(v) => setType(v as ProviderType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-chat">{t('provider.openaiChatCompat')}</SelectItem>
                <SelectItem value="openai-responses">{t('provider.openaiResponses')}</SelectItem>
                <SelectItem value="anthropic">{t('provider.anthropicMessages')}</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow layout="vertical" label={t('provider.baseUrl')} description={t('provider.baseUrlHint')}>
            <Input
              placeholder="https://api.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </SettingsRow>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('action.cancel', { ns: 'common' })}
            </Button>
            <Button disabled={!name.trim()} onClick={handleAdd}>
              {t('provider.add')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// --- Cascading Model Select ---

const MODEL_SELECT_TRIGGER =
  'inline-flex h-8 w-full items-center justify-between gap-1 rounded-md border border-input bg-background px-3 text-xs shadow-sm hover:bg-accent/50 transition-colors' as const

interface CascadingModelSelectProps {
  placeholder: string
  /** "providerId::modelId" */
  value: string
  groups: Array<{
    provider: ReturnType<typeof useProviderStore.getState>['providers'][number]
    models: Array<ReturnType<typeof useProviderStore.getState>['providers'][number]['models'][number]>
  }>
  onChange: (providerId: string, modelId: string) => void
}

function CascadingModelSelect({
  placeholder,
  value,
  groups,
  onChange
}: CascadingModelSelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  // Find display name for the selected model
  const selectedModelName = (() => {
    if (!value) return null
    const [pid, mid] = value.split('::')
    if (!pid || !mid) return null
    for (const g of groups) {
      if (g.provider.id === pid) {
        const model = g.models.find((m) => m.id === mid)
        if (model) return model.name
      }
    }
    return null
  })()

  const singleProvider = groups.length === 1

  const renderModel = (
    m: CascadingModelSelectProps['groups'][number]['models'][number],
    provider: CascadingModelSelectProps['groups'][number]['provider'],
    isSelected: boolean,
    onSelect: () => void
  ): React.JSX.Element => (
    <DropdownMenuItem key={m.id} className="text-xs py-1.5" onClick={onSelect}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/50 ring-1 ring-border/50">
          <ModelIcon
            icon={m.icon}
            modelId={m.id}
            providerBuiltinId={provider.builtinId}
            size={15}
            className="opacity-70"
          />
        </div>
        <div className="flex-1 min-w-0">
          <span className="block text-xs font-medium truncate">{m.name}</span>
          <ModelMetaBadges model={m} providerType={provider.type} className="mt-0.5" />
        </div>
        {isSelected && <Check className="size-3.5 shrink-0 text-primary ml-auto" />}
      </div>
    </DropdownMenuItem>
  )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className={MODEL_SELECT_TRIGGER}>
        {selectedModelName ? (
          <span className="truncate">{selectedModelName}</span>
        ) : (
          <span className="text-muted-foreground/50">{placeholder}</span>
        )}
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="start" sideOffset={4}>
        {singleProvider ? (
          // Single provider: show models directly
          groups[0].models.map((m) => {
            const isSelected = `${groups[0].provider.id}::${m.id}` === value
            return renderModel(m, groups[0].provider, isSelected, () => {
              onChange(groups[0].provider.id, m.id)
              setOpen(false)
            })
          })
        ) : (
          // Multiple providers: two-level cascading
          groups.map((g) => (
            <DropdownMenuSub key={g.provider.id}>
              <DropdownMenuSubTrigger className="text-xs gap-2">
                <span className="flex shrink-0 items-center">
                  <ProviderIcon builtinId={g.provider.builtinId} size={14} />
                </span>
                <span className="flex-1 truncate">{displayName(g.provider.name)}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                {g.models.map((m) => {
                  const isSelected = `${g.provider.id}::${m.id}` === value
                  return renderModel(m, g.provider, isSelected, () => {
                    onChange(g.provider.id, m.id)
                    setOpen(false)
                  })
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// --- Model Selection Bar ---

function ModelSelectionBar(): React.JSX.Element | null {
  const { t } = useTranslation('settings')
  const providers = useProviderStore((s) => s.providers)
  const activeProviderId = useProviderStore((s) => s.activeProviderId)
  const activeModelId = useProviderStore((s) => s.activeModelId)
  const activeAuxProviderId = useProviderStore((s) => s.activeAuxProviderId)
  const activeAuxModelId = useProviderStore((s) => s.activeAuxModelId)
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider)
  const setActiveModel = useProviderStore((s) => s.setActiveModel)
  const setActiveAuxProvider = useProviderStore((s) => s.setActiveAuxProvider)
  const setActiveAuxModel = useProviderStore((s) => s.setActiveAuxModel)

  const enabledProviders = providers.filter((p) => isProviderAvailableForModelSelection(p))
  const chatProviderGroups = enabledProviders
    .map((provider) => ({
      provider,
      models: provider.models.filter(
        (model) => model.enabled && (!model.category || model.category === 'chat')
      )
    }))
    .filter((group) => group.models.length > 0)

  if (chatProviderGroups.length === 0) return null

  const buildModelValue = (providerId: string, modelId: string): string =>
    `${providerId}::${modelId}`

  const activeModelValue =
    activeProviderId && activeModelId ? buildModelValue(activeProviderId, activeModelId) : ''
  const activeAuxModelValue =
    activeAuxProviderId && activeAuxModelId ? buildModelValue(activeAuxProviderId, activeAuxModelId) : ''

  // Resolve main model thinking config
  const mainProvider = activeProviderId ? providers.find((p) => p.id === activeProviderId) : null
  const mainModel = mainProvider?.models.find((m) => m.id === activeModelId)

  return (
    <SlideIn key="model-selection-bar" direction="down" offset={8} duration={0.25}>
      <div className="px-4 py-2.5 flex gap-3">
        {/* Main model card */}
        <div className="flex-1 rounded-lg border bg-card px-5 py-3.5">
          <SettingsRow
            layout="vertical"
            label={t('model.mainModel')}
            description={t('model.mainModelDesc')}
          >
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <CascadingModelSelect
                  placeholder={t('model.selectModel')}
                  value={activeModelValue}
                  groups={chatProviderGroups}
                  onChange={(providerId, modelId) => {
                    if (providerId !== activeProviderId) setActiveProvider(providerId)
                    setActiveModel(modelId)
                  }}
                />
              </div>
              {activeProviderId && activeModelId && mainModel?.supportsThinking && mainModel?.thinkingConfig && (
                <ThinkingLevelSelect
                  providerId={activeProviderId}
                  modelId={activeModelId}
                  thinkingConfig={mainModel.thinkingConfig}
                />
              )}
            </div>
          </SettingsRow>
        </div>

        {/* Auxiliary model card */}
        <div className="flex-1 rounded-lg border bg-card px-5 py-3.5">
          <SettingsRow
            layout="vertical"
            label={t('model.auxiliaryModel')}
            description={t('model.auxiliaryModelDesc')}
          >
            <CascadingModelSelect
              placeholder={t('model.selectAuxiliaryModel')}
              value={activeAuxModelValue}
              groups={chatProviderGroups}
              onChange={(providerId, modelId) => {
                if (providerId !== activeAuxProviderId) setActiveAuxProvider(providerId)
                setActiveAuxModel(modelId)
              }}
            />
          </SettingsRow>
        </div>
      </div>
    </SlideIn>
  )
}

// --- Main ProviderPanel ---

export function ProviderPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const providers = useProviderStore((s) => s.providers)
  const removeProviders = useProviderStore((s) => s.removeProviders)
  const reorderProviders = useProviderStore((s) => s.reorderProviders)
  const toggleProviderEnabled = useProviderStore((s) => s.toggleProviderEnabled)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Edit mode
  const [editMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragPosition, setDragPosition] = useState<'before' | 'after'>('after')

  // Sort: enabled first, then by name (or preserve store order in edit mode)
  const sortedProviders = useMemo(() => {
    const filtered = searchQuery
      ? providers.filter((p) =>
          displayName(p.name).toLowerCase().includes(searchQuery.toLowerCase())
        )
      : [...providers]
    if (editMode) {
      // In edit mode, preserve store order but still group enabled first
      return filtered.sort((a, b) => {
        const aIdx = providers.indexOf(a)
        const bIdx = providers.indexOf(b)
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
        return aIdx - bIdx
      })
    }
    return filtered.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      return displayName(a.name).localeCompare(displayName(b.name))
    })
  }, [providers, searchQuery, editMode])

  // -- Edit mode handlers --

  const enterEditMode = (): void => {
    setEditMode(true)
    setSelectedIds(new Set())
    setExpandedId(null)
  }

  const exitEditMode = (): void => {
    setEditMode(false)
    setSelectedIds(new Set())
  }

  // Auto-exit edit mode when all providers are deleted
  useEffect(() => {
    if (editMode && providers.length === 0) {
      exitEditMode()
    }
  }, [editMode, providers.length])

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSelectAll = (): void => {
    if (selectedIds.size === sortedProviders.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sortedProviders.map((p) => p.id)))
    }
  }

  const handleBatchDelete = async (): Promise<void> => {
    if (selectedIds.size === 0) return
    const ok = await confirm({
      title: t('provider.deleteSelected'),
      description: t('provider.deleteSelectedConfirm', { count: selectedIds.size }),
      confirmLabel: t('provider.deleteProvider'),
      variant: 'destructive'
    })
    if (!ok) return
    removeProviders([...selectedIds])
    setSelectedIds(new Set())
    toast.success(t('provider.providersDeleted', { count: selectedIds.size }))
  }

  // -- Drag-and-drop handlers --

  const handleDragStart = (e: React.DragEvent, id: string): void => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    // Make dragged element semi-transparent
    ;(e.currentTarget as HTMLElement).classList.add('opacity-40')
  }

  const handleDragEnd = (e: React.DragEvent): void => {
    ;(e.currentTarget as HTMLElement).classList.remove('opacity-40')
    setDragOverId(null)
  }

  const handleDragOver = (e: React.DragEvent, id: string): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(id)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDragPosition(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
  }

  const handleDragLeave = (): void => {
    // Only clear if we're actually leaving the element (not entering a child)
  }

  const handleDrop = (e: React.DragEvent, targetId: string): void => {
    e.preventDefault()
    setDragOverId(null)
    const draggedId = e.dataTransfer.getData('text/plain')
    if (draggedId === targetId) return

    const draggedProvider = providers.find((p) => p.id === draggedId)
    const targetProvider = providers.find((p) => p.id === targetId)
    if (!draggedProvider || !targetProvider) return

    // Constraint: only reorder within same enabled/disabled group
    if (draggedProvider.enabled !== targetProvider.enabled) return

    const newOrder = providers.map((p) => p.id)
    const draggedIdx = newOrder.indexOf(draggedId)
    const _targetIdx = newOrder.indexOf(targetId)

    newOrder.splice(draggedIdx, 1)
    const adjustedTarget = newOrder.indexOf(targetId)
    const insertAt = dragPosition === 'before' ? adjustedTarget : adjustedTarget + 1
    newOrder.splice(insertAt, 0, draggedId)

    // Verify enabled-before-disabled constraint
    const orderedProviders = newOrder
      .map((id) => providers.find((p) => p.id === id))
      .filter((p): p is ModelProvider => Boolean(p))
    const firstDisabled = orderedProviders.findIndex((p) => !p.enabled)
    if (firstDisabled >= 0) {
      const hasEnabledAfter = orderedProviders.slice(firstDisabled).some((p) => p.enabled)
      if (hasEnabledAfter) return
    }

    reorderProviders(newOrder)
  }

  const allSelected = sortedProviders.length > 0 && selectedIds.size === sortedProviders.length

  return (
    <div className="flex flex-col h-full">
      {/* Model selection bar (above search, hidden in edit mode) */}
      {!editMode && (
        <AnimatePresence>
          <ModelSelectionBar />
        </AnimatePresence>
      )}

      {/* Top bar */}
      {editMode ? (
        <div className="px-4 pt-3 pb-1 shrink-0">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <button
            type="button"
            onClick={handleSelectAll}
            className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            {allSelected ? t('provider.deselectAll') : t('provider.selectAll')}
          </button>
          <span className="text-xs text-muted-foreground/70">
            {selectedIds.size > 0
              ? t('provider.selectedCount', { count: selectedIds.size })
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
            {t('provider.deleteSelected')}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={exitEditMode}>
            {t('provider.done')}
          </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-4 py-2.5 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
            <Input
              placeholder={t('provider.searchProviders')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-transparent border border-input shadow-none focus-visible:ring-0 rounded-lg"
            />
          </div>
          <ToolbarButton
            onClick={enterEditMode}
            disabled={sortedProviders.length === 0}
          >
            <Pencil className="size-3.5" />
            {t('provider.edit')}
          </ToolbarButton>
          <AddProviderMenu />
        </div>
      )}

      {/* Provider cards */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2.5 space-y-1.5 pb-20">
          {sortedProviders.length === 0 && (
            <PanelEmptyState
              icon={<Server className="size-7 text-muted-foreground" />}
              title={searchQuery ? t('provider.noProvidersFound') : t('provider.noProviders')}
              className="py-16"
            />
          )}
          <AnimatePresence mode="popLayout">
          {sortedProviders.map((provider) => {
            const isExpanded = expandedId === provider.id
            const isSelected = selectedIds.has(provider.id)
            const isDragOver = dragOverId === provider.id

            return (
              <motion.div
                key={provider.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <div
                  draggable={editMode}
                  onDragStart={editMode ? (e) => handleDragStart(e, provider.id) : undefined}
                  onDragEnd={editMode ? handleDragEnd : undefined}
                  onDragOver={editMode ? (e) => handleDragOver(e, provider.id) : undefined}
                  onDragLeave={editMode ? handleDragLeave : undefined}
                  onDrop={editMode ? (e) => handleDrop(e, provider.id) : undefined}
                  className={`rounded-lg border ${
                    isSelected
                      ? 'border-foreground/15 bg-accent/50 ring-1 ring-border'
                      : 'bg-card hover:border-border/80'
                  } ${isDragOver && dragPosition === 'before' ? 'border-t-2 border-t-foreground/15' : ''} ${
                    isDragOver && dragPosition === 'after' ? 'border-b-2 border-b-foreground/15' : ''
                  }`}
                >
                {/* Card header */}
                <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                  {/* Edit mode: checkbox + drag handle */}
                  {editMode && (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleSelect(provider.id)}
                        className={`shrink-0 size-5 rounded-sm border-2 flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-muted-foreground/30 hover:border-muted-foreground/60'
                        }`}
                      >
                        {isSelected && <Check className="size-3" />}
                      </button>
                      <div className="shrink-0 text-muted-foreground/40 cursor-grab active:cursor-grabbing">
                        <GripVertical className="size-4" />
                      </div>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (editMode) {
                        toggleSelect(provider.id)
                      } else {
                        setExpandedId(isExpanded ? null : provider.id)
                      }
                    }}
                    className="flex flex-1 items-center gap-2.5 min-w-0 text-left"
                  >
                    <ProviderIcon builtinId={provider.builtinId} size={20} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium truncate">{displayName(provider.name)}</span>
                        <span
                          className={`shrink-0 text-[10px] font-medium ${
                            provider.enabled ? 'text-emerald-600' : 'text-muted-foreground'
                          }`}
                        >
                          {provider.enabled
                            ? `● ${t('provider.enabled')}`
                            : `○ ${t('provider.disabled')}`}
                        </span>
                      </div>
                    </div>
                  </button>

                  {!editMode && (
                    <>
                      <Switch
                        checked={provider.enabled}
                        onCheckedChange={() => toggleProviderEnabled(provider.id)}
                      />
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : provider.id)}
                        className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <ChevronDown
                          className={`size-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </button>
                    </>
                  )}
                </div>

                {/* Expanded config (non-edit mode only) */}
                <AnimatePresence initial={false}>
                  {isExpanded && !editMode && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <ProviderConfigPanel provider={provider} hideHeader />
                    </motion.div>
                  )}
                </AnimatePresence>
                </div>
              </motion.div>
            )
          })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
