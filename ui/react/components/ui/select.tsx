import { Select as SelectPrimitive } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'
import { Children, Fragment, createContext, useContext, isValidElement, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

// The checked-in compound API supplies initial labels even before a popup is mounted.
function labels(children: ReactNode): { value: string; label: ReactNode }[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string; children?: ReactNode }>(child)) return []
    if (child.type === SelectItem) return [{ value: child.props.value!, label: child.props.children }]
    return child.type === SelectContent || child.type === Fragment ? labels(child.props.children) : []
  })
}
export function Select({ children, className, 'aria-label': label, ...props }: ComponentProps<typeof SelectPrimitive.Root<string>> & { className?: string; 'aria-label'?: string }) {
  return <div className={cn('ui-select', className)}><SelectPrimitive.Root items={labels(children)} {...props}>
    <SelectLabelContext.Provider value={label}>{children}</SelectLabelContext.Provider>
  </SelectPrimitive.Root></div>
}
const SelectLabelContext = createContext<string | undefined>(undefined)
export function SelectTrigger({ className, children, size = 'sm', ...props }: ComponentProps<typeof SelectPrimitive.Trigger> & { size?: 'sm' | 'md' }) {
  const label = useContext(SelectLabelContext)
  return <SelectPrimitive.Trigger aria-label={label} className={cn('ui-select__trigger', className)} data-size={size} {...props}>
    {children}<SelectPrimitive.Icon><ChevronDown /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
}
export const SelectValue = SelectPrimitive.Value
export function SelectContent({ children, className }: { children: ReactNode; className?: string }) {
  return <SelectPrimitive.Portal><SelectPrimitive.Positioner className="ui-positioner" sideOffset={6} alignItemWithTrigger={false}>
    <SelectPrimitive.Popup className={cn('ui-select__popup', className)}><SelectPrimitive.List>{children}</SelectPrimitive.List></SelectPrimitive.Popup>
  </SelectPrimitive.Positioner></SelectPrimitive.Portal>
}
export function SelectItem({ children, className, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item className={cn('ui-select__item', className)} {...props}><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText><SelectPrimitive.ItemIndicator><Check /></SelectPrimitive.ItemIndicator></SelectPrimitive.Item>
}
