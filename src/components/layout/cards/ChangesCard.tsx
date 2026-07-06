import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  FileCode,
  Loader2,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAgentStore } from '@/stores/agent-store'
import { useChatStore } from '@/stores/chat-store'
import { useUIStore } from '@/stores/ui-store'
import { confirm } from '@/components/ui/confirm-dialog'
import type { UnifiedMessage } from '@/lib/api/types'
import {
  type LoadedChangeContent,
  type DiffSummaryStats,
  isLoadedChangeContent,
  loadAggregatedChangeContent,
  useAggregatedChangeSummaries,
} from '@/lib/chat/change-summary-utils'
import {
  actionableSourceChanges,
  aggregateDisplayableFileChanges,
  canRenderInlineSnapshot,
  fileName,
  matchesAggregatedChangeId,
  snapshotText,
  type AggregatedFileChange,
} from '@/lib/chat/file-change-utils'
import { MONO_FONT } from '@/lib/utils/fonts'
import { DiffFallback } from '@/components/ui/lazy-fallback'

const CodeDiffViewer = React.lazy(() =>
  import('@/components/chat/CodeDiffViewer').then(m => ({ default: m.CodeDiffViewer }))
)

const EMPTY_TASK_MESSAGES: UnifiedMessage[] = []

function isErrorResult(value: unknown): value is { error: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    'error' in value &&
    typeof value.error === 'string'
  )
}

