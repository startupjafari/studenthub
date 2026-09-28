'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { Inbox } from 'lucide-react'
import type { DemoRequestStatusValue } from '@studenthub/shared-schemas'
import { fetchDemoRequests, onboardingKeys, type DemoRequest } from '../../../entities/onboarding'
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SegmentedTabs,
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
import { cn } from '../../../shared/lib/utils'
import { DemoRequestModal } from './demo-request-modal'

const LIMIT = 20

/**
 * Вкладки очереди. `NEW` первой и по умолчанию: экран открывают, чтобы разобрать
 * новое, а не чтобы посмотреть историю. `PENDING_EMAIL` здесь нет — это брошенные
 * формы, а не заявки, и разбирать их человеку незачем.
 */
const TABS = ['NEW', 'APPROVED', 'REJECTED'] as const
type Tab = (typeof TABS)[number]

const STATUS_STYLE: Record<DemoRequestStatusValue, string> = {
  PENDING_EMAIL: 'text-muted-foreground',
  NEW: 'text-warning',
  APPROVED: 'text-success',
  REJECTED: 'text-destructive',
}

// Ширины: вуз · контакт · почта · подана · статус.
const COLS = ['28%', '20%', '24%', '13%', '15%'] as const
// Узкий экран: контакт и дата скрыты — контакт уходит подписью под название вуза.
const COLS_NARROW = ['62%', '0', '0', '0', '38%'] as const
const HIDE = {
  contact: 'hidden md:table-cell',
  email: 'hidden sm:table-cell',
  createdAt: 'hidden lg:table-cell',
} as const
const SKELETON_COLS = [undefined, HIDE.contact, HIDE.email, HIDE.createdAt, undefined]

/**
 * Очередь заявок вузов на тестирование.
 *
 * Решение принимается не в строке таблицы, а в карточке: одобрение заводит вуз и
 * открывает доступ живым людям, и такое действие не должно случаться от промаха по
 * узкой кнопке в списке. Строка открывает карточку, карточка спрашивает ещё раз.
 */
export function DemoRequestsView() {
  const t = useTranslations('DemoAdmin')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()

  const [tab, setTab] = useState<Tab>('NEW')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)

  const params = { status: tab, page, limit: LIMIT }
  const requests = useQuery({
    queryKey: onboardingKeys.demoRequests(params),
    queryFn: () => fetchDemoRequests(params),
  })
  const rows = requests.data?.items ?? []
  const total = requests.data?.total ?? 0

  const open = rows.find((r) => r.id === openId) ?? null

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <SegmentedTabs
        items={TABS.map((value) => ({ value, label: t(`tab${value}`) }))}
        value={tab}
        onChange={(next) => {
          setTab(next)
          // Страница сбрасывается вместе с вкладкой: третья страница отклонённых и
          // третья страница новых — разные выборки, и переносить номер между ними
          // значит открывать пустой экран.
          setPage(1)
        }}
        aria-label={t('title')}
        compact
      />

      {requests.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !requests.isLoading && rows.length === 0 ? (
        <EmptyState icon={<Inbox className="size-6" aria-hidden />} title={t(`empty${tab}`)} />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colUniversity')}</TableHead>
                <TableHead className={HIDE.contact}>{t('colContact')}</TableHead>
                <TableHead className={HIDE.email}>{t('colEmail')}</TableHead>
                <TableHead className={HIDE.createdAt}>{t('colCreatedAt')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {rows.map((request) => (
                <TableRow
                  key={request.id}
                  onClick={() => setOpenId(request.id)}
                  className="cursor-pointer hover:bg-muted/40"
                >
                  <TableCell className="font-medium">
                    <TableText value={request.universityName} />
                    <span className="block truncate text-xs font-normal text-muted-foreground md:hidden">
                      {request.contactName}
                    </span>
                  </TableCell>
                  <TableCell className={HIDE.contact}>
                    <TableText value={request.contactName} />
                  </TableCell>
                  <TableCell className={HIDE.email}>
                    <TableText value={request.email} />
                  </TableCell>
                  <TableCell className={cn('tabular-nums', HIDE.createdAt)}>
                    {new Date(request.createdAt).toLocaleDateString(locale, {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_STYLE[request.status]}>
                      {t(`status${request.status}`)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            total={total}
            limit={LIMIT}
            onPageChange={setPage}
            className="border-t border-border"
          />
        </Card>
      )}

      {open && (
        <DemoRequestModal
          request={open}
          onClose={() => setOpenId(null)}
          onDecided={(decided: DemoRequest) => {
            setOpenId(null)
            void qc.invalidateQueries({ queryKey: onboardingKeys.all })
            toast.success(decided.status === 'APPROVED' ? t('approved') : t('rejected'))
          }}
        />
      )}
    </div>
  )
}
