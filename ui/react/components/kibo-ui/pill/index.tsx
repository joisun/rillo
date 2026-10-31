// Adapted from Kibo UI Pill (MIT); unused avatar, delta and button variants omitted.
import type { ComponentProps } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'

export function Pill({ className, variant = 'secondary', ...props }: ComponentProps<typeof Badge>) {
  return <Badge variant={variant} className={cn('kibo-pill', className)} {...props} />
}
