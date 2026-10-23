'use client'

import { useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useTranslations } from 'next-intl'
import { DoorOpen, ScanLine, ShieldCheck, ShieldX, UserPlus, Users } from 'lucide-react'
import type { PassDenyReasonValue, PassItem, VisitorItem } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  EmptyState,
  MetricTile,
  PageHeader,
  SectionPanel,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
} from '../../../shared/ui'
import { cn, toApiError } from '../../../shared/lib'
import {
  exitVisitorRequest,
  fetchPasses,
  fetchSecuritySummary,
  fetchVisitors,
  securityKeys,
} from '../../../entities/security-journal'
import { RecordVisitorModal } from '../../../features/record-visitor'

// «Пост охраны» — главная роли SECURITY_GUARD (docs/PROJECT.md §3.12): рабочий экран смены.
// Главное действие — проверка студенческого, его кнопка первой и самой крупной. Ниже —
// сводка за сегодня по часам вуза и два журнала: проходы и посетители в здании.

const PAGE_SIZES = [20, 50, 100] as const

// Проходы: время · студент · группа · результат.
const PASS_COLS = ['7.5rem', 'auto', '22%', '12rem'] as const
const PASS_COLS_NARROW = ['5rem', 'auto', '0', '9rem'] as const
const PASS_HIDE = { group: 'hidden md:table-cell' } as const
const PASS_SKELETON = [undefined, undefined, PASS_HIDE.group, undefined]

// В здании: посетитель · к кому · вход · выход.
const VISITOR_COLS = ['auto', '34%', '5rem', '7.5rem'] as const
const VISITOR_COLS_NARROW = ['auto', '0', '4.5rem', '7rem'] as const
const VISITOR_HIDE = { purpose: 'hidden md:table-cell' } as const
const VISITOR_SKELETON = [undefined, VISITOR_HIDE.purpose, undefined, undefined]

export function SecurityHomeView() {
  const t = useTranslations('Security')
  const [recording, setRecording] = useState(false)
  const summary = useQuery({ queryKey: securityKeys.summary(), queryFn: fetchSecuritySummary })
  const s = summary.data

  return (
    // `min-h-0` у корня: журналы прокручиваются внутри своих таблиц, а не страницей.
    <div className="flex w-full flex-col gap-6 lg:min-h-0 lg:flex-1">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button type="button" variant="outline" size="md" onClick={() => setRecording(true)}>
            <UserPlus className="size-4" aria-hidden />
            {t('recordVisitor')}
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* Проверка — главное действие на входе: крупная кнопка, а не плитка среди прочих. */}
        <Link
          href="/verify-id"
          className="group flex min-h-24 items-center gap-4 rounded-xl bg-primary px-5 text-primary-foreground shadow-sm transition-opacity outline-none hover:opacity-90 focus-visible:ring-4 focus-visible:ring-ring/30 sm:col-span-2 xl:col-span-1"
        >
          <ScanLine className="size-8 shrink-0" aria-hidden />
          <span className="flex min-w-0 flex-col">
            <span className="text-lg font-semibold">{t('verifyTitle')}</span>
            <span className="text-sm opacity-80">{t('verifyHint')}</span>
          </span>
        </Link>
        <MetricTile
          icon={ShieldCheck}
          tone="text-success"
          label={t('metricAllowed')}
          value={s?.passes.allowed ?? null}
          hint={t('metricToday')}
          loading={summary.isPending}
          index={0}
        />
        <MetricTile
          icon={ShieldX}
          tone="text-destructive"
          label={t('metricDenied')}
          value={s?.passes.denied ?? null}
          valueTone={s && s.passes.denied > 0 ? 'text-destructive' : undefined}
          hint={t('metricToday')}
          loading={summary.isPending}
          index={1}
        />
        <MetricTile
          icon={Users}
          label={t('metricInside')}
          value={s?.visitors.inside ?? null}
          hint={s ? t('metricVisitorsToday', { count: s.visitors.today }) : undefined}
          loading={summary.isPending}
          index={2}
        />
      </div>

      <div className="grid gap-6 lg:min-h-80 lg:flex-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[minmax(0,1fr)]">
        <PassesPanel />
        <VisitorsPanel onRecord={() => setRecording(true)} />
      </div>

      {recording && <RecordVisitorModal onClose={() => setRecording(false)} />}
    </div>
  )
}

