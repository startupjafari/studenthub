'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { CalendarDays, MapPin, Users, Video } from 'lucide-react'
import { CAREER_EVENT_KINDS, type CareerEventKind } from '@studenthub/shared-schemas'
import { careerEventKeys, fetchCareerEvents } from '../../../entities/career-event'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  SegmentedTabs,
  Skeleton,
  TablePagination,
} from '../../../shared/ui'

/**
 * Карьерные мероприятия — те же события вуза с признаком карьерного типа. Отдельного
 * календаря нет намеренно: регистрация и напоминания живут в домене «События».
 */
export function CareerEventsView() {
  const t = useTranslations('CareerEvents')
  const tErr = useTranslations('Errors')
  const format = useFormatter()
  const [kind, setKind] = useState<CareerEventKind | null>(null)
  const [past, setPast] = useState(false)
  const [page, setPage] = useState(1)
  const limit = 20

  const params = { page, limit, past, ...(kind ? { kind } : {}) }
  const query = useQuery({
    queryKey: careerEventKeys.list(params),
    queryFn: () => fetchCareerEvents(params),
  })

  const kindLabel: Record<CareerEventKind, string> = {
    CAREER_FAIR: t('kindFair'),
    WORKSHOP: t('kindWorkshop'),
    INTERVIEW_DAY: t('kindInterviewDay'),
    COMPANY_PRESENTATION: t('kindPresentation'),
    HACKATHON: t('kindHackathon'),
  }

  const rows = query.data?.items ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        tabs={
          <SegmentedTabs<'upcoming' | 'past'>
            aria-label={t('title')}
            items={[
              { value: 'upcoming', label: t('upcoming') },
              { value: 'past', label: t('past') },
            ]}
            value={past ? 'past' : 'upcoming'}
            onChange={(v) => {
              setPast(v === 'past')
              setPage(1)
            }}
          />
        }
      />

      <div className="flex flex-wrap gap-2">
        {CAREER_EVENT_KINDS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={kind === value ? 'default' : 'outline'}
            onClick={() => {
              setKind(kind === value ? null : value)
              setPage(1)
            }}
          >
            {kindLabel[value]}
          </Button>
        ))}
      </div>

      {query.isLoading ? (
        <ul className="flex flex-col gap-2" aria-busy>
          {['66%', '50%'].map((w) => (
            <li key={w} className="rounded-xl border border-border p-4">
              <Skeleton className="h-4 rounded-md" style={{ width: w }} />
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        // Ошибку показываем именно ошибкой: 403 или обрыв сети, отрисованные как
        // «пусто», выглядят как «данных нет» и прячут настоящую причину.
        <EmptyState title={tErr('INTERNAL_ERROR')} description={tErr('retryHint')} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="size-6" aria-hidden />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {event.careerKind && (
                      <Badge variant="outline">{kindLabel[event.careerKind]}</Badge>
                    )}
                    <p className="font-semibold">{event.title}</p>
                    {event.registered && <Badge variant="secondary">{t('registered')}</Badge>}
                  </div>
                  <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="size-3.5" aria-hidden />
                      {format.dateTime(new Date(event.startsAt), {
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {event.isOnline ? (
                      <span className="flex items-center gap-1">
                        <Video className="size-3.5" aria-hidden />
                        {t('online')}
                      </span>
                    ) : (
                      event.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3.5" aria-hidden />
                          {event.location}
                        </span>
                      )
                    )}
                    <span className="flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden />
                      {event.participantsCount}
                    </span>
                  </p>
                  <p className="max-w-prose text-sm text-muted-foreground">{event.description}</p>
                </div>
              </li>
            ))}
          </ul>
          <TablePagination
            page={page}
            limit={limit}
            total={query.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}
