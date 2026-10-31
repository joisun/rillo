import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function Badge({ className, variant = 'secondary', ...props }: ComponentProps<'span'> & { variant?: 'secondary' | 'outline' | 'default' | 'destructive' }) {
  return <span data-slot="badge" data-variant={variant} className={cn('ui-badge', className)} {...props} />
}
