import type { PromptSection, SectionContext, PromptRole } from './types'

class SectionRegistry {
  private sections: PromptSection[] = []

  registerAll(sections: PromptSection[]): void {
    for (const section of sections) this.sections.push(section)
  }

  buildAll(ctx: SectionContext): string[] {
    const parts: string[] = []
    for (const section of this.sections) {
      if (!appliesToRole(section, ctx.role)) continue
      if (section.when && !section.when(ctx)) continue
      const content = section.build(ctx)
      if (content && content.trim()) parts.push(normalize(content))
    }
    return parts
  }
}

/** Collapse stray blank lines left by conditional blocks; trim edges. */
function normalize(content: string): string {
  return content.replace(/\n{3,}/g, '\n\n').trim()
}

function appliesToRole(section: PromptSection, role: PromptRole): boolean {
  if (!section.roles) return true
  return section.roles.includes(role)
}

export const promptRegistry = new SectionRegistry()
