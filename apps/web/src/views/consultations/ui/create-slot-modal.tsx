'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CreateSlotSchema } from '@studenthub/shared-schemas'
import { Button, Checkbox, DateTimePicker, Input, Label, Modal } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { consultationKeys, createSlotRequest } from '../../../entities/consultation'

// Модалка создания слота приёма (преподаватель).
export function CreateSlotModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Consultations')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal] = useState('')
  const [location, setLocation] = useState('')
  const [isOnline, setIsOnline] = useState(false)
  const [pending, setPending] = useState(false)

  async function onSubmit() {
    const payload = {
      startsAt: startLocal ? new Date(startLocal).toISOString() : '',
      endsAt: endLocal ? new Date(endLocal).toISOString() : '',
      ...(location.trim() ? { location: location.trim() } : {}),
      isOnline,
    }
    const parsed = CreateSlotSchema.safeParse(payload)
    if (!parsed.success) {
      toast.error(t('formInvalid'))
      return
    }
    setPending(true)
    try {
      await createSlotRequest(parsed.data)
      await qc.invalidateQueries({ queryKey: consultationKeys.mine() })
      toast.success(t('slotCreated'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal onClose={onClose} title={t('newSlot')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t('startsAt')}</Label>
          <DateTimePicker value={startLocal} onChange={setStartLocal} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t('endsAt')}</Label>
          <DateTimePicker value={endLocal} onChange={setEndLocal} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slot-loc">{t('location')}</Label>
          <Input
            id="slot-loc"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t('locationPlaceholder')}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isOnline} onCheckedChange={(v) => setIsOnline(v === true)} />
          {t('online')}
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={onSubmit} loading={pending} disabled={!startLocal || !endLocal}>
            {t('create')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
