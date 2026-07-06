import { Button } from '@/components/ui/button'
import { forwardRef } from 'react'
import type { ComponentProps } from 'react'

type ButtonProps = ComponentProps<typeof Button>

/**
 * Unified toolbar action button used across settings panels and action bars.
 * Default styling: outline variant, small size, consistent height and gap.
 */
export const ToolbarButton = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'outline', size = 'sm', ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      className={`h-8 gap-1.5 text-xs shrink-0 ${className ?? ''}`}
      {...props}
    />
  )
)
ToolbarButton.displayName = 'ToolbarButton'
