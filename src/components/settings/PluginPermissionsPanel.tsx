import { Folder, Globe, Terminal, Clipboard, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PluginPermission } from '@/lib/plugin/permissions'

type SettingsT = (key: string, options?: { defaultValue?: string }) => string

interface PermCardDef {
  perm: PluginPermission
  i18nKey: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
}

const PERM_CARDS: PermCardDef[] = [
  {
    perm: 'shell', i18nKey: 'plugin.shell', label: 'Shell',
    icon: Terminal, iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  {
    perm: 'fs:read', i18nKey: 'plugin.fsRead', label: 'Read files',
    icon: Folder, iconBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    perm: 'fs:write', i18nKey: 'plugin.fsWrite', label: 'Write files',
    icon: Folder, iconBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    perm: 'network', i18nKey: 'plugin.network', label: 'Network',
    icon: Globe, iconBg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  {
    perm: 'clipboard:read', i18nKey: 'plugin.clipboardRead', label: 'Read clipboard',
    icon: Clipboard, iconBg: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  },
  {
    perm: 'clipboard:write', i18nKey: 'plugin.clipboardWrite', label: 'Write clipboard',
    icon: Clipboard, iconBg: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  },
]

function resolveGranted(permissions: PluginPermission[]): Set<PluginPermission> {
  const set = new Set(permissions)
  if (set.has('fs')) {
    set.add('fs:read')
    set.add('fs:write')
  }
  if (set.has('clipboard')) {
    set.add('clipboard:read')
    set.add('clipboard:write')
  }
  return set
}

interface PluginPermissionsPanelProps {
  permissions: string[] | undefined
  t: SettingsT
}

export function PluginPermissionsPanel({
  permissions,
  t,
}: PluginPermissionsPanelProps): React.JSX.Element {
  const granted = resolveGranted((permissions ?? []) as PluginPermission[])

  return (
    <div className="rounded-xl border bg-card/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-medium">
          {t('plugin.permissions', { defaultValue: 'Permissions' })}
        </span>
      </div>

      <div className="columns-2 gap-2 space-y-2">
        {PERM_CARDS.map((card) => {
          const has = granted.has(card.perm)
          return (
            <div
              key={card.perm}
              className={cn(
                'break-inside-avoid rounded-lg border h-9 flex items-center gap-2 px-3',
                has
                  ? 'border-border/40 bg-muted/30'
                  : 'border-border/30 bg-muted/20'
              )}
            >
              <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-md', card.iconBg)}>
                <card.icon className="size-3" />
              </span>
              <span className="text-[12px] font-medium">
                {t(card.i18nKey, { defaultValue: card.label })}
              </span>
              <span className="flex-1" />

              {has ? (
                <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  {t('plugin.inUse', { defaultValue: 'In use' })}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  {t('plugin.unused', { defaultValue: 'Unused' })}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
