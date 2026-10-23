'use client'

import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { Eye, FileText, Inbox, Paperclip } from 'lucide-react'
import {
  documentKeys,
  DocumentFileViewer,
  fetchDocumentFileUrl,
  fetchSharedWithMe,
  isViewableMedia,
  type SharedDocument,
  type SharedDocumentsPage,
} from '../../../entities/document'
import {
  Button,
  Card,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableText,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { DocModal } from './doc-modal'

// Ширины колонок: документ · владелец · основание · доступ до · «открыть».
const COLS = ['30%', '20%', '26%', '12%', '8rem'] as const
// На узком экране остаются документ, владелец и кнопка: по ним строку и находят.
const HIDE = {
  reason: 'hidden lg:table-cell',
  until: 'hidden md:table-cell',
} as const
const SKELETON_COLS = [undefined, undefined, HIDE.reason, HIDE.until, undefined]

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

// «Открытые мне» (D-F10): документы, которые студенты открыли получателю — персонально,
// деканату его факультета или администрации вуза. Только просмотр: файлы открываются
// по гранту, каждое открытие попадает в журнал документа у владельца.
export function SharedWithMe() {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const [viewer, setViewer] = useState<{ row: SharedDocument; index: number } | null>(null)
  // Документ из нескольких страниц открывается списком страниц, как у владельца: раньше
  // получателю была доступна только первая.
  const [pagesOf, setPagesOf] = useState<SharedDocument | null>(null)

  const q = useInfiniteQuery({
    queryKey: documentKeys.sharedWithMe(),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => fetchSharedWithMe(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: SharedDocumentsPage) => (last.hasNext ? last.cursor : undefined),
  })
  const rows = q.data?.pages.flatMap((p) => p.items) ?? []

  const fmt = (iso: string | null): string | null =>
    iso ? new Date(iso).toLocaleDateString(locale) : null
  // Собственный тип вуза в словаре не найти — показываем его код, а не ключ перевода.
  const typeLabel = (type: string): string =>
    t.has(`docType_${type}`) ? t(`docType_${type}`) : type

  // Снимки — в общем просмотрщике (листает только их), PDF — вкладкой браузера (как у
  // владельца). Просмотрщик не живёт поверх модального окна, поэтому список страниц
  // закрываем перед ним.
  async function openPage(row: SharedDocument, fileId: string): Promise<void> {
    const media = row.document.files.filter((f) => isViewableMedia(f.mime))
    const index = media.findIndex((f) => f.id === fileId)
    if (index >= 0) {
      setPagesOf(null)
      setViewer({ row, index })
      return
    }
    try {
      window.open(await fetchDocumentFileUrl(row.document.id, fileId), '_blank', 'noopener')
    } catch (e) {
      toast.error(tErr(errCode(e)))
    }
  }

  function open(row: SharedDocument): void {
    const [first, ...rest] = row.document.files
    if (!first) return
    if (rest.length === 0) void openPage(row, first.id)
    else setPagesOf(row)
  }

  if (q.isError) return <EmptyState title={tErr('INTERNAL_ERROR')} />
  if (!q.isLoading && rows.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="size-6" aria-hidden />}
        title={t('emptySharedWithMe')}
        description={t('emptySharedWithMeDesc')}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
        <Table fixed scrollBody fill cols={COLS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('fieldTitle')}</TableHead>
              <TableHead>{t('sharedOwner')}</TableHead>
              <TableHead className={HIDE.reason}>{t('grantReason')}</TableHead>
              <TableHead className={HIDE.until}>{t('grantUntil')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
            {rows.map((row) => (
              <TableRow key={row.accessId} className="hover:bg-muted/40">
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 font-medium">
                      <TableText value={row.document.title} />
                    </span>
                    {row.document.fileCount > 0 && (
                      <span
                        className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground tabular-nums"
                        title={t('fieldFilesCount', { n: row.document.fileCount })}
                      >
                        <Paperclip className="size-3.5" aria-hidden />
                        {row.document.fileCount}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    <TableText
                      value={[typeLabel(row.document.type), row.document.numberMasked]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <TableText value={row.owner.name} />
                </TableCell>
                <TableCell className={HIDE.reason}>
                  <TableText value={row.reason} />
                </TableCell>
                <TableCell
                  className={cn(HIDE.until, 'whitespace-nowrap text-muted-foreground tabular-nums')}
                >
                  {fmt(row.expiresAt) ?? <TableEmpty />}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={row.document.fileCount === 0}
                    onClick={() => open(row)}
                  >
                    <FileText className="size-4" aria-hidden /> {t('actionOpen')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {q.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          className="self-center"
          loading={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {t('showMore')}
        </Button>
      )}

      {pagesOf && (
        <DocModal title={pagesOf.document.title} onClose={() => setPagesOf(null)}>
          <ul className="flex flex-col gap-1.5">
            {pagesOf.document.files.map((page, i) => (
              <li
                key={page.id}
                className="flex items-center gap-1 rounded-lg border border-border py-1 pr-1 pl-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{t('pageN', { n: i + 1 })}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('pageOpen', { n: i + 1 })}
                  onClick={() => void openPage(pagesOf, page.id)}
                >
                  <Eye className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </DocModal>
      )}

      {viewer && (
        <DocumentFileViewer
          files={viewer.row.document.files.filter((f) => isViewableMedia(f.mime))}
          index={viewer.index}
          onIndexChange={(index) => setViewer({ ...viewer, index })}
          onClose={() => setViewer(null)}
          resolveUrl={(fileId, download) =>
            fetchDocumentFileUrl(viewer.row.document.id, fileId, download)
          }
        />
      )}
    </div>
  )
}
