'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { DeliveryType } from '@studenthub/shared-schemas'
import {
  applicationKeys,
  updateDraftRequest,
  type ApplicationDetail,
} from '../../../entities/application-service'
import { Button, Modal } from '../../../shared/ui'
import { DynamicField, isAnswerMissing } from './dynamic-field'
import { allowedDeliveryTypes } from '../lib/delivery-types'
import { useActionError } from '../lib/use-action-error'

/**
 * Правка способа получения и ответов анкеты, пока заявка ждёт исправления (NEEDS_CORRECTION).
 * Сотрудник мог попросить уточнить поле («укажите организацию»), а не только заменить
 * документ: раньше править было негде, и оставалось отправить без изменений или подать
 * заявку заново. Сохраняет ответы; отправка — прежней кнопкой «Отправить повторно».
 */
export function CorrectionFormModal({
  app,
  onClose,
}: {
  app: ApplicationDetail
  onClose: () => void
}) {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const qc = useQueryClient()
  const err = useActionError()
  // Выключенные поля не правятся: ответы на них остаются как есть.
  const fields = (app.service.formFields ?? []).filter((f) => f.active)
  const deliveryOptions = allowedDeliveryTypes(app.service.deliveryModes ?? [])
  const [deliveryType, setDeliveryType] = useState<DeliveryType | null>(app.deliveryType)
  const [formData, setFormData] = useState<Record<string, unknown>>(app.formData ?? {})

  const missingRequired =
    !deliveryType || fields.some((f) => f.required && isAnswerMissing(f, formData[f.code]))

  const save = useMutation({
    mutationFn: () =>
      updateDraftRequest(app.id, { deliveryType: deliveryType ?? undefined, formData }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: applicationKeys.detail(app.id) })
      toast.success(t('answersSaved'))
      onClose()
    },
    onError: err,
  })

  return (
    <Modal onClose={onClose} title={t('editAnswers')} size="lg">
      <div className="flex flex-col gap-6">
        {deliveryOptions.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">{t('deliveryTitle')}</legend>
            {deliveryOptions.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-input p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="correction-delivery"
                  className="size-4 accent-primary"
                  checked={deliveryType === opt}
                  onChange={() => setDeliveryType(opt)}
                />
                <span className="text-sm">{t(`delivery_${opt}`)}</span>
              </label>
            ))}
          </fieldset>
        )}

        {fields.length > 0 && (
          <div className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold">{t('formTitle')}</h3>
            {fields.map((f) => (
              <DynamicField
                key={f.id}
                field={f}
                locale={locale}
                value={formData[f.code]}
                onChange={(v) => setFormData((prev) => ({ ...prev, [f.code]: v }))}
                optionalLabel={t('optional')}
                yesLabel={t('answerYes')}
                noLabel={t('answerNo')}
              />
            ))}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" className="w-full sm:w-auto" onClick={onClose}>
            {t('promptCancel')}
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={missingRequired}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('saveAnswers')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
