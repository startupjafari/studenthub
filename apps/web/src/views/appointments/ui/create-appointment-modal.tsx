'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  APPOINTMENT_TYPES,
  CreateAppointmentSchema,
  type CreateAppointmentInput,
} from '@studenthub/shared-schemas'
import {
  Button,
  DateTimePicker,
  FieldError,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { appointmentKeys, createAppointmentRequest } from '../../../entities/appointment'
import { APPT_TYPE_KEY } from '../lib/visuals'

// Модалка записи в деканат (студент): тип приёма, желаемое время, тема.
export function CreateAppointmentModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Appointments')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [type, setType] = useState<CreateAppointmentInput['type']>('CONSULTATION')
  const [whenLocal, setWhenLocal] = useState('')
  const [topic, setTopic] = useState('')
  const [pending, setPending] = useState(false)
  // Ошибку показываем после первой попытки отправки, а не на пустой форме.
  const [submitted, setSubmitted] = useState(false)
  const whenError = !whenLocal ? tCommon('dateRequired') : null

  async function onSubmit() {
    setSubmitted(true)
    if (whenError) return
    const payload = {
      type,
      requestedAt: whenLocal ? new Date(whenLocal).toISOString() : '',
      ...(topic.trim() ? { topic: topic.trim() } : {}),
    }
    const parsed = CreateAppointmentSchema.safeParse(payload)
    if (!parsed.success) {
      toast.error(t('formInvalid'))
      return
    }
    setPending(true)
    try {
      await createAppointmentRequest(parsed.data)
      await qc.invalidateQueries({ queryKey: appointmentKeys.mine() })
      toast.success(t('created'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal onClose={onClose} title={t('newAppointment')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t('type')}</Label>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APPOINTMENT_TYPES.map((ty) => (
                <SelectItem key={ty} value={ty}>
                  {t(APPT_TYPE_KEY[ty])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t('preferredTime')}</Label>
          <DateTimePicker
            value={whenLocal}
            onChange={setWhenLocal}
            aria-invalid={submitted && !!whenError}
          />
          <FieldError>{submitted ? whenError : null}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="appt-topic">{t('topic')}</Label>
          <Textarea
            id="appt-topic"
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t('topicPlaceholder')}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={onSubmit} loading={pending}>
            {t('submit')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
