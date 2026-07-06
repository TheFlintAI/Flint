import { useTranslation } from 'react-i18next'
import { Loader2, FileText, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSkillsStore } from '@/stores/skills-store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { toast } from 'sonner'
import { useState } from 'react'

export function SkillInstallDialog(): React.JSX.Element | null {
  const { t } = useTranslation('layout')
  const open = useSkillsStore((s) => s.installDialogOpen)
  const installing = useSkillsStore((s) => s.installing)
  const skillName = useSkillsStore((s) => s.installSkillName)
  const skillDescription = useSkillsStore((s) => s.installSkillDescription)
  const skillMdContent = useSkillsStore((s) => s.installSkillMdContent)
  const closeInstallDialog = useSkillsStore((s) => s.closeInstallDialog)
  const confirmInstall = useSkillsStore((s) => s.confirmInstall)

  const [previewOpen, setPreviewOpen] = useState(false)

  if (!open) return null

  const handleInstall = async (): Promise<void> => {
    const result = await confirmInstall()
    if (result.success) {
      toast.success(t('skillsPage.added', { name: result.name }))
    } else {
      toast.error(t('skillsPage.addFailed', { error: result.error }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeInstallDialog()}>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto pr-0.5">
          <DialogTitle className="text-lg">
            {skillName || t('skillsPage.installSkill')}
          </DialogTitle>

          {/* Description */}
          {skillDescription && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {skillDescription}
            </p>
          )}

          {/* SKILL.md preview */}
          <Collapsible open={previewOpen} onOpenChange={setPreviewOpen}>
            <div className="rounded-lg border">
              <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left cursor-pointer hover:bg-muted/30 transition-colors rounded-lg">
                <FileText className="size-3.5 text-blue-500 shrink-0" />
                <span className="text-xs font-medium flex-1">SKILL.md</span>
                <ChevronDown
                  className={cn(
                    'size-3.5 text-muted-foreground transition-transform duration-200',
                    previewOpen && 'rotate-180'
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-border/20">
                  {skillMdContent ? (
                    <pre className="text-[11px] leading-relaxed text-muted-foreground font-mono max-h-48 overflow-y-auto p-3 whitespace-pre-wrap">
                      {skillMdContent}
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      Loading...
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={closeInstallDialog} disabled={installing}>
            {t('skillsPage.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleInstall()}
            disabled={installing}
          >
            {installing ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1" />
                {t('skillsPage.installing')}
              </>
            ) : (
              t('skillsPage.installSafe')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