function useDenyReasonLabel(): Record<PassDenyReasonValue, string> {
  const t = useTranslations('Security')
  return {
    STATUS: t('denyReason.STATUS'),
    BLOCKED: t('denyReason.BLOCKED'),
    OTHER_UNIVERSITY: t('denyReason.OTHER_UNIVERSITY'),
    INVALID_QR: t('denyReason.INVALID_QR'),
    EXPIRED_QR: t('denyReason.EXPIRED_QR'),
    REUSED_QR: t('denyReason.REUSED_QR'),
  }
}

/** Время записи: сегодняшнее — только часы, более раннее — с датой. */
function useJournalTime(): (iso: string) => string {
  const format = useFormatter()
  return (iso) => {
    const date = new Date(iso)
    const today = new Date().toDateString() === date.toDateString()
    return format.dateTime(
      date,
      today
        ? { hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
    )
  }
}

function PassesPanel() {
  const t = useTranslations('Security')
  const denyLabel = useDenyReasonLabel()
  const time = useJournalTime()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  const params = { page, limit }
  const passes = useQuery({
    queryKey: securityKeys.passes(params),
    queryFn: () => fetchPasses(params),
    placeholderData: keepPreviousData,
  })
  const items = passes.data?.items ?? []

  return (
    <SectionPanel
      title={t('passesTitle')}
      subtitle={t('passesHint')}
      className="lg:min-h-0"
      bodyClassName="flex flex-col p-0 lg:min-h-0 lg:flex-1"
    >
      {passes.isError ? (
        <EmptyState
          icon={<ShieldX className="size-6" aria-hidden />}
          title={t('loadError')}
          className="m-4"
          action={
            <Button type="button" variant="outline" onClick={() => void passes.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : !passes.isPending && items.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-6" aria-hidden />}
          title={t('passesEmpty')}
          description={t('passesEmptyHint')}
          className="m-4"
        />
      ) : (
        <>
          <Table fixed scrollBody fill cols={PASS_COLS} colsNarrow={PASS_COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colTime')}</TableHead>
                <TableHead>{t('colStudent')}</TableHead>
                <TableHead className={PASS_HIDE.group}>{t('colGroup')}</TableHead>
                <TableHead>{t('colResult')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {passes.isPending && <TableSkeletonRows columns={PASS_SKELETON} />}
              {items.map((pass) => (
                <PassRow key={pass.id} pass={pass} time={time} denyLabel={denyLabel} />
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            total={passes.data?.total ?? 0}
            limit={limit}
            onPageChange={setPage}
            limitOptions={PAGE_SIZES}
            onLimitChange={(n) => {
              setLimit(n)
              setPage(1)
            }}
          />
        </>
      )}
    </SectionPanel>
  )
}

function PassRow({
  pass,
  time,
  denyLabel,
}: {
  pass: PassItem
  time: (iso: string) => string
  denyLabel: Record<PassDenyReasonValue, string>
}) {
  const t = useTranslations('Security')
  return (
    <TableRow>
      <TableCell className="text-muted-foreground tabular-nums">
        <TableText value={time(pass.createdAt)} />
      </TableCell>
      <TableCell className={cn('font-medium', !pass.student && 'text-muted-foreground')}>
        <TableText value={pass.student?.name ?? t('unknownStudent')} />
      </TableCell>
      <TableCell className={cn(PASS_HIDE.group, 'text-muted-foreground')}>
        {pass.student?.group ? <TableText value={pass.student.group} /> : <TableEmpty />}
      </TableCell>
      <TableCell>
        {pass.allowed ? (
          <Badge variant="success">{t('allowed')}</Badge>
        ) : (
          <Badge variant="destructive" className="max-w-full">
            <span className="truncate">
              {pass.denyReason ? denyLabel[pass.denyReason] : t('denied')}
            </span>
          </Badge>
        )}
      </TableCell>
    </TableRow>
  )
}

function VisitorsPanel({ onRecord }: { onRecord: () => void }) {
  const t = useTranslations('Security')
  const tErr = useTranslations('Errors')
  const time = useJournalTime()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  const params = { status: 'inside' as const, page, limit }
  const visitors = useQuery({
    queryKey: securityKeys.visitors(params),
    queryFn: () => fetchVisitors(params),
    placeholderData: keepPreviousData,
  })
  const items = visitors.data?.items ?? []

  const exit = useMutation({
    mutationFn: exitVisitorRequest,
    onSuccess: (visitor) => {
      void qc.invalidateQueries({ queryKey: securityKeys.all })
      toast.success(t('visitorExited', { name: visitor.fullName }))
    },
    onError: (e) => {
      const err = toApiError(e)
      // Выход уже отметил сменщик — журнал устарел, просто обновить его.
      if (err.code === 'CONFLICT') void qc.invalidateQueries({ queryKey: securityKeys.all })
      toast.error(err.code === 'CONFLICT' ? t('visitorAlreadyExited') : tErr(err.code))
    },
  })

  return (
    <SectionPanel
      title={t('visitorsTitle')}
      subtitle={t('visitorsHint')}
      className="lg:min-h-0"
      bodyClassName="flex flex-col p-0 lg:min-h-0 lg:flex-1"
    >
      {visitors.isError ? (
        <EmptyState
          icon={<Users className="size-6" aria-hidden />}
          title={t('loadError')}
          className="m-4"
          action={
            <Button type="button" variant="outline" onClick={() => void visitors.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : !visitors.isPending && items.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" aria-hidden />}
          title={t('visitorsEmpty')}
          className="m-4"
          action={
            <Button type="button" variant="outline" onClick={onRecord}>
              <UserPlus className="size-4" aria-hidden />
              {t('recordVisitor')}
            </Button>
          }
        />
      ) : (
        <>
          <Table fixed scrollBody fill cols={VISITOR_COLS} colsNarrow={VISITOR_COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colVisitor')}</TableHead>
                <TableHead className={VISITOR_HIDE.purpose}>{t('colPurpose')}</TableHead>
                <TableHead>{t('colEntered')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('markExit')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visitors.isPending && <TableSkeletonRows columns={VISITOR_SKELETON} />}
              {items.map((visitor) => (
                <VisitorRow
                  key={visitor.id}
                  visitor={visitor}
                  time={time}
                  busy={exit.isPending && exit.variables === visitor.id}
                  onExit={() => exit.mutate(visitor.id)}
                />
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            total={visitors.data?.total ?? 0}
            limit={limit}
            onPageChange={setPage}
            limitOptions={PAGE_SIZES}
            onLimitChange={(n) => {
              setLimit(n)
              setPage(1)
            }}
          />
        </>
      )}
    </SectionPanel>
  )
}

function VisitorRow({
  visitor,
  time,
  busy,
  onExit,
}: {
  visitor: VisitorItem
  time: (iso: string) => string
  busy: boolean
  onExit: () => void
}) {
  const t = useTranslations('Security')
  return (
    <TableRow>
      <TableCell className="font-medium">
        <TableText value={visitor.fullName} />
      </TableCell>
      <TableCell className={cn(VISITOR_HIDE.purpose, 'text-muted-foreground')}>
        <TableText value={visitor.purpose} />
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        <TableText value={time(visitor.enteredAt)} />
      </TableCell>
      <TableCell className="text-right">
        <Button type="button" variant="outline" size="sm" loading={busy} onClick={onExit}>
          <DoorOpen className="size-4" aria-hidden />
          {t('markExit')}
        </Button>
      </TableCell>
    </TableRow>
  )
}
