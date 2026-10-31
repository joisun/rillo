// Adapted from Kibo UI Status (MIT); semantic tokens replace fixed colors and looping ping.
import type { ComponentProps } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'

export function Status({ className, status, ...props }: ComponentProps<typeof Badge> & { status: 'online' | 'offline' | 'maintenance' | 'degraded' }) {
  return <Badge className={cn('kibo-status', className)} data-status={status} {...props} />
}
export function StatusIndicator({ className, ...props }: ComponentProps<'span'>) {
  return <span aria-hidden="true" className={cn('kibo-status__indicator', className)} {...props} />
}
export function StatusLabel({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('kibo-status__label', className)} {...props} />
}
