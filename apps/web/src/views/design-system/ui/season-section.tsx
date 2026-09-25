'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { HOLIDAYS, type Holiday } from '../../../shared/config'
import { seasonIcon } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { Caption, Code, Demo, Section } from './kit'

// Праздники: весь набор разом — знак, палитра и тон каждой даты.
//
// Зачем витрине отдельный раздел. В продукте праздник виден по одному и только в свой день:
// чтобы сравнить два знака между собой, пришлось бы ждать марта. Здесь они стоят рядом, и
// видно то, ради чего набор и собирался, — что знаки различимы и ни один не повторяется.

/**
 * Палитра есть не у всех: сдержанные даты и выключенные мягкие праздники меняют только
 * знак и текст. Правило то же, что в `globals.css`, и выведено из тех же полей —
 * второго списка сезонов здесь не заводим.
 */
const hasPalette = (holiday: Holiday): boolean => holiday.decorated && holiday.tone !== 'solemn'

const TONE_NOTE: Record<Holiday['tone'], string> = {
  festive: 'праздничный',
  national: 'государственный',
  warm: 'тёплый',
  solemn: 'сдержанный',
}

export function SeasonSection() {
  const t = useTranslations('Season')
  // Примерка идёт тем же способом, каким праздник работает в продукте: атрибут на <html>.
  // Поэтому в витрине видно ровно то, что увидит человек, — включая случаи, когда палитра
  // не меняется вовсе.
  const [preview, setPreview] = useState<string | null>(null)

  function tryOn(id: string | null) {
    setPreview(id)
    if (id) document.documentElement.setAttribute('data-season', id)
    else document.documentElement.removeAttribute('data-season')
  }

  return (
    <Section
      id="season"
      title="Праздники"
      note="Оформление государственных, академических и общих дат. Сезон переопределяет те же токены, что и тема, поэтому в разметке праздник не упоминается: bg-primary становится праздничным сам. Нажмите карточку — атрибут data-season встанет на <html>, как в продукте."
    >
      <Demo
        label="Знак и палитра каждой даты"
        rule={
          <>
            карта — <Code>shared/ui/season-icon.ts</Code>, календарь —{' '}
            <Code>shared/config/holidays.ts</Code>
          </>
        }
        className="flex-col items-stretch gap-3"
      >
        <div className="grid w-full gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {HOLIDAYS.map((holiday) => {
            const Icon = seasonIcon(holiday.id)
            const active = preview === holiday.id
            return (
              <button
                key={holiday.id}
                type="button"
                onClick={() => tryOn(active ? null : holiday.id)}
                className={cn(
                  'flex items-center gap-3 rounded-xl p-3 text-left ring-1 transition-colors',
                  active ? 'bg-primary/10 ring-primary/40' : 'bg-card ring-foreground/10',
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{t(`${holiday.id}.name`)}</span>
                  <Caption>
                    {TONE_NOTE[holiday.tone]}
                    {holiday.dayOff && ' · нерабочий'}
                    {!holiday.decorated && ' · не оформляется'}
                    {!hasPalette(holiday) && holiday.decorated && ' · палитра прежняя'}
                  </Caption>
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => tryOn(null)}
            className="rounded-lg bg-secondary px-3 py-1.5 text-sm text-secondary-foreground"
          >
            Снять примерку
          </button>
          <Caption>
            Примерка живёт до перезагрузки: настоящий сезон считает календарь, а поверх него
            действует рычаг платформы.
          </Caption>
        </div>
      </Demo>
    </Section>
  )
}
