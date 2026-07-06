import { useEffect, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Loader2,
  Brain,
  ArrowUpDown,
  Check,
  Search,
  Tags,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PanelEmptyState } from '@/components/ui/PanelEmptyState'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { tauriCommands } from '@/services/tauri-api/command-client'
import {
  loadAllMemoryEntries,
  searchMemoryEntries,
  deleteMemoryEntry,
} from '@/lib/agent/memory-files'
import type { MemoryEntry, MemoryEntryType } from '@/protocols/memory-types'
import { MemoryCard } from './MemoryCard'

type SortOrder = 'newest' | 'oldest'

const ALL_TYPES: MemoryEntryType[] = ['preference', 'decision', 'context', 'reference']

const TYPE_COLORS: Record<string, { text: string; bg: string }> = {
  preference: { text: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
  decision: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  context: { text: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/10' },
  reference: { text: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/10' },
}

const SEARCH_DEBOUNCE_MS = 350
const SEARCH_LIMIT = 60

export function MemoryPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')

  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<MemoryEntry[] | null>(null)
  const [typeFilters, setTypeFilters] = useState<Set<MemoryEntryType>>(new Set())
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const all = await loadAllMemoryEntries(tauriCommands)
      setEntries(all)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('memory.loadFailed', { error: message }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    if (!debouncedQuery) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    searchMemoryEntries(tauriCommands, {
      query: debouncedQuery,
      limit: SEARCH_LIMIT,
    })
      .then((results) => {
        if (!cancelled) setSearchResults(results.map((r) => r.entry))
      })
      .catch((error) => {
        if (cancelled) return
        setSearchResults([])
        const message = error instanceof Error ? error.message : String(error)
        toast.error(`${t('memory.searchFailed')}: ${message}`)
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, t])

  const activeByType = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const type of ALL_TYPES) {
      counts[type] = entries.filter((e) => e.type === type).length
    }
    return counts
  }, [entries])

  const processedEntries = useMemo(() => {
    const base = debouncedQuery ? searchResults ?? [] : entries
    const filtered = typeFilters.size > 0
      ? base.filter((e) => typeFilters.has(e.type))
      : base

    return [...filtered].sort((a, b) => {
      const da = new Date(a.updated_at).getTime()
      const db = new Date(b.updated_at).getTime()
      return sortOrder === 'newest' ? db - da : da - db
    })
  }, [entries, searchResults, debouncedQuery, typeFilters, sortOrder])

  const toggleTypeFilter = useCallback((type: MemoryEntryType) => {
    setTypeFilters((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const resetFilters = useCallback(() => {
    setTypeFilters(new Set())
    setQuery('')
  }, [])

  const handleDelete = useCallback(
    async (entryId: string) => {
      try {
        const success = await deleteMemoryEntry(tauriCommands, entryId)
        if (!success) {
          toast.error(t('memory.deleteEntryFailed'))
          return
        }
        await loadData()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        toast.error(t('memory.deleteFailed') + `: ${message}`)
      }
    },
    [loadData, t]
  )

  const hasEntries = entries.length > 0
  const isSearching = debouncedQuery.length > 0
  const showResults = processedEntries.length > 0
  const showNoResults = !loading && hasEntries && !showResults && !searching

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[160px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 pl-8 pr-8 text-xs"
            />
            {isSearching && searching && (
              <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Type multi-select */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-[11px]">
                <Tags className="size-3" />
                {t('memory.typeFilterLabel')}
                {typeFilters.size > 0 && (
                  <span className="rounded bg-muted-foreground/15 px-1 text-[10px] tabular-nums text-muted-foreground">
                    {typeFilters.size}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {ALL_TYPES.map((type) => {
                const colors = TYPE_COLORS[type]
                return (
                  <DropdownMenuCheckboxItem
                    key={type}
                    checked={typeFilters.has(type)}
                    onCheckedChange={() => toggleTypeFilter(type)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className={cn('flex-1', colors.text)}>
                      {t(`memory.types.${type}`, type)}
                    </span>
                    <span className="ml-2 text-[10px] tabular-nums text-muted-foreground">
                      {activeByType[type]}
                    </span>
                  </DropdownMenuCheckboxItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-[11px]">
                <ArrowUpDown className="size-3" />
                {t(`memory.sort.${sortOrder}`, sortOrder)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {(['newest', 'oldest'] as const).map((order) => (
                <DropdownMenuItem key={order} onClick={() => setSortOrder(order)}>
                  <span>{t(`memory.sort.${order}`, order)}</span>
                  {sortOrder === order && <Check className="size-3.5 ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{t('memory.loading')}</span>
        </div>
      )}

      {!loading && !hasEntries && (
        <PanelEmptyState
          icon={<Brain className="size-7 text-muted-foreground" />}
          title={t('memory.emptyTitle', 'No memories yet')}
          className="py-16"
        />
      )}

      {!loading && showResults && (
        <div className="relative columns-2 gap-3">
          <AnimatePresence mode="popLayout">
            {processedEntries.map((entry) => (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="break-inside-avoid mb-3"
              >
                <MemoryCard entry={entry} onDelete={handleDelete} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {!loading && hasEntries && !showResults && searching && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{t('memory.loading')}</span>
        </div>
      )}

      {showNoResults && (
        <>
          <PanelEmptyState
            icon={<Search className="size-7 text-muted-foreground" />}
            title={t('memory.noFilterResults', 'No memories match the current filters')}
            className="py-12"
          />
          <div className="flex justify-center -mt-2 pb-8">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              onClick={resetFilters}
            >
              {t('memory.resetFilters', 'Reset filters')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
