'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CalendarClock } from 'lucide-react'
import { Button, DateTimePicker, FieldError, Modal, toDateTimeLocal } from '../../../shared/ui'
import { plainPreview } from '../lib/format'

/** Сервер принимает отложенное не дальше года вперёд (`ScheduleMessageSchema`). */
const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000

type PresetKey = 'inHour' | 'tonight' | 'tomorrowMorning'

// Типовые варианты: через час, сегодня вечером, завтра утром. Ими закрывается почти всё, и
// до календаря дело не доходит. Прошедший вечер в список не попадает — вариант бессмыслен.
function presets(): { key: PresetKey; at: Date }[] {
  const inHour = new Date(Date.now() + 60 * 60 * 1000)
  const tonight = new Date()
  tonight.setHours(20, 0, 0, 0)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  const all: { key: PresetKey; at: Date }[] = [
    { key: 'inHour', at: inHour },
    { key: 'tonight', at: tonight },
    { key: 'tomorrowMorning', at: tomorrow },
  ]
  return all.filter((p) => p.at.getTime() > Date.now() + 60_000)
}

/**
 * Выбор времени отложенной отправки (меню кнопки «Отправить» → «Отправить позже»).
 * Текст уже набран в поле — здесь только «когда». Время локальное, на сервер уходит ISO UTC.
 */
export function ComposerScheduleDialog({
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
  const [value, setValue] = useState(() => toDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000)))
  const [touched, setTouched] = useState(false)

  const at = new Date(value)
  const time = at.getTime()
  const error = Number.isNaN(time)
    ? t('tgComposer.scheduleInvalid')
    : time <= Date.now()
      ? t('tgComposer.scheduleInPast')
      : time > Date.now() + MAX_AHEAD_MS
        ? t('tgComposer.scheduleTooFar')
        : null

  function presetLabel(key: PresetKey): string {
    if (key === 'inHour') return t('tgComposer.schedulePresetInHour')
    if (key === 'tonight') return t('tgComposer.schedulePresetTonight')
    return t('tgComposer.schedulePresetTomorrow')
  }

  return (
    <Modal onClose={onClose} title={t('tgComposer.scheduleTitle')} size="md">
      <div className="flex flex-col gap-4">
        <p className="line-clamp-3 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {plainPreview(preview)}
        </p>

        <div className="flex flex-wrap gap-2">
          {presets().map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setValue(toDateTimeLocal(p.at))}
              className="cursor-pointer rounded-full border border-input px-3 py-1.5 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-4 focus-visible:ring-ring/20"
            >
              {presetLabel(p.key)}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <DateTimePicker
            value={value}
            onChange={setValue}
            min={toDateTimeLocal(new Date(Date.now() + 60_000))}
            aria-label={t('tgComposer.scheduleTitle')}
            aria-invalid={touched && !!error}
          />
          <FieldError>{touched ? error : null}</FieldError>
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
              if (!error) onConfirm(at.toISOString())
            }}
          >
            <CalendarClock aria-hidden />
            {t('tgComposer.scheduleConfirm')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
