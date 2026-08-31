'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, GraduationCap, Inbox, MapPin, User } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../../../shared/ui'
import { examKeys, fetchExams, type ExamItem } from '../../../entities/exam'
import { EXAM_STATUS_BADGE, EXAM_STATUS_KEY, examFormatKey } from '../lib/visuals'

// Экзамены и сессия студента (задача 11): timeline с допуском, статусом и результатом.
export function StudentExamsView() {
  const t = useTranslations('Exams')
  const q = useQuery({ queryKey: examKeys.list(), queryFn: () => fetchExams() })

  const now = Date.now()
  const { upcoming, past } = useMemo(() => {
    const list = q.data ?? []
    return {
      upcoming: list.filter((e) => new Date(e.date).getTime() >= now),
      past: list.filter((e) => new Date(e.date).getTime() < now),
    }
  }, [q.data, now])

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('myTitle')} />

      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : q.isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={<GraduationCap />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <>
          {upcoming.length > 0 && (
            <Section title={t('upcoming')}>
              {upcoming.map((e) => (
                <ExamCard key={e.id} exam={e} />
              ))}
            </Section>
          )}
          {past.length > 0 && (
            <Section title={t('past')}>
              {past.map((e) => (
                <ExamCard key={e.id} exam={e} />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-heading text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function ExamCard({ exam: e }: { exam: ExamItem }) {
  const t = useTranslations('Exams')
  const locale = useLocale()
  const r = e.myResult
  const d = new Date(e.date)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-heading text-base font-semibold">
              {e.course.subject.name}
            </h3>
            <span className="text-xs text-muted-foreground">{t(examFormatKey(e.format))}</span>
          </div>
          {r && <Badge variant={EXAM_STATUS_BADGE[r.status]}>{t(EXAM_STATUS_KEY[r.status])}</Badge>}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-4" aria-hidden />
            {d.toLocaleString(locale, {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {e.room && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" aria-hidden />
              {e.room.name}
            </span>
          )}
          {e.examiner && (
            <span className="inline-flex items-center gap-1.5">
              <User className="size-4" aria-hidden />
              {e.examiner.firstName} {e.examiner.lastName}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {r ? (
            <Badge variant={r.admitted ? 'success' : 'destructive'}>
              {r.admitted ? t('admitted') : t('notAdmitted')}
            </Badge>
          ) : (
            <Badge variant="secondary">{t('admissionPending')}</Badge>
          )}
          {r?.score != null && (
            <span className="text-sm font-semibold tabular-nums">
              {r.score}
              {e.maxScore != null ? ` / ${e.maxScore}` : ''}
            </span>
          )}
          {r && r.attempt > 1 && <Badge variant="info">{t('attemptN', { n: r.attempt })}</Badge>}
        </div>
      </CardContent>
    </Card>
  )
}
