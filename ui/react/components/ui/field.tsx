import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function FieldLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label data-slot="field-label" className={cn('ui-label', className)} {...props} />
}
