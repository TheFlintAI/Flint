import { useState, useCallback, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function CopyButton({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? t('userMessage.copied') : t('action.copy', { ns: 'common' })}
    </button>
  )
}

export function ActionIconButton({
  label,
  icon,
  onClick,
  danger = false,
  disabled = false
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className={`flex size-7 items-center justify-center rounded-md border border-border/50 bg-background/90 text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50 ${danger ? 'hover:text-destructive' : 'hover:text-accent-foreground'}`}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}
