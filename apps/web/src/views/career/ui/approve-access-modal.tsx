'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button, DatePicker, Label, Modal } from '../../../shared/ui'

interface ApproveAccessModalProps {
  companyName: string
  busy: boolean
  /** `expiresAt` — ISO-момент окончания допуска; undefined — бессрочно. */
  onSubmit: (expiresAt: string | undefined) => void
  onClose: () => void
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Завтра в формате пикера: допуск, истекающий сегодня, выдавать бессмысленно. */
function tomorrowYmd(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Одобрение заявки компании со сроком допуска.
 *
 * Контракт решения принимает `expiresAt`, а кнопка «Одобрить» его не спрашивала — допуск
 * из веба выдавался только бессрочным. Срок необязателен: пустое поле — бессрочно.
 */
export function ApproveAccessModal({
  companyName,
  busy,
  onSubmit,
  onClose,
}: ApproveAccessModalProps) {
  const t = useTranslations('CareerAdmin')
  const [until, setUntil] = useState('')

  return (
    <Modal onClose={onClose} title={companyName} size="md">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t('accessUntilField')}</Label>
          <DatePicker
            value={until}
            onChange={setUntil}
            min={tomorrowYmd()}
            placeholder={t('accessUntilNone')}
            aria-label={t('accessUntilField')}
          />
          <p className="text-xs text-muted-foreground">{t('accessUntilHint')}</p>
        </div>
        <div className="flex justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            loading={busy}
            // Срок — датой: допуск действует до конца выбранного дня.
            onClick={() =>
              onSubmit(until ? new Date(`${until}T23:59:59`).toISOString() : undefined)
            }
          >
            {t('approve')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
