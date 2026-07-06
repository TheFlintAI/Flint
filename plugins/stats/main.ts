/// <reference types="@flint/plugin-sdk" />

// ── Statistics Plugin ──────────────────────────────────────────────────
// Collects agent lifecycle events and renders a dashboard in the plugin
// panel using virtual UI components.

interface StatsData {
  totalLoops: number
  totalIterations: number
  totalToolCalls: number
  totalThinkingEvents: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  toolCallCounts: Record<string, number>
  toolCallErrors: Record<string, number>
  tokenTimeline: Array<{ time: string; input: number; output: number }>
  taskStats: Record<string, { iterations: number; toolCalls: number; inputTokens: number; outputTokens: number }>
}

function createEmptyStats(): StatsData {
  return {
    totalLoops: 0,
    totalIterations: 0,
    totalToolCalls: 0,
    totalThinkingEvents: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    toolCallCounts: {},
    toolCallErrors: {},
    tokenTimeline: [],
    taskStats: {}
  }
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

// ── State ───────────────────────────────────────────────────────────────

let stats: StatsData = createEmptyStats()
let updateTimer: ReturnType<typeof setTimeout> | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

// ── Restore persisted stats ─────────────────────────────────────────────

$plugin.store.get<StatsData>('stats').then((saved) => {
  if (saved && typeof saved.totalLoops === 'number') {
    stats = saved
  }
  $plugin.ready()
}).catch(() => {
  $plugin.ready()
})

// ── Hook into agent events ──────────────────────────────────────────────

$plugin.hook.on('*', (event) => {
  switch (event.type) {
    case 'loop:start':
      stats.totalLoops++
      break

    case 'loop:end':
      break

    case 'iteration:start':
      stats.totalIterations++
      if (event.taskId) {
        stats.taskStats[event.taskId] ??= { iterations: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 }
        stats.taskStats[event.taskId].iterations++
      }
      break

    case 'thinking:delta':
      stats.totalThinkingEvents++
      break

    case 'tool:start':
      stats.totalToolCalls++
      stats.toolCallCounts[event.toolName] = (stats.toolCallCounts[event.toolName] || 0) + 1
      if (event.taskId) {
        stats.taskStats[event.taskId] ??= { iterations: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 }
        stats.taskStats[event.taskId].toolCalls++
      }
      break

    case 'tool:complete':
      if (event.isError) {
        stats.toolCallErrors[event.toolName] = (stats.toolCallErrors[event.toolName] || 0) + 1
      }
      break

    case 'token:usage':
      stats.totalInputTokens += event.inputTokens
      stats.totalOutputTokens += event.outputTokens
      stats.totalCacheReadTokens += event.cacheReadTokens
      stats.totalCacheWriteTokens += event.cacheWriteTokens

      if (event.taskId) {
        stats.taskStats[event.taskId] ??= { iterations: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 }
        stats.taskStats[event.taskId].inputTokens += event.inputTokens
        stats.taskStats[event.taskId].outputTokens += event.outputTokens
      }

      // Token timeline
      {
        const now = new Date()
        const time = now.getHours().toString().padStart(2, '0') + ':' +
          now.getMinutes().toString().padStart(2, '0') + ':' +
          now.getSeconds().toString().padStart(2, '0')
        stats.tokenTimeline.push({ time, input: event.inputTokens, output: event.outputTokens })
        if (stats.tokenTimeline.length > 200) {
          stats.tokenTimeline.shift()
        }
      }
      break
  }

  schedulePersist()
  scheduleTabUpdate()
})

// ── Throttled UI refresh ────────────────────────────────────────────────

function scheduleTabUpdate() {
  if (updateTimer) return
  updateTimer = setTimeout(() => {
    updateTimer = null
    $plugin.ui.refresh('dashboard')
  }, 500)
}

function schedulePersist() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    $plugin.store.set('stats', stats)
  }, 5000)
}

// ── Register UI Tab ────────────────────────────────────────────────────

$plugin.ui.tab('dashboard', { en: 'Statistics', zh: '统计' }, 'BarChart3', () => {
  const totalTokens = stats.totalInputTokens + stats.totalOutputTokens

  const toolDist = Object.entries(stats.toolCallCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const taskRows = Object.entries(stats.taskStats)
    .map(([taskId, s]) => ({
      task: taskId.slice(0, 8),
      iterations: s.iterations.toString(),
      toolCalls: s.toolCalls.toString(),
      tokens: formatNum(s.inputTokens + s.outputTokens),
    }))
    .slice(0, 20)

  return $plugin.ui.col([
    $plugin.ui.heading({ en: 'Overview', zh: '概览' }),
    $plugin.ui.grid({ cols: 4 }, [
      $plugin.ui.card({ label: { en: 'Tool Calls', zh: '工具调用' }, value: String(stats.totalToolCalls), icon: 'Wrench', variant: 'neutral' }),
      $plugin.ui.card({ label: { en: 'Thinking', zh: '思考' }, value: String(stats.totalThinkingEvents), icon: 'Brain', variant: 'neutral' }),
      $plugin.ui.card({ label: { en: 'Tokens', zh: '令牌' }, value: formatNum(totalTokens), icon: 'Zap', variant: 'neutral' }),
      $plugin.ui.card({ label: { en: 'Sessions', zh: '会话' }, value: String(stats.totalLoops), icon: 'MessageSquare', variant: 'neutral' }),
    ]),

    $plugin.ui.heading({ en: 'Token Trend', zh: '令牌趋势' }),
    $plugin.ui.area({
      data: stats.tokenTimeline.slice(-50),
      xKey: 'time',
      yKey: 'input',
    }),

    $plugin.ui.heading({ en: 'Tool Distribution', zh: '工具分布' }),
    toolDist.length > 0
      ? $plugin.ui.grid({ cols: 2 }, [
          $plugin.ui.pie({ data: toolDist, nameKey: 'name', dataKey: 'count' }),
          $plugin.ui.table({
            columns: [
              { key: 'name', label: { en: 'Tool', zh: '工具' } },
              { key: 'count', label: { en: 'Count', zh: '数量' } },
            ],
            rows: toolDist.map((d) => ({ name: d.name, count: String(d.count) })),
          }),
        ])
      : $plugin.ui.text({ en: 'No tool calls recorded yet.', zh: '暂无工具调用记录。' }),

    $plugin.ui.heading({ en: 'Per Task', zh: '按任务' }),
    taskRows.length > 0
      ? $plugin.ui.table({
          columns: [
            { key: 'task', label: { en: 'Task', zh: '任务' } },
            { key: 'iterations', label: { en: 'Iterations', zh: '迭代' } },
            { key: 'toolCalls', label: { en: 'Tools', zh: '工具' } },
            { key: 'tokens', label: { en: 'Tokens', zh: '令牌' } },
          ],
          rows: taskRows,
        })
      : $plugin.ui.text({ en: 'No task data yet.', zh: '暂无任务数据。' }),
  ])
})
