import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { LayoutGroup, m } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { transition } from '@/lib/motion'

export function SegmentedControl<T extends string>({ value, onValueChange, options, label, className = '' }: {
  value: T; onValueChange: (value: T) => void; label: string; className?: string
  options: { value: T; label: ReactNode; disabled?: boolean }[]
}) {
  const id = useId()
  return <LayoutGroup id={id}><ToggleGroup className={`segmented-control ${className}`} value={[value]} onValueChange={values => { if (values[0]) onValueChange(values[0] as T) }} aria-label={label}>
    {options.map(option => <Toggle value={option.value} key={option.value} disabled={option.disabled} className="segmented-control__item">
      {value === option.value ? <m.span className="segmented-control__indicator" layoutId="selection" transition={transition.fast} /> : null}
      <span className="segmented-control__label">{option.label}</span>
    </Toggle>)}
  </ToggleGroup></LayoutGroup>
}
