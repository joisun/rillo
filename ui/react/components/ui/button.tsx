import { Button as ButtonPrimitive } from '@base-ui/react/button'
import type { ComponentProps } from 'react'
import { Loader } from '@/components/ui/loader'
import { cn } from '@/lib/cn'

export type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'link' | 'warning' | 'danger'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  isIconOnly?: boolean
  isPending?: boolean
}
const sizes = { xs: 'h-6', sm: 'h-7', md: 'h-8', lg: 'h-9' }
export function Button({ className, variant = 'secondary', size = 'md', isIconOnly, isPending, disabled, children, ...props }: ButtonProps) {
  return <ButtonPrimitive type="button" className={cn('ui-button', sizes[size], isIconOnly && 'p-0', className)}
    data-button="" data-variant={variant} data-size={size} data-icon-only={isIconOnly ? '' : undefined}
    data-pending={isPending ? '' : undefined} aria-busy={isPending || undefined} disabled={disabled || isPending} {...props}>
    {isPending ? <><Loader className="ui-button__loader" aria-hidden="true" /><span>{children}</span></> : children}
  </ButtonPrimitive>
}
