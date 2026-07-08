/// <reference types="@flint/plugin-sdk" />

// ── Stock Plugin ──────────────────────────────────────────────────────────
// Data sources:
//   A-shares quotes   → Sina Finance   (hq.sinajs.cn, GBK)
//   A-shares history  → Tencent Finance (web.ifzq.gtimg.cn)
//   A-shares search   → Tencent Finance (smartbox.gtimg.cn)
//   US stocks         → Yahoo Finance  (query1.finance.yahoo.com)

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type Market = 'cn' | 'us'

interface Quote {
  symbol: string; name: string; price: number; change: number; changePercent: number
  high: number; low: number; open: number; prevClose: number; volume: number
  turnover?: number; currency: string; market: Market; trend?: number[]
}

interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number }

interface Entry { symbol: string; name: string; market: Market }

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const CAP = 8
const TREND = 20
const POLL = 30_000

const RANGE: Record<string, number> = { '1mo': 22, '3mo': 66, '6mo': 132, '1y': 252, '2y': 504, '5y': 1260 }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const SINA  = { headers: { 'Referer': 'https://finance.sina.com.cn' }, responseEncoding: 'gbk' }
const YAHOO = { headers: { 'User-Agent': UA } }

const INDICES = [
  { name: { en: 'SSE Composite', zh: '上证指数' }, code: 'sh000001', market: 'cn' as const },
  { name: { en: 'SZSE Component', zh: '深证成指' }, code: 'sz399001', market: 'cn' as const },
  { name: { en: 'CSI 300', zh: '沪深300' }, code: 'sh000300', market: 'cn' as const },
  { name: { en: 'ChiNext', zh: '创业板指' }, code: 'sz399006', market: 'cn' as const },
  { name: { en: 'STAR 50', zh: '科创50' },  code: 'sh000688', market: 'cn' as const },
  { name: { en: 'DJIA', zh: '道琼斯' },  code: '^DJI',     market: 'us' as const },
  { name: { en: 'S&P 500', zh: '标普500' }, code: '^GSPC',    market: 'us' as const },
  { name: { en: 'NASDAQ', zh: '纳斯达克' }, code: '^IXIC',    market: 'us' as const },
]

// ═══════════════════════════════════════════════════════════════════════════
// Reactive state
// ═══════════════════════════════════════════════════════════════════════════

const $s = $plugin.state.define({
  cn: false,
  us: false,
  entries: [] as Entry[],
  results: [] as { key: string; title: string; subtitle?: string; badge?: string; badgeVariant?: string; disabled?: boolean; disabledReason?: string }[],
  loading: false,
})

function visible(): Market | 'both' | 'none' {
  const cn = $s.get('cn'), us = $s.get('us')
  return cn && us ? 'both' : cn ? 'cn' : us ? 'us' : 'none'
}

const SAVE_KEYS: ('cn' | 'us' | 'entries')[] = ['cn', 'us', 'entries']

// ── Derived snapshot (not reactive — computed by refresh) ─────────────────

let snap: { indices: Quote[]; watchlist: Quote[] } = { indices: [], watchlist: [] }

// ═══════════════════════════════════════════════════════════════════════════
// Local formatting (locale-specific, not in SDK)
// ═══════════════════════════════════════════════════════════════════════════

function fmtV(n: number): string {
  if (!isFinite(n)) return '—'
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T'
  if (n >= 1e8)  return (n / 1e8).toFixed(2)  + '亿'
  if (n >= 1e6)  return (n / 1e6).toFixed(2)  + 'M'
  if (n >= 1e3)  return (n / 1e3).toFixed(2)  + 'K'
  return String(n)
}

/** Arrow indicator — "↑" for up, "↓" for down. */
function arrow(n: number) { return n >= 0 ? '↑' : '↓' }

