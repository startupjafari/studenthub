'use client'

import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileStack,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { documentKeys, fetchDocumentOverview } from '../../../entities/document'
import {
  documentRequestKeys,
  fetchAuthoredRequests,
  fetchMyRequests,
} from '../../../entities/document-request'
import { useAppSelector } from '../../../shared/store'
import { Button, Card, CardContent, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Роли из §15.2: кто отвечает на запросы вуза и кто их создаёт (та же матрица, что в
// requests-panel). Остальным ролям карточка запросов не показывается.
const RESPONDER_ROLES: ReadonlySet<Role> = new Set([Role.STUDENT, Role.STAROSTA])
const STAFF_ROLES: ReadonlySet<Role> = new Set([Role.DEAN, Role.UNIVERSITY_MODERATOR, Role.TEACHER])

const MAX_ROWS = 4

export type OverviewTarget = 'my' | 'requests'
/** Клик по плитке/строке ведёт в нужный раздел, при необходимости с фильтром статуса. */
export type OverviewOpen = (target: OverviewTarget, status?: string) => void

// Обзор (ТЗ §3): счётчики-ссылки и активные запросы вуза. Всё кликабельное — обзор не
// отчёт, а точка входа в разделы.
export function OverviewPanel({ onOpen }: { onOpen: OverviewOpen }) {
  const t = useTranslations('Documents')
  const role = useAppSelector((s) => s.auth.role)

  const overview = useQuery({ queryKey: documentKeys.overview(), queryFn: fetchDocumentOverview })

  const o = overview.data
  const tiles: {
    key: string
    value: number
    label: string
    icon: LucideIcon
    tone: string
    status?: string
  }[] = [
    {
      key: 'total',
      value: o?.total ?? 0,
      label: t('statTotal'),
      icon: FileStack,
      tone: 'text-primary',
    },
    {
      key: 'toUpload',
      value: o?.toUpload ?? 0,
      label: t('statToUpload'),
      icon: RefreshCw,
      tone: 'text-warning',
      status: 'DRAFT',
    },
    {
      key: 'inReview',
      value: o?.inReview ?? 0,
      label: t('statInReview'),
      icon: Clock,
      tone: 'text-info',
      status: 'IN_REVIEW',
    },
    {
      key: 'expiring',
      value: o?.expiringSoon ?? 0,
      label: t('statExpiring'),
      icon: AlertTriangle,
      tone: 'text-warning',
      status: 'EXPIRING',
    },
    {
      key: 'needs',
      value: o?.needsReplacement ?? 0,
      label: t('statNeedsReplacement'),
      icon: CheckCircle2,
      tone: 'text-destructive',
      status: 'NEEDS_REPLACEMENT',
    },
  ]

  const isStaff = role !== null && STAFF_ROLES.has(role)
  const showRequests = isStaff || (role !== null && RESPONDER_ROLES.has(role))

  return (
    <div className="flex flex-col gap-4">
      {overview.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            // 64px = высота плитки: py-3 карточки (size="sm") + строка из чипа и двух подписей.
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((tile) => {
            const Icon = tile.icon
            return (
              <Card
                key={tile.key}
                size="sm"
                // Плитка ведёт в «Мои документы» с этим фильтром: счётчик без перехода
                // к самим документам — тупик.
                className="cursor-pointer transition-colors hover:ring-ring/50 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                onClick={() => onOpen('my', tile.status)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpen('my', tile.status)
                  }
                }}
              >
                {/* Горизонтальная раскладка: стопкой плитка занимала ~135px, из которых
                    32px были вторыми отступами — `p-4` на CardContent добавлял свои сверху
                    и снизу поверх собственного `py` карточки. */}
                <CardContent className="flex items-center gap-3">
                  {/* Подложка чипа берётся от цвета иконки (`bg-current/10`): тон у плиток
                      разный и означает срочность, дублировать его вторым классом незачем. */}
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg bg-current/10',
                      tile.tone,
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xl leading-tight font-semibold tabular-nums">
                      {tile.value}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {tile.label}
                    </span>
                  </span>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {showRequests && <RequestsCard staff={isStaff} onOpen={onOpen} />}
    </div>
  )
}

// Карточка запросов вуза: студенту — что от него ждут, сотруднику — что происходит
// с его запросами. Обе выборки уже кэшируются разделом «Запросы университета».
function RequestsCard({ staff, onOpen }: { staff: boolean; onOpen: OverviewOpen }) {
  const t = useTranslations('Documents')
  const locale = useLocale()
  const mine = useQuery({
    queryKey: documentRequestKeys.mine(),
    queryFn: fetchMyRequests,
    enabled: !staff,
  })
  const authored = useQuery({
    queryKey: documentRequestKeys.authored(),
    queryFn: fetchAuthoredRequests,
    enabled: staff,
  })
  const q = staff ? authored : mine
  const rows = (q.data ?? []).slice(0, MAX_ROWS)
  const total = (q.data ?? []).length
  const due = (iso: string | null): string | null =>
    iso ? t('req_due', { date: new Date(iso).toLocaleDateString(locale) }) : null

  return (
    <Panel
      title={t('nav_requests')}
      icon={ClipboardList}
      action={
        total > MAX_ROWS ? (
          <Button variant="ghost" size="sm" onClick={() => onOpen('requests')}>
            {t('ovShowAll', { n: total })}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        ) : null
      }
      loading={q.isLoading}
      empty={total === 0 ? t(staff ? 'req_emptyStaff' : 'req_emptyStudent') : null}
    >
      {rows.map((r) => {
        const subtitle = staff
          ? // Сотруднику важно, сколько комплектов уже пришло на проверку.
            t('req_submittedOf', {
              done: (r as { submittedCount: number }).submittedCount,
              total: (r as { submissionCount: number }).submissionCount,
            })
          : t('req_progress', {
              done: (r as { filledRequired: number }).filledRequired,
              total: (r as { requiredCount: number }).requiredCount,
            })
        const dueLabel = due(r.dueAt)
        return (
          <Row
            key={r.id}
            title={r.title}
            subtitle={dueLabel ? `${subtitle} · ${dueLabel}` : subtitle}
            onClick={() => onOpen('requests')}
          />
        )
      })}
    </Panel>
  )
}

function Panel({
  title,
  icon: Icon,
  action,
  loading,
  empty,
  children,
}: {
  title: string
  icon: LucideIcon
  action?: ReactNode
  loading?: boolean
  empty?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
        {action}
      </div>
      <div className="flex flex-col divide-y divide-border">
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-lg" />
            ))}
          </div>
        ) : empty ? (
          <p className="p-4 text-sm text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </div>
    </Card>
  )
}

function Row({
  title,
  subtitle,
  badge,
  onClick,
}: {
  title: string
  subtitle: string
  badge?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      {badge}
    </button>
  )
}
