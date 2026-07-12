import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import { confirm } from '@/components/ui/confirm-dialog'
import {
  Plus,
  Search,
  Eye,
  EyeOff,
  Trash2,
  Pencil,
  Check,
  Image as ImageIcon,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
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
  useProviderStore,
  getBuiltinPresets
} from '@/stores/provider-store'
import type {
  AIModelConfig,
  ModelProvider,
  ModelCategory
} from '@/lib/api/types'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SettingsRow } from '@/components/ui/settings-row'
import { ProviderIcon, ModelIcon } from '../provider-icons'
import { ModelMetaBadges } from './model-meta'
import { displayName } from '@/lib/localized-string'

// --- Auth tab fields use SettingsRow (horizontal layout) ---

// ModelFormDialog � simplified add/edit model dialog

/** Compute initial unit and display value from raw context length */
function initContextLength(raw: number | undefined): { value: string; unit: 'K' | 'M' } {
  if (!raw) return { value: '', unit: 'M' }
  if (raw >= 1_000_000 && raw % 1_000_000 === 0) {
    return { value: (raw / 1_000_000).toString(), unit: 'M' }
  }
  return { value: Math.round(raw / 1000).toString(), unit: 'K' }
}

/** Convert display value + unit to raw number string */
function contextLengthToRaw(displayVal: string, unit: 'K' | 'M'): string {
  if (!displayVal.trim()) return ''
  const n = parseInt(displayVal, 10)
  if (isNaN(n)) return ''
  return (n * (unit === 'M' ? 1_000_000 : 1000)).toString()
}

type MaxOutputUnit = 'raw' | 'K'

/** Compute initial unit and display value from raw max output tokens */
function initMaxOutputTokens(raw: number | undefined): { value: string; unit: MaxOutputUnit } {
  if (!raw) return { value: '', unit: 'K' }
  if (raw >= 1000 && raw % 1000 === 0) {
    return { value: (raw / 1000).toString(), unit: 'K' }
  }
  return { value: raw.toString(), unit: 'raw' }
}

/** Convert display value + unit to raw number string for max output tokens */
function maxOutputTokensToRaw(displayVal: string, unit: MaxOutputUnit): string {
  if (!displayVal.trim()) return ''
  const n = parseInt(displayVal, 10)
  if (isNaN(n)) return ''
  return (n * (unit === 'K' ? 1000 : 1)).toString()
}

