import * as React from 'react'
import { structuredPatch } from 'diff'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'

interface CodeDiffViewerProps {
  beforeText: string
  afterText: string
}

function buildHunks(
  beforeText: string,
  afterText: string,
): string[] {
  const patch = structuredPatch('file', 'file', beforeText, afterText, '', '', {
    context: 3,
  })
  if (patch.hunks.length === 0) return []

  // Build a complete unified diff with ---/+++ headers so the parser can handle it
  const header = `--- a/file\n+++ b/file\n`
  const hunkStrings = patch.hunks.map((hunk) => {
    const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
    return [hunkHeader, ...hunk.lines].join('\n')
  })
  return [header + hunkStrings.join('\n')]
}

export function CodeDiffViewer({
  beforeText,
  afterText,
}: CodeDiffViewerProps): React.JSX.Element | null {
  const hunks = React.useMemo(
    () => buildHunks(beforeText, afterText),
    [beforeText, afterText],
  )

  if (!beforeText && !afterText) return null

  return (
    <div
      className="diff-tailwindcss-wrapper overflow-hidden rounded-md border border-border/40"
      data-theme="dark"
    >
      <div className="max-h-80 overflow-auto">
        <DiffView
          data={{
            oldFile: { content: beforeText },
            newFile: { content: afterText },
            hunks,
          }}
          diffViewMode={DiffModeEnum.Unified}
          diffViewTheme="dark"
          diffViewHighlight
          diffViewWrap
          diffViewFontSize={11}
        />
      </div>
    </div>
  )
}
