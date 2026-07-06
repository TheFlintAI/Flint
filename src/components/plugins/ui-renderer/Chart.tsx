import * as React from 'react'
import {
  PieChart,
  Pie,
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { useTranslation } from 'react-i18next'

interface ChartProps {
  type: 'pie' | 'bar' | 'area' | 'line'
  data: Record<string, unknown>[]
  nameKey?: string
  dataKey?: string
  xKey?: string
  yKey?: string
  colors?: string[]
}

const DEFAULT_COLORS = [
  'hsl(220 70% 50%)',
  'hsl(160 60% 45%)',
  'hsl(30 80% 55%)',
  'hsl(280 65% 60%)',
  'hsl(340 75% 55%)',
]

export function Chart({ type, data, nameKey, dataKey, xKey, yKey, colors }: ChartProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const palette = colors && colors.length > 0 ? colors : DEFAULT_COLORS
  const primary = palette[0]
  const primaryLight = `${primary} / 0.2`

  if (!data || data.length === 0) {
    return <div className="flex h-48 items-center justify-center text-[13px] text-muted-foreground">{t('plugin.chart.noData')}</div>
  }

  const name = nameKey ?? 'name'
  const value = dataKey ?? 'value'
  const x = xKey ?? 'time'
  const y = yKey ?? 'tokens'

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        {type === 'pie' ? (
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              dataKey={value}
              nameKey={name}
              label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={palette[index % palette.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        ) : type === 'bar' ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
            <XAxis dataKey={x} className="text-[11px]" />
            <YAxis className="text-[11px]" />
            <Tooltip />
            <Bar dataKey={y} radius={[4, 4, 0, 0]}>
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={palette[index % palette.length]} />
              ))}
            </Bar>
          </BarChart>
        ) : type === 'area' ? (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
            <XAxis dataKey={x} className="text-[11px]" />
            <YAxis className="text-[11px]" />
            <Tooltip />
            <Area
              type="monotone"
              dataKey={y}
              stroke={primary}
              fill={primaryLight}
            />
          </AreaChart>
        ) : (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
            <XAxis dataKey={x} className="text-[11px]" />
            <YAxis className="text-[11px]" />
            <Tooltip />
            <Line
              type="monotone"
              dataKey={y}
              stroke={primary}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