function classify(raw: string): { market: Market; code: string } {
  const sym = raw.trim().toUpperCase()
  if (/^(SH|SZ)?\d{6}$/.test(sym)) return { market: 'cn', code: sym.startsWith('SH') || sym.startsWith('SZ') ? sym.toLowerCase() : sym }
  if (/^[A-Z]{1,5}$/.test(sym) || sym.startsWith('^')) return { market: 'us', code: sym }
  return { market: 'us', code: sym }
}

// ═══════════════════════════════════════════════════════════════════════════
// Sina Finance — A-share quotes
// ═══════════════════════════════════════════════════════════════════════════

function sinaUrl(codes: string[]) {
  return 'https://hq.sinajs.cn/list=' + codes.map(c => c.startsWith('sh') || c.startsWith('sz') ? c : c.startsWith('6') ? `sh${c}` : `sz${c}`).join(',')
}

function parseSina(code: string, raw: string): Quote | null {
  const m = raw.match(/"([^"]*)"/); if (!m) return null
  const f = m[1].split(','); if (f.length < 10) return null
  const price = +f[3] || 0, prev = +f[2] || 0, chg = price - prev
  return { symbol: code, name: f[0], price, change: chg, changePercent: prev ? (chg / prev) * 100 : 0, high: +f[4] || 0, low: +f[5] || 0, open: +f[1] || 0, prevClose: prev, volume: +f[8] || 0, turnover: +f[9] || undefined, currency: 'CNY', market: 'cn' }
}

async function cnQuote(code: string): Promise<Quote | null> {
  if (!code) return null
  try { const r = await $plugin.fetch(sinaUrl([code]), SINA); return parseSina(code, await r.text()) } catch { return null }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tencent — A-share history + search
// ═══════════════════════════════════════════════════════════════════════════

function kurl(code: string, n: number) {
  const sc = code.startsWith('sh') || code.startsWith('sz') ? code : code.startsWith('6') ? `sh${code}` : `sz${code}`
  return `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sc},day,,,${n},qfq`
}

async function cnHistory(code: string, n: number): Promise<Bar[]> {
  try {
    const r = await $plugin.fetch(kurl(code, n))
    const b = await r.json<{ data?: Record<string, { qfqday?: string[][] }> }>()
    const sc = code.startsWith('sh') || code.startsWith('sz') ? code : code.startsWith('6') ? `sh${code}` : `sz${code}`
    const days = b?.data?.[sc]?.qfqday; if (!days) return []
    return days.map(row => ({ date: row[0] || '', open: +row[1] || 0, close: +row[2] || 0, high: +row[3] || 0, low: +row[4] || 0, volume: +row[5] || 0 }))
  } catch { return [] }
}

async function cnSearch(q: string): Promise<Entry[]> {
  try {
    const r = await $plugin.fetch(`https://smartbox.gtimg.cn/s3/?t=all&q=${encodeURIComponent(q)}`)
    const t = $plugin.text.decode(await r.text())
    const m = t.match(/"([^"]*)"/); if (!m) return []
    return m[1].split(';').filter(Boolean).slice(0, 10).map(x => { const p = x.split('~'); return { symbol: p[1] || '', name: p[2] || p[1] || '', market: 'cn' as const } })
  } catch { return [] }
}

// ═══════════════════════════════════════════════════════════════════════════
// Yahoo Finance — US stocks
// ═══════════════════════════════════════════════════════════════════════════

