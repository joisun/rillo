import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function Switch({ className, children, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return <div data-switch="" className={cn('ui-switch-field', className)}>
    <SwitchPrimitive.Root className="ui-switch" {...props}><SwitchPrimitive.Thumb className="ui-switch__thumb" /></SwitchPrimitive.Root>
    {children}
  </div>
}
