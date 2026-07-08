/**
 * Chart component adapters — pie-chart, bar-chart, area-chart, line-chart.
 */

import type { VNode } from '@/lib/plugin/vnode-types'
import { Chart } from '../Chart'
import { registerAdapter, type AdapterContext } from './adapter-registry'

registerAdapter('pie-chart', {
  render(node: VNode, _ctx: AdapterContext) {
    const { data, nameKey, dataKey, colors } = node.props as {
      data: Record<string, unknown>[]; nameKey: string; dataKey: string; colors?: string[]
    }
    return <Chart type="pie" data={data} nameKey={nameKey} dataKey={dataKey} colors={colors} />
  },
})

registerAdapter('bar-chart', {
  render(node: VNode, _ctx: AdapterContext) {
    const { data, xKey, yKey, colors } = node.props as {
      data: Record<string, unknown>[]; xKey: string; yKey: string; colors?: string[]
    }
    return <Chart type="bar" data={data} xKey={xKey} yKey={yKey} colors={colors} />
  },
})

registerAdapter('area-chart', {
  render(node: VNode, _ctx: AdapterContext) {
    const { data, xKey, yKey, colors } = node.props as {
      data: Record<string, unknown>[]; xKey: string; yKey: string; colors?: string[]
    }
    return <Chart type="area" data={data} xKey={xKey} yKey={yKey} colors={colors} />
  },
})

registerAdapter('line-chart', {
  render(node: VNode, _ctx: AdapterContext) {
    const { data, xKey, yKey, colors } = node.props as {
      data: Record<string, unknown>[]; xKey: string; yKey: string; colors?: string[]
    }
    return <Chart type="line" data={data} xKey={xKey} yKey={yKey} colors={colors} />
  },
})
