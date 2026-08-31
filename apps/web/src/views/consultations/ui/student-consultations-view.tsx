'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CalendarClock, ChevronRight, MapPin, MessagesSquare, Video } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  consultationKeys,
  fetchConsultationTeachers,
  fetchMyConsultations,
  fetchTeacherSlots,
  cancelSlotRequest,
  type ConsultationSlot,
} from '../../../entities/consultation'
import { BookSlotModal } from './book-slot-modal'

function slotTime(locale: string, s: ConsultationSlot): string {
  const start = new Date(s.startsAt)
  const end = new Date(s.endsAt)
  return `${start.toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
}

// «Консультации» студента (задача 15): мои записи + запись к преподавателю.
export function StudentConsultationsView() {
  const t = useTranslations('Consultations')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const [teacher, setTeacher] = useState<{ id: string; name: string } | null>(null)
  const [bookSlot, setBookSlot] = useState<ConsultationSlot | null>(null)

  const mine = useQuery({
    queryKey: consultationKeys.mine(),
    queryFn: () => fetchMyConsultations(),
  })
  const teachers = useQuery({
    queryKey: consultationKeys.teachers(),
    queryFn: () => fetchConsultationTeachers(),
  })
  const teacherSlots = useQuery({
    queryKey: consultationKeys.teacherSlots(teacher?.id ?? ''),
    queryFn: () => fetchTeacherSlots(teacher!.id),
    enabled: !!teacher,
  })

  const cancel = useMutation({
    mutationFn: (id: string) => cancelSlotRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.all })
      toast.success(t('cancelled'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  // Экран слотов преподавателя.
  if (teacher) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
        <PageHeader
          title={teacher.name}
          subtitle={t('pickSlot')}
          onBack={() => setTeacher(null)}
          backLabel={t('back')}
        />
        {teacherSlots.isLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : (teacherSlots.data ?? []).length === 0 ? (
          <EmptyState
            icon={<CalendarClock />}
            title={t('noSlots')}
            description={t('noSlotsHint')}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {(teacherSlots.data ?? []).map((s) => (
              <li key={s.id}>
                <Card>
                  <CardContent className="flex items-center gap-3 p-3.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{slotTime(locale, s)}</span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
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
                      </span>
                    </span>
                    {s.status === 'BOOKED' && s.student ? (
                      <Button variant="outline" size="sm" onClick={() => cancel.mutate(s.id)}>
                        {t('cancelBooking')}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => setBookSlot(s)}>
                        {t('book')}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {bookSlot && <BookSlotModal slot={bookSlot} onClose={() => setBookSlot(null)} />}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('myBookings')}</CardTitle>
        </CardHeader>
        <CardContent>
          {mine.isLoading ? (
            <Skeleton className="h-16 w-full rounded-lg" />
          ) : (mine.data ?? []).length === 0 ? (
            <EmptyState title={t('noBookings')} className="border-0 p-6" />
          ) : (
            <ul className="flex flex-col gap-2">
              {(mine.data ?? []).map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {s.teacher.firstName} {s.teacher.lastName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {slotTime(locale, s)}
                    </span>
                    {s.topic && (
                      <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <MessagesSquare className="size-3" aria-hidden />
                        {s.topic}
                      </span>
                    )}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => cancel.mutate(s.id)}>
                    {t('cancelBooking')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('bookWithTeacher')}</CardTitle>
        </CardHeader>
        <CardContent>
          {teachers.isLoading ? (
            <Skeleton className="h-16 w-full rounded-lg" />
          ) : (teachers.data ?? []).length === 0 ? (
            <EmptyState title={t('noTeachers')} className="border-0 p-6" />
          ) : (
            <ul className="flex flex-col gap-1">
              {(teachers.data ?? []).map((tc) => (
                <li key={tc.teacherId}>
                  <button
                    type="button"
                    onClick={() =>
                      setTeacher({ id: tc.teacherId, name: `${tc.firstName} ${tc.lastName}` })
                    }
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted/50"
                  >
                    <Avatar className="size-9">
                      <AvatarImage src={tc.avatarUrl ?? undefined} alt="" />
                      <AvatarFallback>
                        {tc.firstName[0]}
                        {tc.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {tc.firstName} {tc.lastName}
                    </span>
                    <Badge variant="secondary">{t('slotsN', { n: tc.openSlots })}</Badge>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
