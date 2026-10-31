import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverClose = PopoverPrimitive.Close
export function PopoverContent({ className, children, ...props }: ComponentProps<typeof PopoverPrimitive.Popup>) {
  return <PopoverPrimitive.Portal><PopoverPrimitive.Positioner className="ui-positioner" sideOffset={6} align="start">
    <PopoverPrimitive.Popup className={cn('ui-popover', className)} {...props}>{children}</PopoverPrimitive.Popup>
  </PopoverPrimitive.Positioner></PopoverPrimitive.Portal>
}