function ChangeDetail({
  change,
}: {
  change: AggregatedFileChange
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [loadedContent, setLoadedContent] = React.useState<LoadedChangeContent | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const shouldLoadFullContent =
    change.op === 'create'
      ? !canRenderInlineSnapshot(change.after)
      : !canRenderInlineSnapshot(change.before) ||
        !canRenderInlineSnapshot(change.after)

  React.useEffect(() => {
    if (!shouldLoadFullContent) {
      setLoadedContent(null)
      setLoadError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false
    const load = async (): Promise<void> => {
      setIsLoading(true)
      setLoadError(null)
      try {
        const result = await loadAggregatedChangeContent(change)
        if (cancelled) return

        if (isLoadedChangeContent(result)) {
          setLoadedContent(result)
          return
        }

        setLoadError(
          isErrorResult(result)
            ? result.error
            : t('fileChange.loadDiffFailed', {
                defaultValue: 'Failed to load the full diff',
              }),
        )
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : String(error),
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [change, shouldLoadFullContent, t])

  const beforeText =
    loadedContent?.beforeText ??
    (change.op === 'create' ? '' : snapshotText(change.before))
  const afterText =
    loadedContent?.afterText ??
    (change.op === 'delete' ? '' : snapshotText(change.after))

  if (isLoading && !loadedContent && shouldLoadFullContent) {
    return (
      <div className="flex h-24 items-center justify-center rounded-md bg-muted/20 text-xs text-muted-foreground">
        <Loader2 className="mr-2 size-3.5 animate-spin" />
        {t('thinking.thinkingEllipsis')}
      </div>
    )
  }

  if (loadError && !loadedContent && shouldLoadFullContent) {
    return (
      <div className="rounded-md bg-destructive/5 px-3 py-3 text-xs text-destructive">
        {loadError}
      </div>
    )
  }

  return (
    <React.Suspense fallback={<DiffFallback />}>
      <CodeDiffViewer
        beforeText={beforeText}
        afterText={afterText}
      />
    </React.Suspense>
  )
}

function ChangeRow({
  change,
  summary,
  expanded,
  onToggle,
}: {
  change: AggregatedFileChange
  summary: DiffSummaryStats
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common'])
  const revertFileChange = useAgentStore((state) => state.revertFileChange)
  const [isUndoing, setIsUndoing] = React.useState(false)
  const actionableChanges = React.useMemo(
    () => actionableSourceChanges(change),
    [change],
  )
  const actionable = actionableChanges.length > 0
  const isReverted = change.status === 'reverted'

  const handleUndo = async (): Promise<void> => {
    if (!actionable) return
    setIsUndoing(true)
    try {
      for (const entry of [...actionableChanges].sort(
        (a, b) => b.createdAt - a.createdAt,
      )) {
        await revertFileChange(entry.runId, entry.id)
      }
    } finally {
      setIsUndoing(false)
    }
  }

  const opColor =
    change.op === 'create'
      ? 'bg-emerald-500'
      : change.op === 'delete'
        ? 'bg-destructive'
        : 'bg-amber-500'

  return (
    <div
      className={cn(
        'overflow-hidden transition-colors',
        expanded ? 'bg-muted/30' : 'hover:bg-muted/15',
        isReverted && !expanded && 'opacity-50',
      )}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          className="min-w-0 flex flex-1 items-center gap-2 text-left"
          onClick={onToggle}
          title={change.filePath}
          aria-expanded={expanded}
        >
          <ChevronDown
            className={cn(
              'size-3 shrink-0 text-muted-foreground/40 transition-transform duration-200',
              expanded && 'rotate-180 text-muted-foreground',
            )}
          />
          <span className={cn('size-1.5 shrink-0 rounded-full', opColor)} />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[12px]',
              isReverted
                ? 'text-muted-foreground/50 line-through'
                : 'text-foreground/85',
            )}
            style={{ fontFamily: MONO_FONT }}
          >
            {fileName(change.filePath)}
          </span>
          {isReverted ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/50">
              {t('fileChange.status.reverted')}
            </span>
          ) : (
            <>
              <span className="shrink-0 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                +{summary.added}
              </span>
              <span className="shrink-0 text-[11px] font-medium text-destructive">
                -{summary.deleted}
              </span>
            </>
          )}
        </button>

        {isReverted ? (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/40">
            <Check className="size-2.5" />
          </span>
        ) : actionable ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="size-5 shrink-0 rounded-full text-muted-foreground/60 hover:bg-muted hover:text-foreground"
            onClick={() => void handleUndo()}
            disabled={isUndoing}
            title={t('action.undo', { ns: 'common' })}
            aria-label={t('action.undo', { ns: 'common' })}
          >
            {isUndoing ? (
              <Loader2 className="size-2.5 animate-spin" />
            ) : (
              <Undo2 className="size-2.5" />
            )}
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <div className={cn('px-2 pb-2', isReverted && 'opacity-60')}>
          <ChangeDetail change={change} />
        </div>
      ) : null}
    </div>
  )
}

interface ChangesCardProps {
  initialChangeId?: string | null
}

export function ChangesCard({
  initialChangeId = null,
}: ChangesCardProps): React.JSX.Element | null {
  const { t } = useTranslation(['layout', 'chat', 'common'])
  const activeScopedTaskId = useUIStore((state) => state.activeScopedTaskId)
  const chatActiveTaskId = useChatStore((state) => state.activeTaskId)
  const activeTaskId = activeScopedTaskId ?? chatActiveTaskId
  const taskMessages = useChatStore((state) => {
    if (!activeTaskId) return EMPTY_TASK_MESSAGES
    return (
      state.tasks.find((taskItem) => taskItem.id === activeTaskId)
        ?.messages ?? EMPTY_TASK_MESSAGES
    )
  })
  const changeSets = useAgentStore(
    (state) => state.changeSets,
  )
  const revertChangeSet = useAgentStore((state) => state.revertChangeSet)
  const [selectedChangeId, setSelectedChangeId] = React.useState<
    string | null
  >(null)
  const [isRevertingAll, setIsRevertingAll] = React.useState(false)
  const lastInitialChangeIdRef = React.useRef<string | null>(null)

  const assistantMessageIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const message of taskMessages) {
      if (message.role === 'assistant') ids.add(message.id)
    }
    return ids
  }, [taskMessages])

  const taskChangeSets = React.useMemo(() => {
    const seen = new Set<string>()
    return Object.values(changeSets)
      .filter((changeSet) => {
        if (!activeTaskId) return false
        if (changeSet.taskId === activeTaskId) return true
        if (
          changeSet.changes.some(
            (change) => change.taskId === activeTaskId,
          )
        )
          return true
        return (
          (changeSet.assistantMessageId ? assistantMessageIds.has(changeSet.assistantMessageId) : false) ||
          assistantMessageIds.has(changeSet.runId)
        )
      })
      .filter((changeSet) => {
        if (seen.has(changeSet.runId)) return false
        seen.add(changeSet.runId)
        return true
      })
      .sort((left, right) => left.createdAt - right.createdAt)
  }, [activeTaskId, assistantMessageIds, changeSets])

  const aggregatedChanges = React.useMemo(
    () =>
      aggregateDisplayableFileChanges(
        taskChangeSets.flatMap((changeSet) => changeSet.changes),
      ).sort((left, right) => left.createdAt - right.createdAt),
    [taskChangeSets],
  )
  const summariesByChangeId =
    useAggregatedChangeSummaries(aggregatedChanges)

  // Only include changes that are still open (not reverted)
  const openChanges = React.useMemo(
    () => aggregatedChanges.filter((c) => c.status === 'open'),
    [aggregatedChanges],
  )

  // Count actionable (open) source changes across all aggregated entries
  const actionableCount = React.useMemo(
    () =>
      aggregatedChanges.reduce(
        (acc, change) => acc + actionableSourceChanges(change).length,
        0,
      ),
    [aggregatedChanges],
  )

  // Collect unique run IDs that have open changes (for bulk revert)
  const actionableRunIds = React.useMemo(() => {
    const runIds = new Set<string>()
    for (const changeSet of taskChangeSets) {
      if (changeSet.changes.some((c) => c.status === 'open')) {
        runIds.add(changeSet.runId)
      }
    }
    return [...runIds]
  }, [taskChangeSets])

  const handleRevertAll = React.useCallback(async () => {
    if (actionableRunIds.length === 0) return

    const confirmed = await confirm({
      title: t('fileChange.undoAllConfirmTitle', { ns: 'chat' }),
      description: t('fileChange.undoAllConfirmDesc', {
        ns: 'chat',
        count: actionableCount,
      }),
      confirmLabel: t('fileChange.undoConfirmAction', { ns: 'chat' }),
      variant: 'destructive',
    })
    if (!confirmed) return

    setIsRevertingAll(true)
    try {
      await Promise.all(
        actionableRunIds.map((runId) => revertChangeSet(runId)),
      )
    } finally {
      setIsRevertingAll(false)
    }
  }, [actionableRunIds, actionableCount, revertChangeSet, t])

  React.useEffect(() => {
    const nextInitialChangeId = initialChangeId ?? null
    setSelectedChangeId((current) => {
      const preferredId =
        nextInitialChangeId &&
        (lastInitialChangeIdRef.current !== nextInitialChangeId ||
          !current)
          ? nextInitialChangeId
          : current
      if (!preferredId) return null
      const matched = aggregatedChanges.find((change) =>
        matchesAggregatedChangeId(change, preferredId),
      )
      return matched?.id ?? null
    })
    lastInitialChangeIdRef.current = nextInitialChangeId
  }, [aggregatedChanges, initialChangeId])

  const summary = React.useMemo(
    () =>
      openChanges.reduce(
        (acc, change) => {
          const next = summariesByChangeId[change.id]
          if (!next) return acc
          acc.added += next.added
          acc.deleted += next.deleted
          return acc
        },
        { added: 0, deleted: 0 },
      ),
    [openChanges, summariesByChangeId],
  )

  if (!activeTaskId || openChanges.length === 0) return null

  return (
    <div className="overflow-hidden rounded-lg border border-border/20 bg-card/60">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <FileCode className="size-3.5 shrink-0 text-muted-foreground/60" />
        <span className="text-[12px] font-medium text-foreground/80">
          {t('fileChange.filesChanged', {
            ns: 'chat',
            count: openChanges.length,
          })}
        </span>
        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
          +{summary.added}
        </span>
        <span className="text-[11px] font-semibold text-destructive">
          -{summary.deleted}
        </span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Revert All button */}
        {actionableCount > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 gap-1 rounded-md px-2 text-[11px] text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void handleRevertAll()}
            disabled={isRevertingAll}
          >
            {isRevertingAll ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                {t('fileChange.reverting', { ns: 'chat' })}
              </>
            ) : (
              <>
                <Undo2 className="size-3" />
                {t('fileChange.revertAll', { ns: 'chat' })}
              </>
            )}
          </Button>
        )}
      </div>

      {/* File list */}
      <div className="px-1 pb-1 pt-0.5">
        {aggregatedChanges.map((change) => (
          <ChangeRow
            key={change.id}
            change={change}
            summary={
              summariesByChangeId[change.id] ?? { added: 0, deleted: 0 }
            }
            expanded={change.id === selectedChangeId}
            onToggle={() =>
              setSelectedChangeId((current) =>
                current === change.id ? null : change.id,
              )
            }
          />
        ))}
      </div>
    </div>
  )
}
