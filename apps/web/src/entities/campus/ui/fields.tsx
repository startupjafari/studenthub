'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'

/**
 * Поля панели свойств. Значение уходит в документ по Enter или уходу фокуса, а не на каждую
 * букву: иначе каждая цифра «1», «12», «120» была бы шагом истории и правкой графа.
 */
export function Field({ label, children, id }: { label: string; children: ReactNode; id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
  disabled,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
}) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const n = Number(draft.replace(',', '.'))
    if (!Number.isFinite(n)) return setDraft(String(value))
    const clamped = Math.min(
      max ?? Infinity,
      Math.max(min ?? -Infinity, Math.round(n / step) * step),
    )
    if (clamped !== value) onCommit(clamped)
    setDraft(String(clamped))
  }
  return (
    <Field label={suffix ? `${label}, ${suffix}` : label} id={id}>
      <Input
        id={id}
        size="md"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(String(value))
        }}
      />
    </Field>
  )
}

export function TextField({
  label,
  value,
  onCommit,
  maxLength,
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onCommit: (v: string) => void
  maxLength: number
  placeholder?: string
  disabled?: boolean
}) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (): void => {
    const v = draft.trim()
    if (v !== value) onCommit(v)
  }
  return (
    <Field label={label} id={id}>
      <Input
        id={id}
        size="md"
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(value)
        }}
      />
    </Field>
  )
}

export function ChoiceField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <Field label={label} id={id}>
      <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
        <SelectTrigger id={id} size="md" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
