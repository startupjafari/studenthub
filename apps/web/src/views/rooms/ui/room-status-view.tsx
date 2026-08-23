'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Building2,
  CalendarX2,
  Clock,
  DoorOpen,
  Info,
  Keyboard,
  Layers,
  Phone,
  RefreshCw,
  ScanLine,
  Users,
} from 'lucide-react'
import {
  buildRoomStatus,
  fetchRoomStatus,
  roomKeys,
  type RoomPair,
  type RoomStatus,
} from '../../../entities/room'
import type { DayPair } from '../../../entities/schedule'
import { Badge, Button, Card, CardContent, Skeleton, StatusScreen } from '../../../shared/ui'

// Ф16: что видит студент, отсканировав QR над дверью. Экран-«киоск»: открывается с телефона
// в коридоре, поэтому главное — крупный ответ «свободно / занято» в первом экране,
// без прокрутки и без лишних действий.
//
// Обновление раз в минуту: пара заканчивается в известное время, но студент может держать
// страницу открытой, стоя у двери.
const REFRESH_MS = 60_000

export function RoomStatusView({ code }: { code: string }) {
  const t = useTranslations('Rooms')

  const query = useQuery({
    queryKey: roomKeys.status(code),
    queryFn: () => fetchRoomStatus(code),
    refetchInterval: REFRESH_MS,
    retry: false,
  })

  if (query.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4">
        <Skeleton className="h-28 w-full rounded-3xl" />
        <Skeleton className="h-40 w-full rounded-3xl" />
        <Skeleton className="h-24 w-full rounded-3xl" />
      </div>
    )
  }

  if (query.isError || !query.data) {
    return (
      <StatusScreen
        icon={ScanLine}
        title={t('notFoundTitle')}
        description={t('notFoundDesc')}
        onRetry={() => void query.refetch()}
        showHome
        // Неверно прочитанный с наклейки код — самая частая причина попасть сюда,
        // поэтому даём набрать его руками, а не только «на главную».
        action={{ href: '/r', label: t('manualCta'), icon: Keyboard }}
      />
    )
  }

  const data = query.data
  const status = buildRoomStatus(data)

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 pb-10">
      {/* Шапка: где я нахожусь. */}
      <header className="flex flex-col gap-1 pt-2 text-center">
        <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {data.room.universityShort ?? data.room.university}
        </p>
        <h1 className="text-4xl font-bold tracking-tight">{data.room.name}</h1>
        <p className="text-sm text-muted-foreground">{t(`kind.${data.room.kind}`)}</p>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
          {data.room.building && (
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3.5" aria-hidden />
              {t('buildingValue', { value: data.room.building })}
            </span>
          )}
          {data.room.floor !== null && (
            <span className="inline-flex items-center gap-1">
              <Layers className="size-3.5" aria-hidden />
              {t('floorValue', { value: data.room.floor })}
            </span>
          )}
          {data.room.capacity !== null && (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden />
              {t('capacityValue', { value: data.room.capacity })}
            </span>
          )}
        </div>
      </header>

      <OccupancyHero status={status} />

      {status.current && <PairCard dayPair={status.current} variant="current" />}
      {!status.current && status.next && <PairCard dayPair={status.next} variant="next" />}

      {/* Неучебные помещения: расписания пар нет — показываем режим работы и контакт. */}
      {!data.academic && (
        <Card>
          <CardContent className="flex flex-col gap-3 py-5">
            {data.room.openHours && (
              <InfoRow icon={Clock} label={t('openHours')} value={data.room.openHours} />
            )}
            {data.room.phone && (
              <InfoRow
                icon={Phone}
                label={t('phone')}
                value={
                  <a className="text-primary underline" href={`tel:${data.room.phone}`}>
                    {data.room.phone}
                  </a>
                }
              />
            )}
            {data.room.info && <InfoRow icon={Info} label={t('info')} value={data.room.info} />}
            {!data.room.openHours && !data.room.phone && !data.room.info && (
              <p className="text-sm text-muted-foreground">{t('noInfo')}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Остаток дня — чтобы понять, когда аудитория освободится или снова занята. */}
      {data.academic && status.day.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold text-muted-foreground">{t('todayTitle')}</h2>
          {status.day.map((dp) => (
            <DayRow key={dp.pair.id} dayPair={dp} />
          ))}
        </section>
      )}

      <footer className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
        <span>{t('updatedAt', { time: data.now.time })}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void query.refetch()}
          loading={query.isFetching}
          aria-label={t('refresh')}
        >
          <RefreshCw className="size-3.5" aria-hidden />
        </Button>
      </footer>
    </main>
  )
}

