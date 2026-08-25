'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ConfirmAppointmentSchema } from '@studenthub/shared-schemas'
import { Button, DateTimePicker, FieldError, Label, Modal, Textarea } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  appointmentKeys,
  confirmAppointmentRequest,
  rescheduleAppointmentRequest,
} from '../../../entities/appointment'

interface Props {
  appointmentId: string
  mode: 'confirm' | 'reschedule'
  onClose: () => void
}

// Модалка подтверждения/переноса записи (деканат): назначить время + комментарий.
export function ConfirmAppointmentModal({ appointmentId, mode, onClose }: Props) {
  const t = useTranslations('Appointments')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [whenLocal, setWhenLocal] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const whenError = !whenLocal ? tCommon('dateRequired') : null

  async function onSubmit() {
    setSubmitted(true)
    if (whenError) return
    const payload = {
      scheduledAt: whenLocal ? new Date(whenLocal).toISOString() : '',
      ...(note.trim() ? { staffNote: note.trim() } : {}),
    }
    const parsed = ConfirmAppointmentSchema.safeParse(payload)
    if (!parsed.success) {
      toast.error(t('formInvalid'))
      return
    }
    setPending(true)
    try {
      if (mode === 'confirm') await confirmAppointmentRequest(appointmentId, parsed.data)
      else await rescheduleAppointmentRequest(appointmentId, parsed.data)
      await qc.invalidateQueries({ queryKey: appointmentKeys.all })
      toast.success(mode === 'confirm' ? t('confirmed') : t('rescheduled'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal onClose={onClose} title={mode === 'confirm' ? t('confirmTitle') : t('rescheduleTitle')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t('scheduledTime')}</Label>
          <DateTimePicker
            value={whenLocal}
            onChange={setWhenLocal}
            aria-invalid={submitted && !!whenError}
          />
          <FieldError>{submitted ? whenError : null}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="appt-note">{t('staffNote')}</Label>
          <Textarea
            id="appt-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={onSubmit} loading={pending}>
            {t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
