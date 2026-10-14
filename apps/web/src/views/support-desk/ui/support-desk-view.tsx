'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { LifeBuoy, Search } from 'lucide-react'
import { SUPPORT_TAGS, type SupportTag } from '@studenthub/shared-schemas'
import {
  fetchSupportQueue,
  fetchSupportTagCounts,
  supportKeys,
  type SupportTicket,
} from '../../../entities/support-ticket'
import {
  Badge,
  Card,
  EmptyState,
  Input,
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
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { SupportThreadModal } from './support-thread-modal'
import { tagLabels } from './tag-label'

type StatusTab = 'open' | 'closed'
type Assignee = 'any' | 'mine' | 'free'
const ALL_TAGS = '__all__'
const LIMIT = 30

// Автор · последнее сообщение · теги · кто разбирает · обновлено.
const COLS = ['20%', '38%', '16%', '14%', '12%'] as const
const COLS_NARROW = ['40%', '60%', '0', '0', '0'] as const
const HIDE = {
  tags: 'hidden lg:table-cell',
  assignee: 'hidden md:table-cell',
  updated: 'hidden md:table-cell',
} as const
const SKELETON_COLS = [undefined, undefined, HIDE.tags, HIDE.assignee, HIDE.updated]

/**
 * Обращения в поддержку платформы (админ и модератор платформы). До этого очередь жила
 * только в мини-аппе Telegram: с компьютера поддержке отвечать было негде.
 */
export function SupportDeskView() {
  const t = useTranslations('SupportDesk')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const [status, setStatus] = useState<StatusTab>('open')
  const [assignee, setAssignee] = useState<Assignee>('any')
  const [tag, setTag] = useState<SupportTag | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)
  const labels = tagLabels(t)

  // Поиск на сервере начинается с двух символов: одна буква совпадает со всем подряд.
  const term = search.trim()
  const params = {
    status,
    assignee,
    page,
    limit: LIMIT,
    ...(tag ? { tag } : {}),
    ...(term.length >= 2 ? { search: term } : {}),
  }
  const queue = useQuery({
    queryKey: supportKeys.queue(params),
    queryFn: () => fetchSupportQueue(params),
    placeholderData: keepPreviousData,
  })
  const counts = useQuery({ queryKey: supportKeys.tags(), queryFn: fetchSupportTagCounts })
  const countOf = (value: SupportTag) => counts.data?.find((c) => c.tag === value)?.count ?? 0

  const refilter = (apply: () => void) => {
    apply()
    setPage(1)
  }
  const rows = queue.data?.items ?? []

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <div className="relative w-full sm:w-56">
              <Search
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                size="md"
                value={search}
                onChange={(e) => refilter(() => setSearch(e.target.value))}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
                className="pl-9"
              />
            </div>
            <Select
              value={tag ?? ALL_TAGS}
              onValueChange={(v) =>
                refilter(() => setTag(v === ALL_TAGS ? null : (v as SupportTag)))
              }
            >
              <SelectTrigger size="md" className="w-44" aria-label={t('tagFilter')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TAGS}>{t('tagAll')}</SelectItem>
                {SUPPORT_TAGS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {labels[value]} · {countOf(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedTabs<StatusTab>
          aria-label={t('statusFilter')}
          compact
          value={status}
          onChange={(v) => refilter(() => setStatus(v))}
          items={[
            { value: 'open', label: t('statusOpen') },
            { value: 'closed', label: t('statusClosed') },
          ]}
        />
        <SegmentedTabs<Assignee>
          aria-label={t('assigneeFilter')}
          compact
          value={assignee}
          onChange={(v) => refilter(() => setAssignee(v))}
          items={[
            { value: 'any', label: t('assigneeAny') },
            { value: 'mine', label: t('assigneeMine') },
            { value: 'free', label: t('assigneeFree') },
          ]}
        />
      </div>

      {queue.isError ? (
        <EmptyState title={tErr(toApiError(queue.error).code)} description={tErr('retryHint')} />
      ) : rows.length === 0 && !queue.isLoading ? (
        <EmptyState
          icon={<LifeBuoy className="size-6" aria-hidden />}
          title={status === 'open' ? t('emptyOpen') : t('emptyClosed')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colAuthor')}</TableHead>
                <TableHead>{t('colLast')}</TableHead>
                <TableHead className={HIDE.tags}>{t('colTags')}</TableHead>
                <TableHead className={HIDE.assignee}>{t('colAssignee')}</TableHead>
                <TableHead className={HIDE.updated}>{t('colUpdated')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {rows.map((ticket) => (
                <TicketRow
                  key={ticket.id}
                  ticket={ticket}
                  locale={locale}
                  labels={labels}
                  onOpen={() => setOpenId(ticket.id)}
                />
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            limit={LIMIT}
            total={queue.data?.total ?? 0}
            onPageChange={setPage}
          />
        </Card>
      )}

      {openId && (
        <SupportThreadModal ticketId={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} />
      )}
    </div>
  )
}

function TicketRow({
  ticket,
  locale,
  labels,
  onOpen,
}: {
  ticket: SupportTicket
  locale: string
  labels: Record<SupportTag, string>
  onOpen: () => void
}) {
  const t = useTranslations('SupportDesk')
  // Ждёт ответа — последнее слово за автором: такие строки выделены, их разбирают первыми.
  const waiting = !ticket.closedAt && ticket.lastMessage?.fromAuthor === true
  const name = ticket.author
    ? `${ticket.author.lastName} ${ticket.author.firstName}`
    : t('deletedAuthor')
  return (
    <TableRow
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
    >
      <TableCell className={cn(waiting && 'font-semibold')}>
        <TableText value={name} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        <TableText value={ticket.lastMessage?.text ?? t('noText')} />
      </TableCell>
      <TableCell className={HIDE.tags}>
        <span className="flex flex-wrap gap-1">
          {ticket.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {labels[tag]}
            </Badge>
          ))}
        </span>
      </TableCell>
      <TableCell className={cn(HIDE.assignee, 'text-muted-foreground')}>
        <TableText
          value={
            ticket.assignee ? `${ticket.assignee.lastName} ${ticket.assignee.firstName}` : t('free')
          }
        />
      </TableCell>
      <TableCell className={cn(HIDE.updated, 'text-muted-foreground tabular-nums')}>
        {new Date(ticket.updatedAt).toLocaleString(locale, {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </TableCell>
    </TableRow>
  )
}
