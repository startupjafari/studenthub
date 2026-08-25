'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CalendarClock, MapPin, Video } from 'lucide-react'
import { Button, Label, Modal, Textarea } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  consultationKeys,
  bookSlotRequest,
  type ConsultationSlot,
} from '../../../entities/consultation'

// Модалка записи на консультацию (студент): тема + подтверждение.
export function BookSlotModal({ slot, onClose }: { slot: ConsultationSlot; onClose: () => void }) {
  const t = useTranslations('Consultations')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const [topic, setTopic] = useState('')
  const [pending, setPending] = useState(false)

  async function onSubmit() {
    setPending(true)
    try {
      await bookSlotRequest(slot.id, { topic: topic.trim() || undefined })
      qc.invalidateQueries({ queryKey: consultationKeys.all })
      toast.success(t('booked'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    } finally {
      setPending(false)
    }
  }

  const start = new Date(slot.startsAt)
  const end = new Date(slot.endsAt)

  return (
    <Modal onClose={onClose} title={t('bookTitle')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3 text-sm">
          <span className="font-medium">
            {slot.teacher.firstName} {slot.teacher.lastName}
          </span>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <CalendarClock className="size-4" aria-hidden />
            {start.toLocaleString(locale, {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {' – '}
            {end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
          </span>
          {slot.isOnline ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Video className="size-4" aria-hidden />
              {t('online')}
            </span>
          ) : (
            slot.location && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <MapPin className="size-4" aria-hidden />
                {slot.location}
              </span>
            )
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="book-topic">{t('topic')}</Label>
          <Textarea
            id="book-topic"
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
            {t('book')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
