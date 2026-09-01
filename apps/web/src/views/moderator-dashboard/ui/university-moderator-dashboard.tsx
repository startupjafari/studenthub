'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, CheckCheck, Clock, Flame, ScrollText, ShieldAlert, UserX } from 'lucide-react'
import {
  Button,
  EmptyState,
  MetricTile,
  PageHeader,
  SectionPanel,
  Skeleton,
} from '../../../shared/ui'
import { ChartLegend, useChartTheme } from '../../../shared/ui/chart'
import { relativeTime } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  complaintKeys,
  complaintPriority,
  fetchComplaints,
  PRIORITY_STYLE,
  type ComplaintPriorityValue,
  type ComplaintTargetTypeValue,
} from '../../../entities/complaint'
import { adminUserKeys, fetchUsers } from '../../../entities/user'
import { auditKeys, fetchAudit } from '../../../entities/audit'

// Тяжёлый recharts — только на клиенте, со скелетоном (FRONTEND_RULES §4, §11).
// Опции у каждого вызова свои: SWC-трансформ next/dynamic читает их статически.
const BarChart = dynamic(() => import('../../../shared/ui/chart/bar-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-48 w-full" />,
})
const LineChart = dynamic(() => import('../../../shared/ui/chart/line-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
})

const QUEUE_HREF = '/moderator/university/complaints'
const USERS_HREF = '/moderator/university/users'
const AUDIT_HREF = '/moderator/university/audit'

// Сколько жалоб тянем на разбор агрегатов. Предел админских списков — 200 (AdminLimitSchema);
// очередь модерации вуза столько не набирает, а если наберёт — считаем по самым старым
// (запрос идёт `createdAt asc`), то есть по тому концу, который и требует внимания.
const SCAN_LIMIT = 200
const FLOW_DAYS = 14
const DAY_MS = 86_400_000
// Сколько строк показывают списки внизу. Число общее для обоих: панели стоят рядом в
// сетке, и разная длина списков читается как перекос, а не как «данных меньше».
const LIST_ROWS = 6

// Одна геометрия строки для обоих списков: ведущий элемент фиксированной ширины,
// растяжимая середина и колонка времени постоянной ширины. Заголовки начинаются, а
// времена заканчиваются на одной вертикали; `min-h` держит строки двух панелей на
// одной высоте, даже когда во второй строчке нечего показать.
const ROW_CLASS = 'flex min-h-13 items-center gap-3 py-2'
const TIME_CLASS = 'w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground'
// Ссылка «открыть раздел» в шапке панели: `self-center` — шапка выравнивает содержимое по
// верху (`items-start`), и мелкая ссылка вставала выше строки заголовка, а не против блока
// «заголовок + пояснение». Вертикальные отступы поднимают цель нажатия до 24px (WCAG 2.5.8),
// отрицательный внешний гасит прибавку, чтобы шапка не выросла.
const LINK_CLASS =
  '-my-1 flex shrink-0 items-center gap-1 self-center py-1 text-xs font-medium text-primary hover:underline'

// Ключи i18n — явными литералами, а не сборкой `t(\`target${x}\`)`: динамические ключи
// запрещены (FRONTEND_RULES §10) и не проверяются типами next-intl.
const TARGET_KEY: Record<ComplaintTargetTypeValue, string> = {
  POST: 'targetPOST',
  STORY: 'targetSTORY',
  COMMENT: 'targetCOMMENT',
  MESSAGE: 'targetMESSAGE',
  USER: 'targetUSER',
}
const PRIORITY_KEY: Record<ComplaintPriorityValue, string> = {
  HIGH: 'priorityHIGH',
  MEDIUM: 'priorityMEDIUM',
  LOW: 'priorityLOW',
}
// Порядок категорий на графике фиксирован: столбцы не должны прыгать при каждом обновлении.
const TARGET_ORDER: ComplaintTargetTypeValue[] = ['USER', 'MESSAGE', 'POST', 'STORY', 'COMMENT']