function yurl(sym: string, range: string) { return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}` }

async function usQuote(sym: string): Promise<Quote | null> {
  try {
    const r = await $plugin.fetch(yurl(sym, '1d'), YAHOO)
    const b = await r.json<{ chart?: { result?: Array<{ meta: Record<string, unknown> }> } }>()
    const m = b?.chart?.result?.[0]?.meta; if (!m) return null
    const price = +((m.regularMarketPrice as number) ?? 0), prev = +((m.previousClose ?? m.chartPreviousClose ?? 0) as number)
    return { symbol: sym.toUpperCase(), name: String(m.symbol ?? sym), price, change: price - prev, changePercent: prev ? ((price - prev) / prev) * 100 : 0, high: +((m.regularMarketDayHigh as number) ?? 0), low: +((m.regularMarketDayLow as number) ?? 0), open: +((m.regularMarketOpen as number) ?? 0), prevClose: prev, volume: +((m.regularMarketVolume as number) ?? 0), currency: String(m.currency ?? 'USD'), market: 'us' }
  } catch { return null }
}

async function usHistory(sym: string, range: string): Promise<Bar[]> {
  try {
    const r = await $plugin.fetch(yurl(sym, range), YAHOO)
    const b = await r.json<{ chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<Record<string, number[] | undefined>> } }> } }>()
    const d = b?.chart?.result?.[0]; if (!d?.timestamp || !d?.indicators?.quote?.[0]) return []
    const ts = d.timestamp, q = d.indicators.quote[0]
    return ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), open: +((q.open as number[])?.[i] ?? 0), high: +((q.high as number[])?.[i] ?? 0), low: +((q.low as number[])?.[i] ?? 0), close: +((q.close as number[])?.[i] ?? 0), volume: +((q.volume as number[])?.[i] ?? 0) }))
  } catch { return [] }
}

async function usSearch(q: string): Promise<Entry[]> {
  try {
    const r = await $plugin.fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`, YAHOO)
    const b = await r.json<{ quotes?: Array<{ symbol: string; shortname?: string; longname?: string }> }>()
    return (b?.quotes ?? []).map(x => ({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol, market: 'us' as const }))
  } catch { return [] }
}

// ═══════════════════════════════════════════════════════════════════════════
// Dispatch
// ═══════════════════════════════════════════════════════════════════════════

async function quote(sym: string): Promise<Quote | null> {
  const c = classify(sym); return c.market === 'cn' ? cnQuote(c.code) : usQuote(c.code)
}

async function quoteRaw(code: string, mkt: Market) { return mkt === 'cn' ? cnQuote(code) : usQuote(code) }

async function history(sym: string, range: string): Promise<Bar[]> {
  const c = classify(sym); return c.market === 'cn' ? cnHistory(c.code, RANGE[range] || 60) : usHistory(c.code, range)
}

async function searchAll(q: string): Promise<Entry[]> {
  const v = visible()
  if (v === 'none') return []
  const [cn, us] = await Promise.all([v !== 'us' ? cnSearch(q) : [], v !== 'cn' ? usSearch(q) : []])
  return [...cn, ...us].slice(0, 15)
}

async function trend(sym: string): Promise<number[]> {
  try { const bars = await history(sym, '1mo'); return bars.slice(-TREND).map(b => b.close) } catch { return [] }
}

/** Fetch market indices. Pass a market to override; defaults to visible(). */
async function indices(market?: Market | 'both'): Promise<Quote[]> {
  const v = market ?? visible()
  if (v === 'none') return []
  const r = await Promise.all(INDICES.filter(x => v === 'both' || v === x.market).map(async x => { try { const q = await quoteRaw(x.code, x.market); return q ? { ...q, name: x.name } : null } catch { return null } }))
  return r.filter((q): q is Quote => q !== null)
}

// ═══════════════════════════════════════════════════════════════════════════
// Data refresh
// ═══════════════════════════════════════════════════════════════════════════

