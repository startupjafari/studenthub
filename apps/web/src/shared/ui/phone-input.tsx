'use client'

import type { ComponentProps } from 'react'
import { IMaskInput } from 'react-imask'
import { cn } from '../lib/utils'
import { FIELD_SIZE, type ControlSize } from './control-size'

// Телефон Казахстана с маской: +7 (777) 777-77-77. Код страны закреплён — номера вне
// Казахстана поле не набирает. Значение отдаётся отформатированной строкой, пустое поле — ''.
//
// Привычные способы набора приводятся к +7: «8 777 …» (восьмёрка вместо +7), «777 …» без
// кода страны, вставка «+7 777 …» и «87771234567» целиком.

const PHONE_MASK = '+{7} (000) 000-00-00'
const COMPLETE = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/

/** Номер набран полностью: все десять цифр после +7. */
export function isCompletePhone(value: string | null | undefined): boolean {
  return !!value && COMPLETE.test(value)
}

/**
 * Первый ввод в пустое поле — к виду «7 + цифры номера»: закреплённую семёрку маска забирает
 * из ввода сама, и без этого набранная первой «7» оператора съедалась бы ею.
 */
function prepare(chars: string, masked: { unmaskedValue: string }): string {
  if (masked.unmaskedValue !== '') return chars
  const digits = chars.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 11 && /^[78]/.test(digits)) return `7${digits.slice(1)}`
  if (digits === '8') return '7'
  return `7${digits}`
}

type NativeProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'size' | 'type' | 'defaultValue' | 'ref'
>

export function PhoneInput({
  value,
  onChange,
  size = 'lg',
  className,
  placeholder = '+7 (___) ___-__-__',
  ...props
}: NativeProps & {
  value: string | null | undefined
  onChange: (value: string) => void
  size?: ControlSize
}) {
  return (
    <IMaskInput
      {...props}
      mask={PHONE_MASK}
      prepare={prepare}
      value={value ?? ''}
      // Осталась одна закреплённая семёрка — номера нет: отдаём пустую строку, а не «+7».
      onAccept={(masked, mask) => onChange(mask.unmaskedValue.length > 1 ? String(masked) : '')}
      type="tel"
      inputMode="tel"
      autoComplete={props.autoComplete ?? 'tel'}
      placeholder={placeholder}
      data-slot="input"
      className={cn(
        // Те же классы, что у Input: маска не должна выдавать себя видом поля.
        'w-full min-w-0 rounded-xl border border-input bg-background py-2 transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground/70 hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/15 dark:bg-input/30 dark:disabled:bg-input/60',
        FIELD_SIZE[size],
        className,
      )}
    />
  )
}
