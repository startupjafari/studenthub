'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  BookDown,
  BookUp,
  BookmarkCheck,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  ListChecks,
  PowerOff,
  ScanQrCode,
  type LucideIcon,
} from 'lucide-react'
import {
  Card,
  EmptyState,
  MetricTile,
  PageHeader,
  SectionPanel,
  Skeleton,
} from '../../../shared/ui'
import {
  LoanDueBadge,
  ReservationBadge,
  fetchLibrarySettings,
  fetchLibrarySummary,
  fetchLoans,
  fetchReservations,
  libraryKeys,
} from '../../../entities/library'

interface DeskAction {
  href: string
  icon: LucideIcon
  title: string
  description: string
}

const PANEL_LIMIT = 10

// Главная библиотекаря (docs/PROJECT.md §3.11, Фаза 20): сначала — что требует внимания
// (на руках, просрочки, книги на полке броней), потом крупные действия стойки и два списка,
// с которыми работают весь день: кто просрочил и чьи брони ждут. Модуль выключен — говорим
// об этом прямо, а не показываем нули.
export function LibraryHomeView() {
  const t = useTranslations('Library')
  const settings = useQuery({ queryKey: libraryKeys.settings(), queryFn: fetchLibrarySettings })
  const enabled = settings.data?.enabled === true
  const summary = useQuery({
    queryKey: libraryKeys.summary(),
    queryFn: fetchLibrarySummary,
    enabled,
  })
  const s = summary.data
  const loading = !s && (settings.isPending || summary.isPending)

  const actions: DeskAction[] = [
    {
      href: '/library/issue',
      icon: BookUp,
      title: t('issueTitle'),
      description: t('issueDescription'),
    },
    {
      href: '/library/return',
      icon: BookDown,
      title: t('returnTitle'),
      description: t('returnDescription'),
    },
    {
      href: '/library/inventory',
      icon: ClipboardCheck,
      title: t('inventoryTitle'),
      description: t('inventoryDescription'),
    },
    { href: '/scan', icon: ScanQrCode, title: t('scanTitle'), description: t('scanDescription') },
  ]

  return (
    <div className="flex w-full flex-col gap-6 xl:flex-1">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {settings.isPending ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : !enabled ? (
        <EmptyState
          icon={<PowerOff className="size-6" aria-hidden />}
          title={t('disabledTitle')}
          description={t('disabledDescription')}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              icon={ListChecks}
              label={t('metricOnLoan')}
              value={s?.loans.open ?? null}
              hint={s ? t('metricOnShelf', { count: s.copies.available }) : undefined}
              loading={loading}
              href="/library/loans"
              index={0}
            />
            <MetricTile
              icon={CircleAlert}
              tone="text-destructive"
              label={t('metricOverdue')}
              value={s?.loans.overdue ?? null}
              valueTone={s && s.loans.overdue > 0 ? 'text-destructive' : undefined}
              hint={s ? t('metricDebtors', { count: s.readers.debtors }) : undefined}
              loading={loading}
              href="/library/loans"
              index={1}
            />
            <MetricTile
              icon={BookmarkCheck}
              tone="text-success"
              label={t('metricReady')}
              value={s?.reservations.ready ?? null}
              hint={s ? t('metricQueued', { count: s.reservations.queued }) : undefined}
              loading={loading}
              href="/library/reservations"
              index={2}
            />
            <MetricTile
              icon={BookUp}
              label={t('metricIssued30')}
              value={s?.loans.issuedLast30 ?? null}
              hint={s ? t('metricReturned30', { count: s.loans.returnedLast30 }) : undefined}
              loading={loading}
              href="/library/reports"
              index={3}
            />
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {actions.map(({ href, icon: Icon, title, description }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="group block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <Card className="h-full flex-row items-center gap-4 px-4 transition-colors group-hover:bg-muted/40">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-6" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-base font-semibold">{title}</span>
                      <span className="text-sm text-muted-foreground">{description}</span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>

          {/* На компьютере панели добирают высоту окна до низа, обе вровень. */}
          <div className="grid items-start gap-6 xl:flex-1 xl:grid-cols-2 xl:items-stretch">
            <OverduePanel />
            <HoldShelfPanel />
          </div>
        </>
      )}
    </div>
  )
}

function PanelLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-sm font-medium text-primary hover:underline">
      {label}
    </Link>
  )
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full rounded-lg" />
      ))}
    </div>
  )
}

/** Просрочки — самые давние сверху: им звонят и пишут первыми. */
function OverduePanel() {
  const t = useTranslations('Library')
  const params = { filter: 'overdue' as const, page: 1, limit: PANEL_LIMIT }
  const overdue = useQuery({
    queryKey: libraryKeys.loans(params),
    queryFn: () => fetchLoans(params),
  })
  const items = overdue.data?.items ?? []
  return (
    <SectionPanel
      title={t('overdueTitle')}
      subtitle={t('overdueHint')}
      actions={<PanelLink href="/library/loans" label={t('allLoans')} />}
    >
      {overdue.isPending ? (
        <PanelSkeleton />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noOverdue')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((loan) => (
            <li key={loan.id} className="flex items-center gap-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{loan.reader.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[loan.reader.group, loan.book.title].filter(Boolean).join(' · ')}
                </span>
              </div>
              <LoanDueBadge loan={loan} />
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  )
}

/** Полка броней — что отложено и до какого дня держится. */
function HoldShelfPanel() {
  const t = useTranslations('Library')
  const tDesk = useTranslations('LibraryDesk')
  const params = { filter: 'ready' as const, page: 1, limit: PANEL_LIMIT }
  const ready = useQuery({
    queryKey: libraryKeys.reservations(params),
    queryFn: () => fetchReservations(params),
  })
  const items = ready.data?.items ?? []
  return (
    <SectionPanel
      title={t('holdShelfTitle')}
      subtitle={t('holdShelfHint')}
      actions={<PanelLink href="/library/reservations" label={t('allReservations')} />}
    >
      {ready.isPending ? (
        <PanelSkeleton />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noHolds')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{r.book.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[
                    r.reader.name,
                    r.copy ? tDesk('inventoryShort', { number: r.copy.inventoryNumber }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <ReservationBadge reservation={r} />
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  )
}
