import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger
export function TooltipContent({ className, ...props }: ComponentProps<typeof TooltipPrimitive.Popup>) {
  return <TooltipPrimitive.Portal><TooltipPrimitive.Positioner side="bottom" sideOffset={8} className="ui-positioner">
    <TooltipPrimitive.Popup role="tooltip" className={cn('ui-tooltip', className)} {...props} />
  </TooltipPrimitive.Positioner></TooltipPrimitive.Portal>
}