function ModelFormDialog({
  open,
  onOpenChange,
  initial,
  onSave,
  allowIdEditing = false
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: AIModelConfig
  onSave: (model: AIModelConfig) => void | boolean
  allowIdEditing?: boolean
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const isEdit = !!initial

  const [id, setId] = useState(initial?.id ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState<ModelCategory>(initial?.category ?? 'chat')
  const ctxInit = initContextLength(initial?.contextLength)
  const [contextLengthDisplay, setContextLengthDisplay] = useState(ctxInit.value)
  const [contextLengthUnit, setContextLengthUnit] = useState<'K' | 'M'>(ctxInit.unit)
  const moInit = initMaxOutputTokens(initial?.maxOutputTokens)
  const [maxOutputDisplay, setMaxOutputDisplay] = useState(moInit.value)
  const [maxOutputUnit, setMaxOutputUnit] = useState<MaxOutputUnit>(moInit.unit)
  const [supportsVision, setSupportsVision] = useState(initial?.supportsVision ?? false)
  const [supportsThinking, setSupportsThinking] = useState(initial?.supportsThinking ?? true)

  const handleSave = (): void => {
    const trimmedId = id.trim()
    if (!trimmedId) return
    const model: AIModelConfig = {
      id: trimmedId,
      name: name.trim() || trimmedId,
      enabled: initial?.enabled ?? true,
      supportsVision,
      supportsThinking
    }
    model.category = category
    const rawCtx = contextLengthToRaw(contextLengthDisplay, contextLengthUnit)
    if (rawCtx) { const v = parseInt(rawCtx); if (!isNaN(v)) model.contextLength = v }
    const rawMo = maxOutputTokensToRaw(maxOutputDisplay, maxOutputUnit)
    if (rawMo) { const v = parseInt(rawMo); if (!isNaN(v)) model.maxOutputTokens = v }
    const result = onSave(model)
    if (result !== false) onOpenChange(false)
  }

  const handleUnitChange = (newUnit: 'K' | 'M') => {
    const raw = contextLengthToRaw(contextLengthDisplay, contextLengthUnit)
    setContextLengthUnit(newUnit)
    if (!raw) return
    const n = parseInt(raw, 10)
    setContextLengthDisplay((n / (newUnit === 'M' ? 1_000_000 : 1000)).toString())
  }

  const handleMaxOutputUnitChange = (newUnit: MaxOutputUnit) => {
    const raw = maxOutputTokensToRaw(maxOutputDisplay, maxOutputUnit)
    setMaxOutputUnit(newUnit)
    if (!raw) return
    const n = parseInt(raw, 10)
    setMaxOutputDisplay((n / (newUnit === 'K' ? 1000 : 1)).toString())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('provider.editModel') : t('provider.addModelTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <SettingsRow layout="vertical" label={t('provider.modelId') + ' *'}>
              <Input placeholder={t('provider.modelIdPlaceholder')} value={id}
                onChange={(e) => setId(e.target.value)} disabled={isEdit && !allowIdEditing}
                autoFocus={!isEdit} className="h-8 text-xs" />
            </SettingsRow>
            <SettingsRow layout="vertical" label={t('provider.modelName')}>
              <Input placeholder={t('provider.modelNamePlaceholder')} value={name}
                onChange={(e) => setName(e.target.value)} autoFocus={isEdit} className="h-8 text-xs" />
            </SettingsRow>
          </div>

          <SettingsRow layout="vertical" label={t('provider.modelCategory')}>
            <Select value={category} onValueChange={(v) => setCategory(v as ModelCategory)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chat" className="text-xs">{t('provider.modelCategoryChat')}</SelectItem>
                <SelectItem value="speech" className="text-xs">{t('provider.modelCategorySpeech')}</SelectItem>
                <SelectItem value="embedding" className="text-xs">{t('provider.modelCategoryEmbedding')}</SelectItem>
                <SelectItem value="image" className="text-xs">{t('provider.modelCategoryImage')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>

          <div className="grid grid-cols-2 gap-3">
            <SettingsRow layout="vertical" label={t('provider.contextLength')}>
              <div className="relative flex items-center w-full rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring/40 focus-within:ring-ring/20 focus-within:ring-1">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="1"
                  value={contextLengthDisplay}
                  onChange={(e) => setContextLengthDisplay(e.target.value)}
                  className="flex-1 min-w-0 border-0 bg-transparent px-3 py-1 outline-none placeholder:text-muted-foreground h-8 text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleUnitChange(contextLengthUnit === 'K' ? 'M' : 'K')}
                  className="h-6 px-1.5 mr-1 text-[10px] font-semibold rounded-sm hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors shrink-0"
                >
                  {contextLengthUnit}
                </button>
              </div>
            </SettingsRow>
            <SettingsRow layout="vertical" label={t('provider.maxOutputTokens')}>
              <div className="relative flex items-center w-full rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring/40 focus-within:ring-ring/20 focus-within:ring-1">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="128"
                  value={maxOutputDisplay}
                  onChange={(e) => setMaxOutputDisplay(e.target.value)}
                  className="flex-1 min-w-0 border-0 bg-transparent px-3 py-1 outline-none placeholder:text-muted-foreground h-8 text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleMaxOutputUnitChange(maxOutputUnit === 'K' ? 'raw' : 'K')}
                  className="h-6 px-1.5 mr-1 text-[10px] font-semibold rounded-sm hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors shrink-0"
                >
                  {maxOutputUnit === 'K' ? 'K' : '×1'}
                </button>
              </div>
            </SettingsRow>
          </div>

          <SettingsRow layout="vertical" label={t('provider.capabilities')}>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSupportsVision((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                  supportsVision
                    ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'border-border bg-background hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <ImageIcon className="size-3.5" />
                {t('provider.capabilityVision')}
              </button>
              <button
                type="button"
                onClick={() => setSupportsThinking((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                  supportsThinking
                    ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                    : 'border-border bg-background hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <Sparkles className="size-3.5" />
                {t('provider.capabilityThinking')}
              </button>
            </div>
          </SettingsRow>

        </div>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{t('action.cancel', { ns: 'common' })}</Button>
          <Button size="sm" onClick={handleSave} disabled={!id.trim()}>{t('action.save', { ns: 'common' })}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// QuotaProgressBar (kept for future Codex/Copilot integration)

// ProviderConfigPanel � main provider configuration panel

export function ProviderConfigPanel({
  provider,
  hideHeader = false
}: {
  provider: ModelProvider
  hideHeader?: boolean
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const updateProvider = useProviderStore((s) => s.updateProvider)
  const removeProvider = useProviderStore((s) => s.removeProvider)
  const toggleProviderEnabled = useProviderStore((s) => s.toggleProviderEnabled)
  const addModel = useProviderStore((s) => s.addModel)
  const removeModel = useProviderStore((s) => s.removeModel)

  const [showKey, setShowKey] = useState(false)
  const [addModelOpen, setAddModelOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('auth')
  const [modelSearch, setModelSearch] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set())

  const builtinPreset = useMemo(
    () =>
      provider.builtinId
        ? getBuiltinPresets().find((p) => p.builtinId === provider.builtinId)
        : undefined,
    [provider.builtinId]
  )

  const handleDeleteProvider = async (): Promise<void> => {
    if (provider.builtinId) return
    const ok = await confirm({
      title: t('provider.deleteProvider'),
      description: t('provider.deleteProviderConfirm', { name: displayName(provider.name) }),
      confirmLabel: t('provider.deleteProvider'),
      variant: 'destructive'
    })
    if (!ok) return
    removeProvider(provider.id)
    toast.success(t('provider.providerDeleted'))
  }

  // -- Edit mode handlers --

  const enterEditMode = (): void => {
    setEditMode(true)
    setSelectedModelIds(new Set())
  }

  const exitEditMode = (): void => {
    setEditMode(false)
    setSelectedModelIds(new Set())
  }

  // Auto-exit edit mode when all models are deleted
  useEffect(() => {
    if (editMode && provider.models.length === 0) {
      exitEditMode()
    }
  }, [editMode, provider.models.length])

  const toggleSelectModel = (id: string): void => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSelectAllModels = (): void => {
    if (selectedModelIds.size === filteredModels.length) {
      setSelectedModelIds(new Set())
    } else {
      setSelectedModelIds(new Set(filteredModels.map((m) => m.id)))
    }
  }

  const handleBatchDeleteModels = async (): Promise<void> => {
    if (selectedModelIds.size === 0) return
    const ok = await confirm({
      title: t('provider.deleteSelected'),
      description: t('provider.deleteSelectedConfirm', { count: selectedModelIds.size }),
      confirmLabel: t('provider.deleteProvider'),
      variant: 'destructive'
    })
    if (!ok) return
    for (const id of selectedModelIds) {
      removeModel(provider.id, id)
    }
    setSelectedModelIds(new Set())
    toast.success(t('provider.providersDeleted', { count: selectedModelIds.size }))
  }

  const filteredModels = useMemo(() => {
    if (!modelSearch.trim()) return provider.models
    const q = modelSearch.toLowerCase()
    return provider.models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    )
  }, [provider.models, modelSearch])

  // Render

  return (
    <div className={hideHeader ? 'flex flex-col' : 'flex flex-col h-full overflow-hidden'}>
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0 bg-card/30">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-muted/50 ring-1 ring-border/50">
              <ProviderIcon builtinId={provider.builtinId} size={22} />
            </div>
            <h3 className="text-sm font-semibold">{displayName(provider.name)}</h3>
          </div>
          <div className="flex items-center gap-2">
            {!provider.builtinId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                title={t('provider.deleteProvider')}
                onClick={() => void handleDeleteProvider()}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
            <Switch
              checked={provider.enabled}
              onCheckedChange={() => toggleProviderEnabled(provider.id)}
            />
          </div>
        </div>
      )}

      {/* Body */}
      <div className={
        hideHeader
          ? 'flex-1 min-h-0 flex-col overflow-y-auto px-5 py-4'
          : 'flex flex-1 min-h-0 flex-col overflow-y-auto overflow-x-hidden px-5 py-4'
      }>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full mb-4">
            <TabsTrigger value="auth" className="flex-1 text-xs">
              {t('provider.authTab')}
            </TabsTrigger>
            <TabsTrigger value="models" className="flex-1 text-xs">
              {t('provider.modelsTab')}
            </TabsTrigger>
          </TabsList>

          {/* Tab: Authentication */}
          <TabsContent value="auth" className="space-y-5 mt-0">
            <SettingsRow label={t('provider.apiKey')}>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  placeholder={t('provider.apiKeyPlaceholder')}
                  value={provider.apiKey}
                  onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
                  className="pr-9 h-8 text-xs w-96"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
            </SettingsRow>

            <SettingsRow label={t('provider.baseUrl')}>
              <Input
                placeholder={builtinPreset?.defaultBaseUrl || 'https://api.example.com'}
                value={provider.baseUrl}
                onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
                className="h-8 text-xs w-96"
              />
            </SettingsRow>
          </TabsContent>

          {/* Tab: Models */}
          <TabsContent value="models" className="mt-0">
            <div className="flex min-h-0 max-h-[460px] flex-col">
              {/* Toolbar */}
              {editMode ? (
                <div className="py-3 shrink-0">
                  <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                  <button
                    type="button"
                    onClick={handleSelectAllModels}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    {selectedModelIds.size === filteredModels.length && filteredModels.length > 0
                      ? t('provider.deselectAll')
                      : t('provider.selectAll')}
                  </button>
                  <span className="text-xs text-muted-foreground/70">
                    {selectedModelIds.size > 0
                      ? t('provider.selectedCount', { count: selectedModelIds.size })
                      : ''}
                  </span>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    disabled={selectedModelIds.size === 0}
                    onClick={() => void handleBatchDeleteModels()}
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
                <div className="flex items-center justify-between py-3 shrink-0 gap-3">
                  <div className="relative flex-1 max-w-[220px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
                    <Input
                      placeholder={t('provider.searchModels')}
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      className="h-8 pl-7 text-xs bg-transparent border border-input shadow-none focus-visible:ring-0 rounded-lg"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 rounded-full p-0"
                      disabled={provider.models.length === 0}
                      onClick={enterEditMode}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 rounded-full p-0"
                      onClick={() => setAddModelOpen(true)}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Model list */}
              {filteredModels.length === 0 ? (
                <div className="flex flex-1 items-center justify-center py-12 text-center text-xs text-muted-foreground">
                  {modelSearch.trim() ? t('provider.noMatchResults') : t('provider.noModels')}
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-1.5 auto-rows-min">
                  <AnimatePresence mode="popLayout">
                  {filteredModels.map((model) => {
                    const isSelected = selectedModelIds.has(model.id)
                    return (
                      <motion.div
                        key={model.id}
                        layout
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 ${
                          isSelected
                            ? 'border-foreground/15 bg-accent/50 ring-1 ring-border'
                            : 'bg-background hover:border-border/80'
                        }`}
                        onClick={editMode ? () => toggleSelectModel(model.id) : undefined}
                        role={editMode ? 'button' : undefined}
                      >
                        {/* Edit mode: checkbox */}
                        {editMode && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleSelectModel(model.id)
                            }}
                            className={`shrink-0 size-5 rounded-sm border-2 flex items-center justify-center transition-colors ${
                              isSelected
                                ? 'bg-primary border-primary text-primary-foreground'
                                : 'border-muted-foreground/30 hover:border-muted-foreground/60'
                            }`}
                          >
                            {isSelected && <Check className="size-3" />}
                          </button>
                        )}

                        {/* Icon */}
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/50 ring-1 ring-border/50">
                          <ModelIcon
                            icon={model.icon}
                            modelId={model.id}
                            providerBuiltinId={provider.builtinId}
                            size={18}
                            className="opacity-70"
                          />
                        </div>

                        {/* Info */}
                        <div className="flex flex-1 items-center gap-2 min-w-0">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] font-medium truncate">{model.name}</span>
                            </div>
                            <ModelMetaBadges
                              model={model}
                              providerType={provider.type}
                              className="mt-1"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </TabsContent>

        </Tabs>
      </div>

      {/* Add model dialog */}
      <ModelFormDialog
        open={addModelOpen}
        onOpenChange={setAddModelOpen}
        onSave={(model) => addModel(provider.id, model)}
      />
    </div>
  )
}
