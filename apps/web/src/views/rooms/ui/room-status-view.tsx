'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import {
  Building2,
  CalendarX2,
  Clock,
  DoorClosed,
  DoorOpen,
  Info,
  Keyboard,
  Layers,
  Phone,
  RefreshCw,
  ScanLine,
  Tag,
  Users,
} from 'lucide-react'
import {
  buildRoomStatus,
  fetchRoomStatus,
  roomKeys,
  type RoomPair,
  type RoomStatus,
  type RoomStatusResponse,
} from '../../../entities/room'
import type { DayPair } from '../../../entities/schedule'
import {
  Badge,
  Button,
  Card,
  CardContent,
  PageHeader,
  SectionPanel,
  Skeleton,
  StatusScreen,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useAppSelector } from '../../../shared/store'
import { ROLE_HOME } from '../../../shared/config'

// Ф16: что видит студент, отсканировав QR над дверью. Открывается с телефона в коридоре,
// поэтому главное — ответ «свободно / занято» первым блоком под шапкой. Экран живёт в общей
// оболочке и собран из тех же частей, что остальные: шапка страницы, панели, сетка. На
// телефоне колонки встают друг под друга — сначала статус, потом сведения о помещении.
//
// Обновление раз в минуту: пара заканчивается в известное время, но студент может держать
// страницу открытой, стоя у двери.
const REFRESH_MS = 60_000

type RoomStatusRoom = RoomStatusResponse['room']

export function RoomStatusView({ code }: { code: string }) {
  const t = useTranslations('Rooms')
  const tCommon = useTranslations('Common')
  const router = useRouter()
  const role = useAppSelector((s) => s.auth.role)

  // Назад — туда, откуда пришли (сканер, список помещений). Но страницу часто открывает
  // камера телефона прямо с наклейки: истории нет, и `router.back()` ничего бы не сделал —
  // тогда ведём на главную роли.
  function goBack(): void {
    if (window.history.length > 1) router.back()
    else router.push(role ? ROLE_HOME[role] : '/')
  }

  const query = useQuery({
    queryKey: roomKeys.status(code),
    queryFn: () => fetchRoomStatus(code),
    refetchInterval: REFRESH_MS,
    retry: false,
  })

  if (query.isPending) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        <Skeleton className="h-14 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
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
  const room = data.room

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader
        onBack={goBack}
        backLabel={tCommon('goBack')}
        title={room.name}
        subtitle={`${t(`kind.${room.kind}`)} · ${room.universityShort ?? room.university}`}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {t('updatedAt', { time: data.now.time })}
            </span>
            <Button
              variant="outline"
              size="md"
              icon
              onClick={() => void query.refetch()}
              loading={query.isFetching}
              aria-label={t('refresh')}
            >
              <RefreshCw className="size-4" aria-hidden />
            </Button>
          </div>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <OccupancyHero status={status} />

          {status.current && <PairCard dayPair={status.current} variant="current" />}
          {!status.current && status.next && <PairCard dayPair={status.next} variant="next" />}

          {/* Остаток дня — чтобы понять, когда помещение освободится или снова занято. */}
          {data.academic && status.day.length > 0 && (
            <SectionPanel title={t('todayTitle')} subtitle={t('todayHint')} bodyClassName="p-0">
              <ul className="flex flex-col divide-y divide-border">
                {status.day.map((dp) => (
                  <DayRow key={dp.pair.id} dayPair={dp} />
                ))}
              </ul>
            </SectionPanel>
          )}
        </div>

        <AboutPanel room={room} />
      </div>
    </div>
  )
}

// Главный ответ: свободно / занято / (для неучебных) подсказка про часы работы. Левое
// выравнивание и иконка — как у остальных карточек системы, цвет — по состоянию.
function OccupancyHero({ status }: { status: RoomStatus }) {
  const t = useTranslations('Rooms')

  if (status.occupancy === 'unknown') {
    // Назначение помещения уже написано в шапке — не повторяем его здесь.
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center gap-4 py-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <DoorOpen className="size-6" aria-hidden />
          </span>
          <p className="text-sm text-muted-foreground">{t('serviceRoomHint')}</p>
        </CardContent>
      </Card>
    )
  }

  const busy = status.occupancy === 'busy'
  const Icon = busy ? DoorClosed : DoorOpen
  return (
    <Card className={busy ? 'border-warning/40 bg-warning/10' : 'border-success/40 bg-success/10'}>
      <CardContent className="flex items-center gap-4 py-5">
        <span
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-full',
            busy ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success',
          )}
        >
          <Icon className="size-6" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p
            className={cn(
              'font-heading text-2xl font-bold tracking-tight',
              busy ? 'text-warning' : 'text-success',
            )}
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
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Сведения о помещении — одной панелью справа: где оно, сколько мест, как работает.
 * Раньше корпус, этаж и места были мелкой строкой под названием, а часы работы и телефон —
 * отдельной карточкой только у неучебных помещений.
 */
function AboutPanel({ room }: { room: RoomStatusRoom }) {
  const t = useTranslations('Rooms')
  const rows: { key: string; icon: typeof Clock; label: string; value: ReactNode }[] = [
    { key: 'kind', icon: Tag, label: t('kindLabel'), value: t(`kind.${room.kind}`) },
  ]
  if (room.building) {
    rows.push({ key: 'building', icon: Building2, label: t('building'), value: room.building })
  }
  if (room.floor !== null) {
    rows.push({ key: 'floor', icon: Layers, label: t('floor'), value: room.floor })
  }
  if (room.capacity !== null) {
    rows.push({
      key: 'capacity',
      icon: Users,
      label: t('capacity'),
      value: t('capacityValue', { value: room.capacity }),
    })
  }
  if (room.openHours) {
    rows.push({ key: 'hours', icon: Clock, label: t('openHours'), value: room.openHours })
  }
  if (room.phone) {
    rows.push({
      key: 'phone',
      icon: Phone,
      label: t('phone'),
      value: (
        <a className="text-primary hover:underline" href={`tel:${room.phone}`}>
          {room.phone}
        </a>
      ),
    })
  }
  if (room.info) {
    rows.push({ key: 'info', icon: Info, label: t('info'), value: room.info })
  }

  return (
    <SectionPanel title={t('aboutTitle')} subtitle={t('aboutHint')}>
      <dl className="flex flex-col gap-3 py-1">
        {rows.map((r) => (
          <InfoRow key={r.key} icon={r.icon} label={r.label} value={r.value} />
        ))}
      </dl>
    </SectionPanel>
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
    <li
      className={cn(
        'flex items-center gap-4 px-4 py-3',
        dayPair.isCurrent && 'bg-primary/5',
        dayPair.state === 'past' && 'opacity-60',
      )}
    >
      <span className="w-24 shrink-0 text-sm text-muted-foreground tabular-nums">
        {start}–{end}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium', cancelled && 'line-through')}>
          {dayPair.pair.subject}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[
            dayPair.pair.group?.name,
            dayPair.pair.teacher &&
              `${dayPair.pair.teacher.lastName} ${dayPair.pair.teacher.firstName}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      {dayPair.isCurrent && <Badge>{t('nowLabel')}</Badge>}
      {cancelled && (
        <Badge variant="secondary" className="gap-1">
          <CalendarX2 className="size-3" aria-hidden />
          {t('cancelled')}
        </Badge>
      )}
    </li>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock
  label: string
  value: ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium break-words">{value}</dd>
      </div>
    </div>
  )
}
