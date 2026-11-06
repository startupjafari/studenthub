'use client'

import { pickLocale, type ServiceFormField } from '../../../entities/application-service'
import { Input, Label, Textarea } from '../../../shared/ui'

/**
 * Ответа на поле нет. Обязательный флажок (CHECKBOX — «согласен») засчитывается только
 * отмеченным — как на сервере (form-validation.ts); «да/нет» (BOOLEAN) — любым ответом.
 * iOS пишет флажки строкой, поэтому «true» — тоже ответ.
 */
export function isAnswerMissing(field: Pick<ServiceFormField, 'type'>, value: unknown): boolean {
  if (field.type === 'CHECKBOX') return value !== true && value !== 'true'
  return value === undefined || value === null || value === ''
}

// Поле анкеты услуги — в мастере подачи и в правке ответов при исправлении заявки.
export function DynamicField({
  field,
  locale,
  value,
  onChange,
  optionalLabel,
  yesLabel,
  noLabel,
}: {
  field: ServiceFormField
  locale: string
  value: unknown
  onChange: (v: unknown) => void
  optionalLabel: string
  yesLabel: string
  noLabel: string
}) {
  const rec = field as unknown as Record<string, unknown>
  const label = pickLocale(rec, 'label', locale)
  const placeholder = pickLocale(rec, 'placeholder', locale)
  const id = `field-${field.code}`
  const common = { id, placeholder, 'aria-required': field.required }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} id={`${id}-label`}>
        {label}
        {!field.required && (
          <span className="ml-1 text-xs text-muted-foreground">({optionalLabel})</span>
        )}
      </Label>
      {field.type === 'TEXTAREA' ? (
        <Textarea
          {...common}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === 'SELECT' || field.type === 'RADIO' ? (
        <select
          id={id}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="" disabled>
            —
          </option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {pickLocale(o as unknown as Record<string, unknown>, 'label', locale) || o.value}
            </option>
          ))}
        </select>
      ) : field.type === 'BOOLEAN' ? (
        // Вопрос «да/нет» — два варианта: одним флажком ответ «нет» требовал двух кликов
        // (отметить и снять), а неотмеченный флажок не отличался от пропущенного вопроса.
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex gap-4">
          {[true, false].map((answer) => (
            <label key={String(answer)} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={id}
                className="size-4 accent-primary"
                // iOS хранит флажки строкой — черновик с телефона открывается тем же ответом.
                checked={value === answer || value === String(answer)}
                onChange={() => onChange(answer)}
              />
              {answer ? yesLabel : noLabel}
            </label>
          ))}
        </div>
      ) : field.type === 'CHECKBOX' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={value === true || value === 'true'}
            onChange={(e) => onChange(e.target.checked)}
          />
          {placeholder || label}
        </label>
      ) : (
        <Input
          {...common}
          type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
