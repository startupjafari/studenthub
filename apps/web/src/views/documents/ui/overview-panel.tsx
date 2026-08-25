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
  FileText,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import {
  documentKeys,
  fetchDocumentOverview,
  fetchDocuments,
  type DocumentDto,
} from '../../../entities/document'
import {
  documentRequestKeys,
  fetchAuthoredRequests,
  fetchMyRequests,
} from '../../../entities/document-request'
import { useAppSelector } from '../../../shared/store'
import { Badge, Button, Card, CardContent, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Роли из §15.2: кто отвечает на запросы вуза и кто их создаёт (та же матрица, что в
// requests-panel). Остальным ролям карточка запросов не показывается.
const RESPONDER_ROLES: ReadonlySet<Role> = new Set([Role.STUDENT, Role.STAROSTA])
const STAFF_ROLES: ReadonlySet<Role> = new Set([Role.DEAN, Role.UNIVERSITY_MODERATOR, Role.TEACHER])

// Порог «скоро истекает» — тот же, что у серверного счётчика (EXPIRING_WINDOW_MS).
const EXPIRING_DAYS = 30
// Статусы, при которых с документом надо что-то сделать.
const ATTENTION_STATUSES = ['REJECTED', 'NEEDS_REPLACEMENT', 'EXPIRED', 'EXPIRING']
const MAX_ROWS = 4

export type OverviewTarget = 'my' | 'requests'
/** Клик по плитке/строке ведёт в нужный раздел, при необходимости с фильтром статуса. */
export type OverviewOpen = (target: OverviewTarget, status?: string) => void

function daysLeft(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

// Обзор (ТЗ §3): счётчики-ссылки, разбор «что требует внимания», активные запросы вуза
// и последние документы. Всё кликабельное — обзор не отчёт, а точка входа в разделы.
export function OverviewPanel({ onOpen }: { onOpen: OverviewOpen }) {
  const t = useTranslations('Documents')
  const locale = useLocale()
  const role = useAppSelector((s) => s.auth.role)

  const overview = useQuery({ queryKey: documentKeys.overview(), queryFn: fetchDocumentOverview })
  // Тот же ключ, что у списка без фильтров, — обзор и «Мои документы» делят кэш.
  const docsQuery = useQuery({
    queryKey: documentKeys.list({ view: 'active' }),
    queryFn: () => fetchDocuments({ view: 'active' }),
  })
  const docs = docsQuery.data ?? []

  const attention = docs
    .filter((d) => {
      const left = daysLeft(d.expiresAt)
      return ATTENTION_STATUSES.includes(d.status) || (left !== null && left <= EXPIRING_DAYS)
    })
    // Сначала самое срочное: просроченное, потом ближайшее по сроку, потом без срока.
    .sort((a, b) => (daysLeft(a.expiresAt) ?? Infinity) - (daysLeft(b.expiresAt) ?? Infinity))
  const recent = [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_ROWS)

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
  // Причина попадания в список: срок важнее статуса — его видно по дате.
  function attentionReason(doc: DocumentDto): string {
    const left = daysLeft(doc.expiresAt)
    if (doc.expiresAt && left !== null) {
      const date = new Date(doc.expiresAt).toLocaleDateString(locale)
      return left < 0 ? t('ovExpiredOn', { date }) : t('ovExpiresOn', { date })
    }
    if (doc.rejectionReason) return doc.rejectionReason
    return t(`docType_${doc.type}`)
  }

  const showRequests = isStaff || (role !== null && RESPONDER_ROLES.has(role))

  return (
    <div className="flex flex-col gap-4">
      {overview.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((tile) => {
            const Icon = tile.icon
            return (
              <Card
                key={tile.key}
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
                <CardContent className="flex flex-col gap-1.5 p-4">
                  <Icon className={cn('size-5', tile.tone)} aria-hidden />
                  <span className="text-2xl font-bold tabular-nums">{tile.value}</span>
                  <span className="text-xs text-muted-foreground">{tile.label}</span>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <div className={cn('grid gap-4', showRequests && 'lg:grid-cols-2')}>
        {/* Что требует внимания: просрочка, отклонение, замена, близкий срок. */}
        <Panel
          title={t('ovAttention')}
          icon={AlertTriangle}
          action={
            attention.length > MAX_ROWS ? (
              <Button variant="ghost" size="sm" onClick={() => onOpen('my')}>
                {t('ovShowAll', { n: attention.length })}
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : null
          }
          loading={docsQuery.isLoading}
          empty={attention.length === 0 ? t('ovAttentionEmpty') : null}
        >
          {attention.slice(0, MAX_ROWS).map((doc) => (
            <Row
              key={doc.id}
              title={doc.title}
              subtitle={attentionReason(doc)}
              badge={
                <Badge variant={doc.status === 'EXPIRED' ? 'destructive' : 'warning'}>
                  {t(`docStatus_${doc.status}`)}
                </Badge>
              }
              onClick={() => onOpen('my', doc.status)}
            />
          ))}
        </Panel>

        {showRequests && <RequestsCard staff={isStaff} onOpen={onOpen} />}
      </div>

      {/* Последние загруженные — быстрый доступ к тому, с чем работали. */}
      <Panel
        title={t('ovRecent')}
        icon={FileText}
        action={
          docs.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => onOpen('my')}>
              {t('ovShowAll', { n: docs.length })}
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : null
        }
        loading={docsQuery.isLoading}
        empty={
          recent.length === 0 ? (
            <span className="flex flex-wrap items-center gap-2">
              {t('emptyActive')}
              <Button size="sm" onClick={() => onOpen('my')}>
                {t('upload')}
              </Button>
            </span>
          ) : null
        }
      >
        {recent.map((doc) => (
          <Row
            key={doc.id}
            title={doc.title}
            subtitle={`${t(`docCat_${doc.category}`)} · ${new Date(doc.createdAt).toLocaleDateString(locale)}`}
            badge={<Badge variant="secondary">{t(`docStatus_${doc.status}`)}</Badge>}
            onClick={() => onOpen('my')}
          />
        ))}
      </Panel>
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
