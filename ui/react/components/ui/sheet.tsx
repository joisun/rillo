import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { m, type HTMLMotionProps } from 'motion/react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { transition } from '@/lib/motion'

export const Sheet = DialogPrimitive.Root
export function SheetContent({ container, keepMounted, className, children, floating = false, ...props }: ComponentProps<typeof DialogPrimitive.Popup> & Pick<ComponentProps<typeof DialogPrimitive.Portal>, 'container' | 'keepMounted'> & { floating?: boolean }) {
  return <DialogPrimitive.Portal container={container} keepMounted={keepMounted}>
    <div data-slot="drawer-overlay" className={cn('ui-sheet-overlay', floating && 'ui-sheet-overlay--floating')}>
      {!floating ? <DialogPrimitive.Backdrop className="ui-dialog__backdrop" /> : null}
      <div data-slot="drawer-viewport" className="ui-sheet-viewport">
        <DialogPrimitive.Popup data-slot="dialog-content" className={cn('ui-sheet', className)} {...props}
          render={(popupProps, state) => <m.div {...popupProps as HTMLMotionProps<'div'>} initial={false} animate={{ opacity: state.open ? 1 : 0, x: state.open ? 0 : 24 }} transition={transition.standard} />}>
          {children}
        </DialogPrimitive.Popup>
      </div>
    </div>
  </DialogPrimitive.Portal>
}
