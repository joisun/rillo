// Adapted from Kibo UI Spinner (MIT): only the Lucide throbber variant is needed.
import { LoaderIcon, type LucideProps } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Spinner({ className, ...props }: LucideProps) {
  return <LoaderIcon role="status" aria-label="正在加载" className={cn('ui-spinner', className)} {...props} />
}
