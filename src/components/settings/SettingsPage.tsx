import {
  SlidersHorizontal,
  Cpu,
  Blocks,
  Sparkles,
  Brain
} from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import * as React from 'react'
import { useUIStore, type SettingsTab } from '@/stores/ui-store'
import { useTranslation } from 'react-i18next'
import { FadeIn, SlideIn } from '@/components/animate-ui'
import { PanelFallback } from '@/components/ui/lazy-fallback'

const GeneralPanel = React.lazy(() =>
  import('./GeneralPanel').then(m => ({ default: m.GeneralPanel }))
)
const MemoryPanel = React.lazy(() =>
  import('./MemoryPanel').then(m => ({ default: m.MemoryPanel }))
)
const ProviderPanel = React.lazy(() =>
  import('./ProviderPanel').then(m => ({ default: m.ProviderPanel }))
)
const PluginSettingsPanel = React.lazy(() =>
  import('./PluginSettingsPanel').then(m => ({ default: m.PluginSettingsPanel }))
)
const SkillsPage = React.lazy(() =>
  import('@/components/skills/SkillsPage').then(m => ({ default: m.SkillsPage }))
)

function SkillPanel(): React.JSX.Element {
  return <SkillsPage embedded />
}

const panelRenderers: Record<SettingsTab, () => React.JSX.Element> = {
  general:  () => <GeneralPanel />,
  memory:   () => <MemoryPanel />,
  provider: () => <ProviderPanel />,
  plugin:   () => <PluginSettingsPanel />,
  skill:    () => <SkillPanel />,
}

const redesignedSettingsGroups: Array<{
  id: string
  titleKey: string
  defaultTitle: string
  descriptionKey: string
  defaultDescription: string
  tabs: Array<{
    id: SettingsTab
    titleKey: string
    defaultTitle: string
    descriptionKey: string
    defaultDescription: string
    icon: React.ReactNode
    tone: string
  }>
}> = [
  {
    id: 'connections',
    titleKey: 'redesign.groups.connections.title',
    defaultTitle: 'Connections',
    descriptionKey: 'redesign.groups.connections.desc',
    defaultDescription: 'Accounts, models, and tools live here.',
    tabs: [
      {
        id: 'provider',
        titleKey: 'redesign.tabs.provider.title',
        defaultTitle: 'Models',
        descriptionKey: 'redesign.tabs.provider.desc',
        defaultDescription: 'Connect providers and sign in once.',
        icon: <Cpu className="size-4" />,
        tone: 'bg-muted text-muted-foreground'
      },
      {
        id: 'plugin',
        titleKey: 'redesign.tabs.plugin.title',
        defaultTitle: 'Plugins',
        descriptionKey: 'redesign.tabs.plugin.desc',
        defaultDescription: 'Browser, desktop control, and image generation.',
        icon: <Blocks className="size-4" />,
        tone: 'bg-muted text-muted-foreground'
      },
      {
        id: 'skill',
        titleKey: 'redesign.tabs.skill.title',
        defaultTitle: 'Skills',
        descriptionKey: 'redesign.tabs.skill.desc',
        defaultDescription: 'Reusable local workflows and document helpers.',
        icon: <Sparkles className="size-4" />,
        tone: 'bg-muted text-muted-foreground'
      }
    ]
  },
  {
    id: 'workspace',
    titleKey: 'redesign.groups.workspace.title',
    defaultTitle: 'Workspace',
    descriptionKey: 'redesign.groups.workspace.desc',
    defaultDescription: 'Preferences that shape daily use.',
    tabs: [
      {
        id: 'general',
        titleKey: 'redesign.tabs.general.title',
        defaultTitle: 'Preferences',
        descriptionKey: 'redesign.tabs.general.desc',
        defaultDescription: 'Language, appearance, data, and safety defaults.',
        icon: <SlidersHorizontal className="size-4" />,
        tone: 'bg-muted text-muted-foreground'
      },
      {
        id: 'memory',
        titleKey: 'redesign.tabs.memory.title',
        defaultTitle: 'Memory',
        descriptionKey: 'redesign.tabs.memory.desc',
        defaultDescription: 'Global memory with automation controls.',
        icon: <Brain className="size-4" />,
        tone: 'bg-muted text-muted-foreground'
      }
    ]
  }
]

export function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settingsTab = useUIStore((s) => s.settingsTab)
  const setSettingsTab = useUIStore((s) => s.setSettingsTab)

  const effectiveSettingsTab = settingsTab

  const isFullPanel =
    effectiveSettingsTab === 'provider' ||
    effectiveSettingsTab === 'plugin' ||
    effectiveSettingsTab === 'skill'

  const ActivePanelContent = panelRenderers[effectiveSettingsTab]

  return (
    <div className="flex h-full min-h-0 w-full bg-sidebar gap-1.5 p-1.5">
      {/* Left nav — island sidebar, no divider */}
      <div className="flex w-[180px] shrink-0 flex-col">
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {redesignedSettingsGroups.flatMap((group) => group.tabs).map((item) => {
            const active = effectiveSettingsTab === item.id
            return (
              <button
                key={item.id}
                onClick={() => setSettingsTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  active
                    ? 'border-border bg-background text-foreground shadow-sm'
                    : 'border-transparent text-muted-foreground hover:bg-background/50 hover:text-foreground'
                }`}
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-md ${item.tone}`}
                >
                  {item.icon}
                </span>
                <span className="min-w-0 text-sm font-medium">
                  {t(item.titleKey, { defaultValue: item.defaultTitle })}
                </span>
              </button>
            )
          })}
        </nav>
      </div>

      {/* Right content — island card */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background shadow-sm">
        <AnimatePresence mode="wait">
          {isFullPanel ? (
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-5" key="full-panel">
              <SlideIn
                key={effectiveSettingsTab}
                direction="right"
                duration={0.25}
                className="h-full min-h-0"
              >
                <React.Suspense fallback={<PanelFallback />}>
                  <ActivePanelContent />
                </React.Suspense>
              </SlideIn>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-8 py-8" key="scroll-panel">
              <div
                className="mx-auto max-w-2xl"
              >
                <FadeIn key={effectiveSettingsTab} duration={0.25} className="w-full">
                  <React.Suspense fallback={<PanelFallback />}>
                    <ActivePanelContent />
                  </React.Suspense>
                </FadeIn>
              </div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
