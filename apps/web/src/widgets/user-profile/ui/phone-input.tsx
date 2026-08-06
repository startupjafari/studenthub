'use client'

import { IMaskInput } from 'react-imask'

const CLS =
  'h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 py-2 text-base transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground/70 hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 md:text-sm dark:bg-input/30'

// Телефон с маской (react-imask). Формат +7 (777) 777-77-77; хранится в отформатированном виде.
export function PhoneInput({
  id,
  value,
  onChange,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <IMaskInput
      id={id}
      mask="+0 (000) 000-00-00"
      value={value ?? ''}
      onAccept={(v) => onChange(String(v))}
      inputMode="tel"
      placeholder="+7 (___) ___-__-__"
      className={CLS}
    />
  )
}
