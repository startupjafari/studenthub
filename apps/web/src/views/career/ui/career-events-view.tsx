'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { CalendarDays, MapPin, Users, Video } from 'lucide-react'
import {
  ADMIN_PAGE_SIZES,
  CAREER_EVENT_KINDS,
  type CareerEventKind,
} from '@studenthub/shared-schemas'
import { careerEventKeys, fetchCareerEvents } from '../../../entities/career-event'
import {
  CareerUniversityRequired,
  useCareerUniversity,
} from '../../../features/career-university-scope'
import { toApiError } from '../../../shared/lib'
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SegmentedTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
} from '../../../shared/ui'

/**
 * Карьерные мероприятия — те же события вуза с признаком карьерного типа. Отдельного
 * календаря нет намеренно: регистрация и напоминания живут в домене «События».
 */
// Ширины колонок: название с описанием — главное, место и тип сжимаются первыми.
// Размеры страницы — общий для админских экранов набор из контракта.
const PAGE_SIZES = ADMIN_PAGE_SIZES

const COLS = ['34%', '14%', '18%', '22%', '12%'] as const

export function CareerEventsView() {
  const t = useTranslations('CareerEvents')
  const tErr = useTranslations('Errors')
  const format = useFormatter()
  const [kind, setKind] = useState<CareerEventKind | null>(null)
  const [past, setPast] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])

  // Платформенная роль смотрит карьерный центр конкретного вуза — до выбора запрос
  // ушёл бы в заведомый WRONG_SCOPE, поэтому он просто не стартует.
  const { needsPick, universityId } = useCareerUniversity()
  const params = {
    page,
    limit,
    past,
    ...(kind ? { kind } : {}),
    ...(universityId ? { universityId } : {}),
  }
  const query = useQuery({
    queryKey: careerEventKeys.list(params),
    queryFn: () => fetchCareerEvents(params),
    enabled: !needsPick || !!universityId,
    // Прошлая страница остаётся на экране, пока грузится новая.
    placeholderData: keepPreviousData,
  })

  const kindLabel: Record<CareerEventKind, string> = {
    CAREER_FAIR: t('kindFair'),
    WORKSHOP: t('kindWorkshop'),
    INTERVIEW_DAY: t('kindInterviewDay'),
    COMPANY_PRESENTATION: t('kindPresentation'),
    HACKATHON: t('kindHackathon'),
  }

  const rows = query.data?.items ?? []

  // Новый фильтр или размер страницы — снова с первой: на прежней странице
  // отфильтрованного списка может не быть строк вовсе.
  function refilter(apply: () => void): void {
    apply()
    setPage(1)
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
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
            onChange={(v) => refilter(() => setPast(v === 'past'))}
          />
        }
        actions={
          <Select
            value={kind ?? 'all'}
            onValueChange={(v) =>
              refilter(() => setKind(v === 'all' ? null : (v as CareerEventKind)))
            }
          >
            <SelectTrigger size="md" className="w-52" aria-label={t('colKind')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('kindAll')}</SelectItem>
              {CAREER_EVENT_KINDS.map((value) => (
                <SelectItem key={value} value={value}>
                  {kindLabel[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {needsPick && !universityId ? (
        <CareerUniversityRequired />
      ) : query.isError ? (
        // Ошибку показываем именно ошибкой: 403 или обрыв сети, отрисованные как
        // «пусто», выглядят как «данных нет» и прячут настоящую причину.
        <EmptyState title={tErr(toApiError(query.error).code)} description={tErr('retryHint')} />
      ) : rows.length === 0 && !query.isLoading ? (
        <EmptyState
          icon={<CalendarDays className="size-6" aria-hidden />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <>
          <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
            <Table fixed scrollBody fill cols={COLS}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colEvent')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('colKind')}</TableHead>
                  <TableHead>{t('colWhen')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('colPlace')}</TableHead>
                  <TableHead numeric>{t('colParticipants')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading && <TableSkeletonRows columns={5} />}
                {rows.map((event) => (
                  <TableRow key={event.id} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <TableText value={event.title} />
                        {event.registered && (
                          <Badge variant="secondary" className="shrink-0">
                            {t('registered')}
                          </Badge>
                        )}
                      </span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {event.description}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {event.careerKind ? (
                        <Badge variant="outline">{kindLabel[event.careerKind]}</Badge>
                      ) : (
                        <TableText value={null} />
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format.dateTime(new Date(event.startsAt), {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {/* Онлайн и адрес — одно и то же поле «где», просто разной природы. */}
                      {event.isOnline ? (
                        <span className="flex items-center gap-1">
                          <Video className="size-3.5 shrink-0" aria-hidden />
                          {t('online')}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          {event.location && <MapPin className="size-3.5 shrink-0" aria-hidden />}
                          <TableText value={event.location} />
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      <span className="flex items-center justify-end gap-1">
                        <Users className="size-3.5 shrink-0" aria-hidden />
                        {event.participantsCount}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              page={page}
              limit={limit}
              total={query.data?.total ?? 0}
              onPageChange={setPage}
              limitOptions={PAGE_SIZES}
              onLimitChange={(n) => refilter(() => setLimit(n))}
            />
          </Card>
        </>
      )}
    </div>
  )
}
