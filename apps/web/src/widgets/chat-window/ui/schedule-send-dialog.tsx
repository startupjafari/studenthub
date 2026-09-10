'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Clock } from 'lucide-react'
import { Button, DateTimePicker, FieldError, Modal } from '../../../shared/ui'

// Ближайшие типовые варианты: через час, вечером сегодня, завтра утром. Ими закрывается
// большинство случаев, и до календаря дело не доходит.
function presets(): { key: string; at: Date }[] {
  const inHour = new Date(Date.now() + 60 * 60 * 1000)
  const tonight = new Date()
  tonight.setHours(20, 0, 0, 0)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  return [
    { key: 'inHour', at: inHour },
    // Вечер уже прошёл — вариант бессмыслен, отфильтруется ниже.
    { key: 'tonight', at: tonight },
    { key: 'tomorrowMorning', at: tomorrow },
  ].filter((p) => p.at.getTime() > Date.now() + 60_000)
}

function toLocalInput(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Выбор времени отложенной отправки. Текст уже набран в композере — здесь только «когда».
 */
export function ScheduleSendDialog({
  preview,
  pending,
  onClose,
  onConfirm,
}: {
  preview: string
  pending: boolean
  onClose: () => void
  onConfirm: (isoUtc: string) => void
}) {
  const t = useTranslations('Chats')
  const [value, setValue] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60 * 1000)))
  const [touched, setTouched] = useState(false)

  const at = new Date(value)
  const valid = !Number.isNaN(at.getTime()) && at.getTime() > Date.now()

  return (
    <Modal onClose={onClose} title={t('sendLater')} size="md">
      <div className="flex flex-col gap-4">
        <p className="line-clamp-3 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {preview}
        </p>

        <div className="flex flex-wrap gap-2">
          {presets().map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setValue(toLocalInput(p.at))}
              className="rounded-full border border-input px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            >
              {t(`schedulePreset.${p.key}`)}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <DateTimePicker
            value={value}
            onChange={setValue}
            min={toLocalInput(new Date(Date.now() + 60_000))}
            aria-label={t('sendLater')}
            aria-invalid={touched && !valid}
          />
          <FieldError>{touched && !valid ? t('scheduleInPast') : ''}</FieldError>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            loading={pending}
            onClick={() => {
              setTouched(true)
              // Время из пикера локальное — на сервер уходит ISO в UTC.
              if (valid) onConfirm(at.toISOString())
            }}
          >
            <Clock className="size-4" aria-hidden />
            {t('scheduleConfirm')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
