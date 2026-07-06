import * as React from 'react'
import { FileCode2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { parseSelectFileText } from '@/lib/chat/select-file-tags'

interface SelectFileInlineTextProps {
  text: string
  className?: string
  overlay?: boolean
}

export function SelectFileInlineText({
  text,
  className,
  overlay = false
}: SelectFileInlineTextProps): React.JSX.Element {
  const segments = React.useMemo(() => parseSelectFileText(text), [text])

  return (
    <span className={cn('whitespace-pre-wrap break-words', className)}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <React.Fragment key={`${segment.raw}-${index}`}>{segment.text}</React.Fragment>
        }

        if (overlay) {
          return (
            <span key={`${segment.raw}-${index}`} className="relative inline-block align-baseline">
              <span className="invisible">{segment.raw}</span>
              <Badge
                variant="default"
                className="absolute inset-0 inline-flex max-w-full items-center justify-start gap-1 overflow-hidden rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-0 text-[12px] font-medium text-blue-700 dark:text-blue-300"
              >
                <FileCode2 className="size-3 shrink-0" />
                <span className="truncate">{segment.text}</span>
              </Badge>
            </span>
          )
        }

        return (
          <Badge
            key={`${segment.raw}-${index}`}
            variant="default"
            className="mx-0.5 inline-flex max-w-full items-center gap-1 overflow-hidden rounded-md border border-blue-500/20 bg-blue-500/10 align-baseline text-[12px] font-medium text-blue-700 dark:text-blue-300"
          >
            <FileCode2 className="size-3 shrink-0" />
            <span className="truncate">{segment.text}</span>
          </Badge>
        )
      })}
    </span>
  )
}
