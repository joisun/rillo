import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { m, type HTMLMotionProps } from 'motion/react'
import type { ComponentProps } from 'react'
import { Button } from './button'
import { cn } from '@/lib/cn'
import { transition } from '@/lib/motion'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export function DialogContent({ className, children, showCloseButton = false, ...props }: ComponentProps<typeof DialogPrimitive.Popup> & { showCloseButton?: boolean }) {
  return <DialogPrimitive.Portal><DialogPrimitive.Backdrop className="ui-dialog__backdrop" />
    <div className="ui-dialog__viewport"><DialogPrimitive.Popup data-slot="dialog-content" className={cn('ui-dialog', className)} {...props}
      render={(popupProps, state) => <m.div {...popupProps as HTMLMotionProps<'div'>} initial={false} animate={{ opacity: state.open ? 1 : 0, y: state.open ? 0 : 8, scale: state.open ? 1 : 0.98 }} transition={transition.standard} />}>
      {children}{showCloseButton ? <DialogClose render={<Button className="ui-dialog__close" isIconOnly size="sm" variant="quiet" aria-label="关闭" />}><X /></DialogClose> : null}
    </DialogPrimitive.Popup></div>
  </DialogPrimitive.Portal>
}
export function DialogHeader({ className, ...props }: ComponentProps<'header'>) { return <header data-slot="dialog-header" className={cn('ui-dialog__header', className)} {...props} /> }
export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) { return <DialogPrimitive.Title data-slot="dialog-heading" className={cn('ui-dialog__title', className)} {...props} /> }
export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) { return <DialogPrimitive.Description data-slot="dialog-description" className={cn('ui-dialog__description', className)} {...props} /> }
export function DialogBody({ className, ...props }: ComponentProps<'div'>) { return <div data-slot="dialog-body" className={cn('ui-dialog__body', className)} {...props} /> }
export function DialogFooter({ className, ...props }: ComponentProps<'footer'>) { return <footer data-slot="dialog-footer" className={cn('ui-dialog__footer', className)} {...props} /> }