/** Начало суток по локальному времени — ключ для группировки по дням. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * Дашборд модератора вуза.
 *
 * Вместо плиток-ссылок (ровно тех же, что в сайдбаре) — состояние очереди модерации:
 * сколько ждёт, что горит, на что жалуются и что уже сделано. Всё считается из данных,
 * которые модератору и так доступны: `/complaints` (scope — свой вуз), `/users` и
 * `/audit` (модератору сервер отдаёт только его собственные действия, §11).
 * Отдельного агрегирующего эндпоинта под это нет, поэтому суммы считаются на клиенте
 * по первым 200 записям — на объёмах очереди вуза это вся выборка.
 */
export function UniversityModeratorDashboard() {
  const t = useTranslations('Moderation')
  const tNav = useTranslations('Nav')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const { palette } = useChartTheme()

  // Очередь: самые старые сверху — с них начинают разбор, ими же меряется просрочка.
  const pendingQuery = {
    status: 'PENDING',
    sort: 'createdAt',
    order: 'asc',
    limit: SCAN_LIMIT,
  } as const
  const pending = useQuery({
    queryKey: complaintKeys.list(pendingQuery),
    queryFn: () => fetchComplaints(pendingQuery),
  })

  // Точный счётчик «горящих»: очередь может не поместиться в одну страницу, и считать
  // HIGH по загруженным строкам значило бы занижать число. limit=1 — нужен только total.
  const highQuery = { status: 'PENDING', priority: 'HIGH', limit: 1 } as const
  const high = useQuery({
    queryKey: complaintKeys.list(highQuery),
    queryFn: () => fetchComplaints(highQuery),
  })

  // Свежие жалобы всех статусов — из них строится поток по дням.
  const recentQuery = { sort: 'createdAt', order: 'desc', limit: SCAN_LIMIT } as const
  const recent = useQuery({
    queryKey: complaintKeys.list(recentQuery),
    queryFn: () => fetchComplaints(recentQuery),
  })

  const blockedQuery = { blocked: true, limit: 1 } as const
  const blocked = useQuery({
    queryKey: adminUserKeys.list(blockedQuery),
    queryFn: () => fetchUsers(blockedQuery),
  })

  // Журнал модератору отдаётся только по его собственным действиям — это и есть
  // «что я сделал»: и лента, и счётчик разборов за неделю.
  const auditQuery = { limit: 100, sort: 'createdAt', order: 'desc' } as const
  const audit = useQuery({
    queryKey: auditKeys.list(auditQuery),
    queryFn: () => fetchAudit(auditQuery),
  })

  const pendingItems = useMemo(() => pending.data?.items ?? [], [pending.data])
  const recentItems = useMemo(() => recent.data?.items ?? [], [recent.data])
  const auditItems = useMemo(() => audit.data?.items ?? [], [audit.data])

  // Возраст очереди: до суток / 1–3 дня / больше трёх. Три корзины, а не среднее время
  // ожидания: среднее прячет ровно тот хвост, ради которого на график и смотрят.
  const aging = useMemo(() => {
    const now = Date.now()
    let fresh = 0
    let days = 0
    let older = 0
    for (const c of pendingItems) {
      const age = now - new Date(c.createdAt).getTime()
      if (age < DAY_MS) fresh += 1
      else if (age < 3 * DAY_MS) days += 1
      else older += 1
    }
    return { fresh, days, older }
  }, [pendingItems])
  // Просрочка — всё, что ждёт дольше суток.
  const overdue = aging.days + aging.older

  // На что жалуются — по категориям цели, только непустые: нулевой столбец говорит
  // «жалоб этого вида нет», и на графике сравнения величин он лишний.
  const targets = useMemo(() => {
    const counts = new Map<ComplaintTargetTypeValue, number>()
    for (const c of pendingItems) counts.set(c.targetType, (counts.get(c.targetType) ?? 0) + 1)
    return TARGET_ORDER.filter((k) => (counts.get(k) ?? 0) > 0).map((k) => ({
      key: k,
      value: counts.get(k) ?? 0,
    }))
  }, [pendingItems])

  // Поток за две недели: поступило (createdAt) против разобрано (resolvedAt). Считается по
  // тем же 200 свежим жалобам: разбор жалобы, поданной раньше этого окна, в «разобрано» не
  // попадёт — точный счётчик недели берётся из журнала (ниже), а график показывает форму потока.
  const flow = useMemo(() => {
    const today = startOfDay(new Date())
    const days = Array.from({ length: FLOW_DAYS }, (_, i) => today - (FLOW_DAYS - 1 - i) * DAY_MS)
    const index = new Map(days.map((d, i): [number, number] => [d, i]))
    const incoming = days.map(() => 0)
    const resolved = days.map(() => 0)
    const add = (row: number[], iso: string | null): void => {
      if (!iso) return
      const i = index.get(startOfDay(new Date(iso)))
      if (i !== undefined) row[i] = (row[i] ?? 0) + 1
    }
    for (const c of recentItems) {
      add(incoming, c.createdAt)
      add(resolved, c.resolvedAt)
    }
    return { days, incoming, resolved }
  }, [recentItems])

  // Разобрано за неделю — по журналу: в нём запись появляется в момент разбора,
  // поэтому счёт точный, тогда как страница жалоб отсортирована по дате подачи.
  const resolvedWeek = useMemo(() => {
    const since = Date.now() - 7 * DAY_MS
    return auditItems.filter(
      (a) => a.action === 'complaint_resolved' && new Date(a.createdAt).getTime() >= since,
    ).length
  }, [auditItems])

  const oldest = pendingItems.slice(0, LIST_ROWS)
  const actions = auditItems.slice(0, LIST_ROWS)
  const flowEmpty = flow.incoming.every((v) => v === 0) && flow.resolved.every((v) => v === 0)

  function dayLabel(ms: number): string {
    return new Date(ms).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
  }

  if (pending.isError) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader title={tNav('dashboard')} subtitle={t('dashSubtitle')} />
        <EmptyState
          icon={<ShieldAlert className="size-6" aria-hidden />}
          title={tErr('INTERNAL_ERROR')}
          action={<Button onClick={() => pending.refetch()}>{t('dashRetry')}</Button>}
        />
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title={tNav('dashboard')} subtitle={t('dashSubtitle')} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile
          icon={ShieldAlert}
          label={t('kpiQueue')}
          value={pending.data?.total ?? null}
          loading={pending.isLoading}
          href={QUEUE_HREF}
        />
        <MetricTile
          icon={Flame}
          tone="text-destructive"
          label={t('kpiHigh')}
          value={high.data?.total ?? null}
          valueTone={(high.data?.total ?? 0) > 0 ? 'text-destructive' : undefined}
          loading={high.isLoading}
          href={QUEUE_HREF}
        />
        <MetricTile
          icon={Clock}
          tone="text-warning"
          label={t('kpiOverdue')}
          value={pending.isLoading ? null : overdue}
          valueTone={overdue > 0 ? 'text-warning' : undefined}
          loading={pending.isLoading}
          href={QUEUE_HREF}
        />
        <MetricTile
          icon={CheckCheck}
          tone="text-success"
          label={t('kpiResolvedWeek')}
          value={audit.isLoading ? null : resolvedWeek}
          loading={audit.isLoading}
          href={AUDIT_HREF}
        />
        <MetricTile
          icon={UserX}
          label={t('kpiBlocked')}
          value={blocked.data?.total ?? null}
          loading={blocked.isLoading}
          href={USERS_HREF}
        />
      </div>

      <SectionPanel title={t('chartFlow')} subtitle={t('chartFlowHint')}>
        {recent.isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : flowEmpty ? (
          <EmptyState title={t('chartFlowEmpty')} className="border-0 p-6" />
        ) : (
          <>
            {/* Легенда несёт значение цифрой (правило рельефа палитры: идентичность и
                величина не держатся на одном цвете) — сумма за две недели. */}
            <ChartLegend
              className="mb-3"
              items={[
                {
                  key: 'incoming',
                  label: t('flowIncoming'),
                  color: palette.series[0],
                  line: true,
                  value: String(flow.incoming.reduce((a, b) => a + b, 0)),
                },
                {
                  key: 'resolved',
                  label: t('flowResolved'),
                  color: palette.series[2],
                  line: true,
                  value: String(flow.resolved.reduce((a, b) => a + b, 0)),
                },
              ]}
            />
            <LineChart
              ariaLabel={t('chartFlow')}
              palette={palette}
              height={220}
              labels={flow.days.map(dayLabel)}
              series={[
                {
                  key: 'incoming',
                  label: t('flowIncoming'),
                  color: palette.series[0],
                  values: flow.incoming,
                },
                {
                  key: 'resolved',
                  label: t('flowResolved'),
                  color: palette.series[2],
                  values: flow.resolved,
                },
              ]}
            />
          </>
        )}
      </SectionPanel>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionPanel title={t('chartTargets')} subtitle={t('chartTargetsHint')}>
          {pending.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : targets.length === 0 ? (
            <EmptyState title={t('chartQueueEmpty')} className="border-0 p-6" />
          ) : (
            <BarChart
              ariaLabel={t('chartTargets')}
              palette={palette}
              height={Math.max(160, targets.length * 34 + 40)}
              labels={targets.map((x) => t(TARGET_KEY[x.key]))}
              values={targets.map((x) => x.value)}
              seriesName={t('complaintsShort')}
            />
          )}
        </SectionPanel>

        <SectionPanel title={t('chartAging')} subtitle={t('chartAgingHint')}>
          {pending.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : overdue === 0 && aging.fresh === 0 ? (
            <EmptyState title={t('chartQueueEmpty')} className="border-0 p-6" />
          ) : (
            <BarChart
              ariaLabel={t('chartAging')}
              palette={palette}
              height={160}
              labels={[t('agingDay'), t('agingThreeDays'), t('agingOlder')]}
              values={[aging.fresh, aging.days, aging.older]}
              seriesName={t('complaintsShort')}
            />
          )}
        </SectionPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionPanel
          title={t('oldestTitle')}
          subtitle={t('oldestHint')}
          actions={
            <Link href={QUEUE_HREF} className={LINK_CLASS}>
              {t('openQueue')}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }
        >
          {pending.isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: LIST_ROWS }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : oldest.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="size-6" aria-hidden />}
              title={t('empty')}
              className="border-0 p-6"
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border/60">
              {oldest.map((c) => {
                const priority = complaintPriority(c)
                return (
                  <li key={c.id} className={ROW_CLASS}>
                    <span
                      className={cn(
                        'flex w-20 shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium',
                        PRIORITY_STYLE[priority],
                      )}
                    >
                      {t(PRIORITY_KEY[priority])}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.reason}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {t(TARGET_KEY[c.targetType])}
                      </span>
                    </span>
                    <time className={TIME_CLASS} dateTime={c.createdAt}>
                      {relativeTime(c.createdAt, locale)}
                    </time>
                  </li>
                )
              })}
            </ul>
          )}
        </SectionPanel>

        <SectionPanel
          title={t('myActionsTitle')}
          subtitle={t('myActionsHint')}
          actions={
            <Link href={AUDIT_HREF} className={LINK_CLASS}>
              {t('openAudit')}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }
        >
          {audit.isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: LIST_ROWS }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : actions.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="size-6" aria-hidden />}
              title={t('auditEmpty')}
              className="border-0 p-6"
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border/60">
              {actions.map((a) => (
                <li key={a.id} className={ROW_CLASS}>
                  <span className="flex w-20 shrink-0 justify-center">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <ScrollText className="size-4" aria-hidden />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* Имя действия и объект — технические идентификаторы журнала,
                        их же показывает таблица аудита; перевода у них нет. */}
                    <span className="block truncate text-sm font-medium">{a.action}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.entity ?? ''}
                    </span>
                  </span>
                  <time className={TIME_CLASS} dateTime={a.createdAt}>
                    {relativeTime(a.createdAt, locale)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </SectionPanel>
      </div>
    </div>
  )
}