async function refresh(): Promise<void> {
  try {
    const syms = $s.get('entries').map(e => e.symbol)
    const [ix, wl] = await Promise.all([indices(), Promise.all(syms.map(quote)).then(r => r.filter((q): q is Quote => q !== null))])
    const all = [...ix, ...wl]
    const trends = await Promise.all(all.map(async it => ({ sym: it.symbol, t: await trend(it.symbol).catch(() => []) })))
    const map = new Map(trends.map(x => [x.sym, x.t])); for (const it of all) it.trend = map.get(it.symbol) ?? []
    snap = { indices: ix, watchlist: wl }
  } catch { /* unreachable */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// UI — Market tab
// ═══════════════════════════════════════════════════════════════════════════

function renderMarket(): VNode {
  const v = visible()
  if (v === 'none') {
    return $plugin.ui.col([
      $plugin.ui.heading({ en: 'Market', zh: '行情看板' }),
      $plugin.ui.text({ en: 'Select a market in Settings to get started.', zh: '请先在设置中选择市场' }),
      $plugin.ui.button({
        id: 'go-settings',
        label: { en: 'Open Settings', zh: '前往设置' },
        variant: 'primary',
        action: 'navigate-tab:settings',
      }),
    ])
  }

  const { indices: ix, watchlist: wl } = snap
  const el: VNode[] = []

  if (ix.length) el.push($plugin.ui.grid({ cols: Math.min(ix.length, 4) }, ix.map(q => $plugin.ui.card({
    label: q.name, icon: q.change >= 0 ? 'TrendingUp' : 'TrendingDown', variant: q.change >= 0 ? 'success' : 'destructive',
    value: `${$plugin.fmt.number(q.price)} ${arrow(q.change)} ${$plugin.fmt.percent(q.changePercent)}`,
    description: $plugin.fmt.change(q.change), trend: q.trend,
  }))))

  if (wl.length) el.push($plugin.ui.table({
    columns: [
      { key: 'sym', label: { en: 'Sym', zh: '代码' } }, { key: 'name', label: { en: 'Name', zh: '名称' } },
      { key: 'price', label: { en: 'Price', zh: '价格' } }, { key: 'chg', label: { en: 'Chg', zh: '涨跌' }, renderer: 'change' },
      { key: 'pct', label: { en: '%', zh: '涨幅' }, renderer: 'change' }, { key: 'trend', label: { en: 'Trend', zh: '趋势' }, renderer: 'sparkline' },
    ],
    rows: wl.map(q => ({ sym: q.symbol, name: q.name, price: $plugin.fmt.number(q.price), chg: $plugin.fmt.change(q.change), pct: $plugin.fmt.percent(q.changePercent), trend: q.trend ?? [], _variant: q.change >= 0 ? 'success' : 'destructive' })),
  }))

  if (!el.length) el.push($plugin.ui.text({ en: 'No data.', zh: '暂无数据' }))
  return $plugin.ui.col(el)
}

// ═══════════════════════════════════════════════════════════════════════════
// UI — Settings tab
// ═══════════════════════════════════════════════════════════════════════════

function renderSettings(): VNode {
  return $plugin.ui.col([
    $plugin.ui.toggleGroup({
      id: 'market',
      label: { en: 'Markets', zh: '市场' },
      value: [$s.get('cn') ? 'cn' : '', $s.get('us') ? 'us' : ''].filter(Boolean),
      options: [
        { value: 'cn', label: { en: 'A-Shares', zh: 'A股' } },
        { value: 'us', label: { en: 'US Stocks', zh: '美股' } },
      ],
    }),
    $plugin.ui.tagList({
      id: 'wl', label: { en: 'Watchlist', zh: '自选' },
      tags: $s.get('entries').map(e => ({ key: e.symbol, label: e.symbol, description: e.name !== e.symbol ? e.name : undefined, badge: e.market === 'cn' ? { en: 'A-Shares', zh: 'A股' } : { en: 'US', zh: '美股' }, badgeVariant: (e.market === 'cn' ? 'info' : 'success') as any })),
      max: CAP, emptyText: { en: 'Search to add stocks', zh: '搜索添加自选' },
      addPanel: $plugin.ui.searchInput({
        id: 'wl-search',
        placeholder: { en: 'Search symbol or name…', zh: '搜索代码或名称…' },
        searchAction: 'search', minQueryLength: 2, debounceMs: 300,
        results: $s.get('results') as any, resultsLoading: $s.get('loading'),
        emptyText: { en: 'No results', zh: '无结果' },
      }),
    }),
  ])
}

$plugin.view.register('market',  { en: 'Market', zh: '行情' }, 'TrendingUp', renderMarket)
$plugin.view.register('settings', { en: 'Settings', zh: '设置' }, 'Settings', renderSettings)

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

async function resolve(sym: string): Promise<Entry> {
  const c = classify(sym)
  try { const q = await quote(sym); return { symbol: sym, name: q?.name ?? sym, market: q?.market ?? c.market } } catch { return { symbol: sym, name: sym, market: c.market } }
}

function syncDisabled() {
  const set = new Set($s.get('entries').map(e => e.symbol.toUpperCase()))
  for (const r of $s.get('results')) { r.disabled = set.has(r.key.toUpperCase()); if (r.disabled) r.disabledReason = 'Already in watchlist' }
}

// ═══════════════════════════════════════════════════════════════════════════
// Lifecycle — actions, activation, polling
// ═══════════════════════════════════════════════════════════════════════════

$plugin.ui.onAction({
  market: {
    change: async ({ values }) => {
      const selected = (values.value as string[]) ?? []
      const nextCn = selected.includes('cn')
      const nextUs = selected.includes('us')
      const changedCn = nextCn !== $s.get('cn')
      const changedUs = nextUs !== $s.get('us')
      if (!changedCn && !changedUs) return

      if (changedCn) $s.set('cn', nextCn)
      if (changedUs) $s.set('us', nextUs)
      $s.flush('settings')
      await $s.save(SAVE_KEYS)
      await refresh()
      $s.flush()
    },
  },

  'wl-search': {
    search: async ({ values }) => {
      const q = String(values.query ?? '').trim()
      if (q.length < 2) { $s.patch({ results: [], loading: false }); $s.flush('settings'); return }
      $s.set('loading', true); $s.flush('settings')
      const raw = await searchAll(q)
      $s.set('results', raw.map(r => ({ key: r.symbol, title: r.symbol, subtitle: r.name, badge: r.market === 'cn' ? { en: 'A-Shares', zh: 'A股' } : { en: 'US', zh: '美股' }, badgeVariant: r.market === 'cn' ? 'info' : 'success' })))
      syncDisabled(); $s.set('loading', false); $s.flush('settings')
    },
    'select-result': async ({ values }) => {
      const key = String(values.key ?? '').trim(); if (!key) return
      const es = $s.get('entries')
      if (es.some(e => e.symbol.toUpperCase() === key.toUpperCase()) || es.length >= CAP) return
      // Immediate: add entry locally and flush settings tab only
      $s.set('entries', [...es, { symbol: key, name: key, market: classify(key).market }])
      $s.set('results', [])
      syncDisabled()
      $s.flush('settings')
      // Background: resolve name, persist, then fetch full market data
      void (async () => {
        const resolved = await resolve(key)
        const current = $s.get('entries')
        $s.set('entries', current.map(e => e.symbol.toUpperCase() === key.toUpperCase() ? resolved : e))
        await $s.save(SAVE_KEYS)
        await refresh()
        $s.flush()
      })()
    },
  },

  wl: {
    'remove-tag': async ({ values }) => {
      $s.set('entries', $s.get('entries').filter(e => e.symbol !== String(values.tagKey ?? '')))
      syncDisabled()
      $s.flush('settings')
      // Background: persist and refresh market data
      void (async () => { await $s.save(SAVE_KEYS); await refresh(); $s.flush() })()
    },
    reorder: async ({ values }) => {
      const ord = values.orderedKeys as string[] | undefined
      if (!ord || !Array.isArray(ord)) return
      const map = new Map($s.get('entries').map(e => [e.symbol, e]))
      $s.set('entries', ord.map(k => map.get(k)!).filter(Boolean))
      await $s.save(SAVE_KEYS); $s.flush('settings')
    },
  },
})

$plugin.lifecycle.onActivate(async () => {
  await $s.load()
  await refresh()
  $s.flush()
})

// Managed timer — auto-cleaned on deactivate
$plugin.timer.interval(POLL, refresh)

$plugin.ready()
