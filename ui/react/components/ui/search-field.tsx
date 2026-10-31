import { Search, X } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Button } from './button'
import { Input, InputGroup, InputGroupAddon } from './input'

export function SearchField({ value, onChange, className, size = 'sm', ...props }: Omit<ComponentProps<typeof Input>, 'onChange'> & { value: string; onChange: (value: string) => void }) {
  return <InputGroup className={className} size={size}><InputGroupAddon><Search /></InputGroupAddon>
    <Input type="search" value={value} size={size} onChange={event => onChange(event.currentTarget.value)} {...props} />
    {value ? <Button variant="quiet" size="xs" isIconOnly aria-label="清空搜索" disabled={props.disabled} onClick={() => onChange('')}><X /></Button> : null}
  </InputGroup>
}
