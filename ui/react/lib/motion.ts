import type { Transition } from 'motion/react'

export const duration = { fast: 0.15, standard: 0.22, layout: 0.3 } as const
export const transition = {
  fast: { duration: duration.fast, ease: [0.2, 0, 0, 1] },
  standard: { duration: duration.standard, ease: [0.2, 0, 0, 1] },
  layout: { duration: duration.layout, ease: [0.2, 0, 0, 1] },
} satisfies Record<string, Transition>
