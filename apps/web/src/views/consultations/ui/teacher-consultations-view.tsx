'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CalendarClock, MapPin, MessagesSquare, Plus, Trash2, Video } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  consultationKeys,
  fetchMyConsultations,
  deleteSlotRequest,
  cancelSlotRequest,
  type ConsultationSlot,
  type ConsultationStatus,
} from '../../../entities/consultation'
import { CreateSlotModal } from './create-slot-modal'

const STATUS_BADGE: Record<ConsultationStatus, 'secondary' | 'success' | 'outline'> = {
  OPEN: 'secondary',
  BOOKED: 'success',
  CANCELLED: 'outline',
}

function slotTime(locale: string, s: ConsultationSlot): string {
  const start = new Date(s.startsAt)
  const end = new Date(s.endsAt)
  return `${start.toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
}

// «Консультации» преподавателя (задача 15): создание слотов + записи студентов.
export function TeacherConsultationsView() {
  const t = useTranslations('Consultations')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [creating, setCreating] = useState(false)

  const q = useQuery({ queryKey: consultationKeys.mine(), queryFn: () => fetchMyConsultations() })

  const remove = useMutation({
    mutationFn: (id: string) => deleteSlotRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.all })
      toast.success(t('slotDeleted'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => cancelSlotRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.all })
      toast.success(t('cancelled'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  async function onRemove(s: ConsultationSlot) {
    const ok = await confirm({
      title: t('confirmDelete'),
      description: slotTime(locale, s),
      destructive: true,
    })
    if (ok) remove.mutate(s.id)
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('manageTitle')}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('newSlot')}
          </Button>
        }
      />

      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title={t('manageEmpty')}
          description={t('manageEmptyHint')}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(q.data ?? []).map((s) => (
            <li key={s.id}>
              <Card>
                <CardContent className="flex items-center gap-3 p-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {slotTime(locale, s)}
                      <Badge variant={STATUS_BADGE[s.status]}>{t(`status.${s.status}`)}</Badge>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {s.isOnline ? (
                        <span className="inline-flex items-center gap-1">
                          <Video className="size-3" aria-hidden />
                          {t('online')}
                        </span>
                      ) : (
                        s.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3" aria-hidden />
                            {s.location}
                          </span>
                        )
                      )}
                      {s.student && (
                        <span className="font-medium text-foreground">
                          {s.student.firstName} {s.student.lastName}
                        </span>
                      )}
                      {s.topic && (
                        <span className="inline-flex items-center gap-1">
                          <MessagesSquare className="size-3" aria-hidden />
                          {s.topic}
                        </span>
                      )}
                    </span>
                  </span>
                  {s.status === 'BOOKED' ? (
                    <Button variant="outline" size="sm" onClick={() => cancel.mutate(s.id)}>
                      {t('cancelSlot')}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      aria-label={t('delete')}
                      onClick={() => onRemove(s)}
                    >
                      <Trash2 className="size-4 text-muted-foreground" aria-hidden />
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {creating && <CreateSlotModal onClose={() => setCreating(false)} />}
    </div>
  )
}
