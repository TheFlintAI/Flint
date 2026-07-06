import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSkillsStore } from '@/stores/skills-store'
import type { SkillInfo } from '@/lib/resources/resource-manager'
import { Switch } from '@/components/ui/switch'

interface SkillCardProps extends Pick<SkillInfo, 'name' | 'description' | 'enabled'> {
  editMode: boolean
  selected: boolean
  onToggleSelect: () => void
}

export function SkillCard({
  name,
  description,
  enabled,
  editMode,
  selected,
  onToggleSelect
}: SkillCardProps): React.JSX.Element {
  const toggleSkill = useSkillsStore((s) => s.toggleSkill)
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={cn(
        'rounded-lg border transition-all',
        'bg-card hover:border-border/80',
        !enabled && 'opacity-55 grayscale-[20%]',
        selected && 'border-foreground/15 bg-accent/50 ring-1 ring-border'
      )}
    >
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        {editMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect()
            }}
            className={cn(
              'shrink-0 size-5 rounded-sm border-2 flex items-center justify-center transition-colors',
              selected
                ? 'bg-primary border-primary text-primary-foreground'
                : 'border-muted-foreground/30 hover:border-muted-foreground/60'
            )}
          >
            {selected && <Check className="size-3" />}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            if (editMode) {
              onToggleSelect()
            } else {
              setExpanded(!expanded)
            }
          }}
          className="flex flex-1 items-center gap-2.5 min-w-0 text-left"
        >
          <h3 className="flex-1 min-w-0 text-[13px] font-medium truncate">{name}</h3>
        </button>

        <Switch
          checked={enabled}
          onCheckedChange={() => void toggleSkill(name)}
          disabled={editMode}
        />

        <button
          type="button"
          onClick={editMode ? undefined : () => setExpanded(!expanded)}
          className={cn(
            'shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
            editMode && 'opacity-40 pointer-events-none'
          )}
        >
          <ChevronDown
            className={cn('size-4 transition-transform duration-200', expanded && 'rotate-180')}
          />
        </button>
      </div>

      {expanded && !editMode && description && (
        <div className="px-4 pb-4 pt-0">
          <p className="text-[13px] text-muted-foreground leading-relaxed">{description}</p>
        </div>
      )}
    </div>
  )
}
