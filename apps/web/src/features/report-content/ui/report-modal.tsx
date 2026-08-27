'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type { ComplaintTargetTypeValue } from '@studenthub/shared-schemas'
import { createComplaintRequest } from '../../../entities/complaint'
import { Button, FormAlert, Label, Modal, Textarea } from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

/**
 * Категории жалобы. Ключи — стабильные коды, подписи локализованы.
 *
 * В `reason` уходит подпись на языке жалующегося плюс его пояснение: у жалобы в схеме
 * одно текстовое поле, отдельного поля категории нет. Категория здесь для того, чтобы
 * человеку не пришлось формулировать с нуля — пустое поле «причина» люди просто
 * закрывают, и нарушение остаётся неотправленным.
 */
const REASONS = ['SPAM', 'FORBIDDEN', 'FRAUD', 'HATE', 'EXPLICIT', 'OTHER'] as const

export function ReportModal({
  targetType,
  targetId,
  preview,
  onClose,
}: {
  targetType: ComplaintTargetTypeValue
  targetId: string
  /** Что именно обжалуется — показываем цитатой, чтобы не ошибиться объектом. */
  preview?: string
  onClose: () => void
}) {
  const t = useTranslations('Report')
  const tCommon = useTranslations('Common')
  const { error, show, reset } = useFormAlert()
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null)
  const [details, setDetails] = useState('')

  const send = useMutation({
    mutationFn: () =>
      createComplaintRequest({
        targetType,
        targetId,
        reason: [t(`reason_${reason}`), details.trim()].filter(Boolean).join('. '),
      }),
    onMutate: () => reset(),
    onSuccess: () => {
      toast.success(t('sent'))
      onClose()
    },
    onError: (e) => show(e),
  })

  return (
    <Modal onClose={onClose} title={t('title')} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (reason) send.mutate()
        }}
        className="flex flex-col gap-4"
      >
        <FormAlert error={error} />

        {preview && (
          <p className="line-clamp-3 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
            {preview}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label>{t('question')}</Label>
          <div className="flex flex-col gap-1">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={reason === r}
                onClick={() => setReason(r)}
                className={cn(
                  'cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                  reason === r ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                )}
              >
                {t(`reason_${r}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-details">{t('details')}</Label>
          <Textarea
            id="report-details"
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={t('detailsPlaceholder')}
          />
        </div>

        <p className="text-xs text-muted-foreground">{t('hint')}</p>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={send.isPending} disabled={!reason}>
            {t('send')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
