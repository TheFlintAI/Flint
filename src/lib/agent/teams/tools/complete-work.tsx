import * as React from 'react'
import { encodeStructuredToolResult, encodeToolError } from '@/lib/tools/tool-result-format'
import type { ToolHandler } from '@/lib/tools/tool-types'
import type { ToolPanelContext } from '@/lib/tools/tool-render-types'
import { ToolPanelLead, ToolIcon } from '@/components/chat/tool-panel/parts'
import { firstStringInput } from '@/components/chat/tool-panel/utils'
import { CompleteWorkInputBlock } from '@/components/chat/tool-panel/EditPreviewBlock'

export const COMPLETE_WORK_TOOL_NAME = 'CompleteWork'

/**
 * The worker completion signal. A sub-agent calls this exactly once when its
 * task is done; the runner captures the `report` argument and terminates the
 * loop. The tool itself only validates and acknowledges — termination is
 * driven by the runner observing this tool result (see teammate-runner).
 */
export const completeWorkTool: ToolHandler = {
  definition: {
    name: COMPLETE_WORK_TOOL_NAME,
    description:
      'Submit your final work report and end this sub-agent session. This is the ONLY reliable completion signal — trailing assistant text is not treated as completion. Call exactly once when the task is done (or definitively blocked). Structure the report with: ## Conclusion / ## Key Findings / ## Evidence / ## Risks & Unknowns / ## Next Steps.',
    inputSchema: {
      type: 'object',
      properties: {
        report: {
          type: 'string',
          description:
            'The full work report. Must be non-empty. Use the structured headings (## Conclusion / ## Key Findings / ## Evidence / ## Risks & Unknowns / ## Next Steps).'
        },
        summary: {
          type: 'string',
          description: 'One-line summary of the outcome (shown in team status).'
        }
      },
      required: ['report']
    }
  },

  execute: async (input, ctx) => {
    const report = typeof input.report === 'string' ? input.report.trim() : ''
    if (!report) {
      return encodeToolError('`report` must be a non-empty string.')
    }
    // Stash on the shared state bag so the runner can read the full, untruncated
    // report (event payloads are sanitized and may truncate large inputs).
    if (ctx.sharedState) {
      ctx.sharedState.completeWork = report
    }
    const summary = typeof input.summary === 'string' ? input.summary.trim() : undefined
    return encodeStructuredToolResult({
      success: true,
      accepted: true,
      ...(summary ? { summary } : {})
    })
  },

  groups: ['worker-completion'],
  render: {
    kind: 'native-panel',
    renderHeader: completeWorkHeader,
    renderBody: completeWorkBody
  }
}

// ── CompleteWork render ──

function completeWorkHeader(ctx: ToolPanelContext): React.ReactNode {
  const summary =
    firstStringInput(ctx.input, ['summary']) ||
    firstStringInput(ctx.input, ['report'])?.split('\n')[0] ||
    ctx.displayName
  return (
    <ToolPanelLead
      icon={<ToolIcon name="CompleteWork" />}
      title={summary}
      titleAttr={summary}
    />
  )
}

function completeWorkBody(ctx: ToolPanelContext): React.ReactNode {
  return <CompleteWorkInputBlock input={ctx.input} status={ctx.status} />
}
