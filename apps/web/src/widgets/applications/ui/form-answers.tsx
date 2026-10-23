'use client'

import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { pickLocale, type ServiceFormField } from '../../../entities/application-service'
import { Card } from '../../../shared/ui'

type Translate = ReturnType<typeof useTranslations>

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/

/**
 * Ответ анкеты так, как его прочтёт человек: вариант выбора — подписью, флажок — «Да/Нет»,
 * дата — по локали. Клиенты пишут значения по-разному (веб — флажок булевым, iOS —
 * строкой «true»), поэтому разбираем по смыслу. Пустой ответ — null.
 */
export function formAnswerText(
  field: Pick<ServiceFormField, 'type' | 'options'>,
  value: unknown,
  locale: string,
  t: Translate,
): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  switch (field.type) {
    case 'BOOLEAN':
    case 'CHECKBOX':
      if (value === true || value === 'true') return t('answerYes')
      if (value === false || value === 'false') return t('answerNo')
      return String(value)
    case 'SELECT':
    case 'RADIO': {
      const option = (field.options ?? []).find((o) => o.value === value)
      return option
        ? pickLocale(option as unknown as Record<string, unknown>, 'label', locale) || option.value
        : String(value)
    }
    case 'DATE': {
      const m = typeof value === 'string' ? DATE_RE.exec(value) : null
      // Дата без часового пояса: собираем по частям, иначе new Date('2026-10-01') в поясе
      // западнее UTC показала бы предыдущий день.
      return m
        ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(locale)
        : String(value)
    }
    default:
      return String(value)
  }
}

/**
 * Ответы анкеты заявки с подписями полей услуги (PROJECT.md §3.2): что студент указал —
 * причину, цель справки, организацию. Обработчик решает по ним, студент сверяет перед
 * отправкой. Поле без ответа не показывается; нет ни одного ответа — блока нет.
 */
export function FormAnswers({
  fields,
  formData,
  title,
  action,
}: {
  fields: ServiceFormField[]
  formData: Record<string, unknown> | null | undefined
  title?: string
  // Действие в шапке блока (например, «Исправить ответы»).
  action?: ReactNode
}) {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const answers = fields.flatMap((f) => {
    const text = formAnswerText(f, formData?.[f.code], locale, t)
    if (text === null) return []
    const label = pickLocale(f as unknown as Record<string, unknown>, 'label', locale)
    return [{ id: f.id, label, text }]
  })
  if (answers.length === 0 && !action) return null

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title ?? t('formTitle')}</h3>
        {action}
      </div>
      {answers.map((a) => (
        <div key={a.id} className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{a.label}</span>
          {/* Свободный текст студента — с переносами строк, как он его написал. */}
          <span className="text-sm whitespace-pre-line">{a.text}</span>
        </div>
      ))}
    </Card>
  )
}
