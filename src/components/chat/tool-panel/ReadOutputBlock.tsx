import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { MONO_FONT } from '@/lib/utils/fonts'
import { LazySyntaxHighlighter } from '../LazySyntaxHighlighter'
import { CopyButton } from './parts'
import { stripReadLineNumbers } from './utils'
import { detectLang } from '@/lib/utils/detect-lang'

export function ReadOutputBlock({
  output,
  filePath
}: {
  output: string
  filePath: string
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [expanded, setExpanded] = React.useState(false)
  const rawContent = stripReadLineNumbers(output)
  const lines = rawContent.split('\n')
  const isLong = lines.length > 40
  const displayed = isLong && !expanded ? lines.slice(0, 40).join('\n') : rawContent
  const lang = detectLang(filePath)
  return (
    <div>
      <div className="relative group/code">
        <div className="absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover/code:opacity-100">
          <CopyButton text={rawContent} />
        </div>
        <LazySyntaxHighlighter
          language={lang}
          showLineNumbers
          customStyle={{
            margin: 0,
            padding: '0.5rem',
            fontSize: '11px',
            maxHeight: '300px',
            overflow: 'auto',
            fontFamily: MONO_FONT
          }}
          codeTagProps={{ style: { fontFamily: 'inherit' } }}
        >
          {displayed}
        </LazySyntaxHighlighter>
      </div>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded
            ? t('toolCall.showFirst40')
            : t('toolCall.showAllLines', { count: lines.length })}
        </button>
      ) : null}
    </div>
  )
}
