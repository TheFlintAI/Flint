import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  GitFork,
  HardDrive,
  Home,
  Loader2
} from 'lucide-react'
import type { Plugin } from '@/stores/plugin-store'
import { usePluginStore } from '@/stores/plugin-store'
import { resolveDisplayName, resolveDisplayDescription } from '@/lib/plugin/display'
import { resolveLocalizedString } from '@/lib/localized-string'
import { resolveLucideIcon } from '@/lib/tools/tool-icon'
import { PluginPermissionsPanel } from '@/components/settings/PluginPermissionsPanel'
import { PluginToolsList } from '@/components/settings/PluginToolsList'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { VNodeRenderer } from '@/components/plugins/ui-renderer/VNodeRenderer'
import type { VNode, FormActionData } from '@/lib/plugin/vnode-types'
import { getWorkerManager } from '@/stores/plugin-store'

type SettingsT = ReturnType<typeof useTranslation<'settings'>>['t']

function PluginIcon({ icon, className }: { icon?: string; className?: string }): React.JSX.Element {
  const Icon = resolveLucideIcon(icon)
  return <Icon className={className} />
}

function ExternalTextLink({ href }: { href: string }): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-center gap-1.5">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-primary hover:underline"
      >
        {href}
      </a>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
      <button
        type="button"
        className="inline-flex shrink-0 items-center text-muted-foreground hover:text-foreground"
        onClick={() => {
          void navigator.clipboard.writeText(href).then(() => {
            setCopied(true)
            toast.success(t('plugin.copiedToClipboard'))
            setTimeout(() => setCopied(false), 2000)
          })
        }}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </span>
  )
}