// Главный ответ: свободно / занято / (для неучебных) подсказка про часы работы.
function OccupancyHero({ status }: { status: RoomStatus }) {
  const t = useTranslations('Rooms')

  if (status.occupancy === 'unknown') {
    // Назначение помещения уже написано в шапке под названием — не повторяем его здесь
    // (у «Библиотеки» это давало три одинаковых заголовка подряд).
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex flex-col items-center gap-2 py-7 text-center">
          <DoorOpen className="size-8 text-primary" aria-hidden />
          <p className="text-sm text-muted-foreground">{t('serviceRoomHint')}</p>
        </CardContent>
      </Card>
    )
  }

  const busy = status.occupancy === 'busy'
  return (
    <Card className={busy ? 'border-warning/40 bg-warning/10' : 'border-success/40 bg-success/10'}>
      <CardContent className="flex flex-col items-center gap-1 py-8 text-center">
        <p
          className={`text-3xl font-bold tracking-tight ${busy ? 'text-warning' : 'text-success'}`}
        >
          {busy ? t('busy') : t('free')}
        </p>
        <p className="text-sm text-muted-foreground">
          {busy && status.busyUntil
            ? t('busyUntil', { time: status.busyUntil })
            : status.freeUntil
              ? t('freeUntil', { time: status.freeUntil })
              : t('freeRestOfDay')}
        </p>
      </CardContent>
    </Card>
  )
}

function PairCard({
  dayPair,
  variant,
}: {
  dayPair: DayPair<RoomPair>
  variant: 'current' | 'next'
}) {
  const t = useTranslations('Rooms')
  const start = dayPair.change?.newStartTime ?? dayPair.pair.startTime
  const end = dayPair.change?.newEndTime ?? dayPair.pair.endTime

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-5">
        <div className="flex items-center justify-between gap-2">
          <Badge variant={variant === 'current' ? 'default' : 'secondary'}>
            {t(variant === 'current' ? 'nowLabel' : 'nextLabel')}
          </Badge>
          <span className="font-mono text-sm text-muted-foreground">
            {start}–{end}
          </span>
        </div>
        <p className="text-lg leading-snug font-semibold">{dayPair.pair.subject}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {/* Главный вопрос сканирующего: какая группа здесь сейчас. */}
          {dayPair.pair.group && (
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-4" aria-hidden />
              {dayPair.pair.group.name}
            </span>
          )}
          {dayPair.pair.teacher && (
            <span>
              {dayPair.pair.teacher.lastName} {dayPair.pair.teacher.firstName}
            </span>
          )}
        </div>
        {dayPair.change?.note && (
          <p className="text-xs text-muted-foreground">{dayPair.change.note}</p>
        )}
      </CardContent>
    </Card>
  )
}

function DayRow({ dayPair }: { dayPair: DayPair<RoomPair> }) {
  const t = useTranslations('Rooms')
  const cancelled = dayPair.state === 'cancelled'
  const start = dayPair.change?.newStartTime ?? dayPair.pair.startTime
  const end = dayPair.change?.newEndTime ?? dayPair.pair.endTime

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border border-border px-4 py-3 ${
        dayPair.isCurrent ? 'border-primary/40 bg-primary/5' : ''
      } ${dayPair.state === 'past' ? 'opacity-60' : ''}`}
    >
      <span className="font-mono text-xs text-muted-foreground">
        {start}
        <br />
        {end}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${cancelled ? 'line-through' : ''}`}>
          {dayPair.pair.subject}
        </p>
        <p className="truncate text-xs text-muted-foreground">{dayPair.pair.group?.name ?? '—'}</p>
      </div>
      {cancelled && (
        <Badge variant="secondary" className="gap-1">
          <CalendarX2 className="size-3" aria-hidden />
          {t('cancelled')}
        </Badge>
      )}
    </div>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm break-words">{value}</p>
      </div>
    </div>
  )
}
