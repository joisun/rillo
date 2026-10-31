import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function Input({ className, size = 'sm', ...props }: Omit<ComponentProps<'input'>, 'size'> & { size?: 'sm' | 'md' }) {
  return <input data-slot="input" data-size={size} className={cn('ui-input', className)} {...props} />
}
export function TextArea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn('ui-input ui-textarea', className)} {...props} />
}
export function InputGroup({ className, size = 'sm', ...props }: ComponentProps<'div'> & { size?: 'sm' | 'md' }) {
  return <div data-slot="input-group" data-size={size} className={cn('ui-input-group', className)} {...props} />
}
export function InputGroupAddon({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="input-group-addon" className={cn('ui-input-addon', className)} {...props} />
}