function AboutTab({
  plugin,
  t
}: {
  plugin: Plugin
  t: SettingsT
}): React.JSX.Element {
  const { manifest } = plugin

  const formatSize = (bytes: number): string => {
    if (!bytes || bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-card/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <HardDrive className="size-4 text-muted-foreground" />
            <span className="text-[13px] font-medium">{t('plugin.size', { defaultValue: 'Size' })}</span>
          </div>
          <p className="text-[20px] font-semibold tabular-nums">{formatSize(plugin.size)}</p>
        </div>
        <div className="rounded-xl border bg-card/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ExternalLink className="size-4 text-muted-foreground" />
            <span className="text-[13px] font-medium">{t('plugin.links', { defaultValue: 'Links' })}</span>
          </div>
          {manifest.homepage || manifest.repository ? (
            <div className="space-y-2.5">
              {manifest.homepage ? (
                <div className="flex items-start gap-2">
                  <Home className="size-3.5 shrink-0 text-muted-foreground mt-0.5" />
                  <ExternalTextLink href={manifest.homepage} />
                </div>
              ) : null}
              {manifest.repository ? (
                <div className="flex items-start gap-2">
                  <GitFork className="size-3.5 shrink-0 text-muted-foreground mt-0.5" />
                  <ExternalTextLink href={manifest.repository} />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              {t('plugin.noLinks', { defaultValue: 'No links provided' })}
            </p>
          )}
        </div>
      </div>

      {/* Permissions */}
      <PluginPermissionsPanel permissions={plugin.manifest.permissions} t={t} />
    </div>
  )
}

function PluginTabContent({
  pluginId,
  tabId,
  language,
  onNavigateTab,
}: {
  pluginId: string
  tabId: string
  language: string
  onNavigateTab?: (tabId: string) => void
}): React.JSX.Element {
  const loadTabVNode = usePluginStore((s) => s.loadTabVNode)
  const vnode = usePluginStore((s) => s.tabVNodes[pluginId]?.[tabId] ?? null)

  useEffect(() => {
    if (!vnode) {
      void loadTabVNode(pluginId, tabId)
    }
  }, [pluginId, tabId, vnode, loadTabVNode])

  const handleFormAction = useCallback((data: FormActionData) => {
    // Intercept navigate-tab actions — switch tabs in the host UI
    if (data.action.startsWith('navigate-tab:')) {
      const targetTab = data.action.slice('navigate-tab:'.length)
      onNavigateTab?.(targetTab)
      return
    }
    const wm = getWorkerManager()
    wm.sendEvent(pluginId, 'ui:action', data)
  }, [pluginId, onNavigateTab])

  if (!vnode) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <VNodeRenderer node={vnode as VNode} language={language} onFormAction={handleFormAction} />
}

interface PluginCardProps {
  plugin: Plugin
  isExpanded: boolean
  onToggleExpand: () => void
  editMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}

export function PluginCard({
  plugin,
  isExpanded,
  onToggleExpand,
  editMode = false,
  selected = false,
  onToggleSelect,
}: PluginCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation('settings')
  const togglePlugin = usePluginStore((state) => state.togglePlugin)
  const pluginTabs = usePluginStore((state) => state.pluginTabs[plugin.id])
  const pluginTools = usePluginStore((state) => state.pluginTools[plugin.id])
  const { manifest } = plugin
  const displayName = resolveDisplayName(manifest.displayName, manifest.name, i18n.language)
  const description = resolveDisplayDescription(manifest.displayDescription, i18n.language)

  const [activeTab, setActiveTab] = useState<string>('about')

  const hasTools = (pluginTools ?? []).length > 0

  const allTabs = [
    { id: 'about', label: t('plugin.tab.about', { defaultValue: 'About' }) },
    ...(hasTools ? [{ id: 'tools', label: t('plugin.tab.tools', { defaultValue: 'Tools' }) }] : []),
    ...(pluginTabs ?? []).map((tab) => ({ id: tab.id, label: resolveLocalizedString(tab.label, i18n.language) })),
  ]

  return (
    <div
      className={cn(
        'rounded-lg border',
        'bg-card hover:border-border/80',
        plugin.enabled ? '' : 'opacity-55 grayscale-[20%]',
        selected && 'border-foreground/15 bg-accent/50 ring-1 ring-border'
      )}
    >
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        {editMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect?.()
            }}
            className={cn(
              'shrink-0 size-5 rounded-sm border-2 flex items-center justify-center transition-colors',
              selected
                ? 'bg-primary border-primary text-primary-foreground'
                : 'border-muted-foreground/30 hover:border-muted-foreground/60'
            )}
          >
            {selected && <Check className="size-3" />}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            if (editMode) {
              onToggleSelect?.()
            } else {
              onToggleExpand()
            }
          }}
          className="flex flex-1 items-center gap-2.5 min-w-0 text-left"
        >
          <span className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-xl',
            'transition-colors duration-200',
            plugin.enabled
              ? 'bg-accent text-accent-foreground'
              : 'bg-muted text-muted-foreground'
          )}>
            <PluginIcon icon={manifest.icon} className="size-5" />
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium truncate">{displayName}</span>
              <span className="shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                v{manifest.version}
              </span>
              {plugin.status === 'error' ? (
                <Badge variant="destructive" className="text-[10px] shrink-0">
                  {t('plugin.error', { defaultValue: 'Error' })}
                </Badge>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
              {description || t('plugin.noDescription', { defaultValue: 'No description provided.' })}
            </p>
          </div>
        </button>

        <Switch
          checked={plugin.enabled}
          onCheckedChange={() => void togglePlugin(plugin.id)}
          disabled={editMode}
        />
        <button
          type="button"
          onClick={editMode ? undefined : onToggleExpand}
          className={cn(
            'shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
            editMode && 'opacity-40 pointer-events-none'
          )}
        >
          <ChevronDown
            className={cn('size-4 transition-transform duration-200', isExpanded && 'rotate-180')}
          />
        </button>
      </div>

      {isExpanded && (
        <div className="overflow-hidden">
          {plugin.errorMessage ? (
            <div className="mx-4 mt-4 flex items-start gap-2 rounded-xl bg-destructive/5 px-4 py-3">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p className="text-[13px] text-destructive">{plugin.errorMessage}</p>
            </div>
          ) : null}

          {/* Tab navigation */}
          {allTabs.length > 1 ? (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mx-4 mt-4 w-fit">
                {allTabs.map((tab) => (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="text-[12px]"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="about" className="px-4 py-4 max-h-[30rem] overflow-y-auto">
                <AboutTab plugin={plugin} t={t} />
              </TabsContent>
              {hasTools ? (
                <TabsContent value="tools" className="px-4 py-4 max-h-[30rem] overflow-y-auto">
                  <PluginToolsList tools={pluginTools!} />
                </TabsContent>
              ) : null}
              {(pluginTabs ?? []).map((tab) => (
                <TabsContent key={tab.id} value={tab.id} className="px-4 py-4 max-h-[30rem] overflow-y-auto">
                  <PluginTabContent pluginId={plugin.id} tabId={tab.id} language={i18n.language} onNavigateTab={setActiveTab} />
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <div className="px-4 py-4 max-h-[30rem] overflow-y-auto">
              <AboutTab plugin={plugin} t={t} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
