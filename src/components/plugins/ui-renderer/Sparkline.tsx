import * as React from 'react'
import { Area, AreaChart } from 'recharts'

const SPARKLINE_WIDTH = 72
const SPARKLINE_HEIGHT = 32

type ColorConvention = 'cn' | 'us'

interface SparklineProps {
  data: number[]
  color?: string
  colorConvention?: ColorConvention
}

const RED = 'hsl(0 72% 51%)'
const GREEN = 'hsl(142 71% 40%)'
const GRAY = 'hsl(220 15% 55%)'

function trendColor(data: number[], conv: ColorConvention = 'us'): string {
  if (data.length < 2) return GRAY
  const up = data[data.length - 1] >= data[0]
  if (conv === 'cn') return up ? RED : GREEN
  return up ? GREEN : RED
}

/**
 * Miniature inline trend chart. Fixed dimensions by design — sparklines are
 * small, consistent visual elements, not responsive containers. A fixed width
 * avoids the Recharts ResponsiveContainer measurement dance inside auto-layout
 * table cells where clientWidth may be 0 during the first layout pass.
 */
export function Sparkline({ data, color, colorConvention }: SparklineProps): React.JSX.Element {
  const uid = React.useId()

  if (!data || data.length === 0) {
    return <span className="text-[11px] text-muted-foreground">—</span>
  }

  const stroke = color ?? trendColor(data, colorConvention)
  const gradientId = `sparkline-${uid}`
  const chartData = data.map((v, i) => ({ i, v }))

  return (
    <div className="inline-block" style={{ width: SPARKLINE_WIDTH, height: SPARKLINE_HEIGHT }}>
      <AreaChart
        width={SPARKLINE_WIDTH}
        height={SPARKLINE_HEIGHT}
        data={chartData}
        margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={stroke}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={false}
        />
      </AreaChart>
    </div>
  )
}
