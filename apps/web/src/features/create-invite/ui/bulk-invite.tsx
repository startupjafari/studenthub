'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import type {
  BulkInvitePreviewResponse,
  BulkInvitePreviewRow,
  BulkInviteRowStatus,
} from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableText,
  useTableSort,
} from '../../../shared/ui'
import { bulkPreviewRequest, bulkCreateRequest, inviteKeys } from '../../../entities/invite'

const PREVIEW_PAGE_SIZES = [20, 100, 150, 200] as const
// Ширины колонок: строка · email · группа · роль · статус · ошибка.
const COLS = ['8%', '26%', '16%', '14%', '14%', '22%'] as const

// Значение колонки для сортировки — вне компонента (стабильная ссылка для useMemo).
// Строки предпросмотра целиком на клиенте, поэтому сортировка здесь полная, не постраничная.
function sortValue(r: BulkInvitePreviewRow, key: string): unknown {
  if (key === 'line') return r.line
  if (key === 'email') return r.email
  if (key === 'groupName') return r.groupName
  if (key === 'role') return r.role
  if (key === 'status') return r.status
  if (key === 'error') return r.error
  return undefined
}

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

const STATUS_VARIANT: Record<BulkInviteRowStatus, 'success' | 'warning' | 'destructive'> = {
  READY: 'success',
  DUPLICATE: 'warning',
  ERROR: 'destructive',
}

// Массовый импорт приглашений (задача Stage 3): загрузка CSV/XLSX → предпросмотр с
// валидацией на сервере → подтверждение создания. Переиспользует Modal и стиль строк-карточек.
export function BulkInvite() {
  const t = useTranslations('Invites')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<BulkInvitePreviewResponse | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const previewMut = useMutation({
    mutationFn: (file: File) => bulkPreviewRequest(file),
    onSuccess: setPreview,
    onError: (e) => toast.error(t(`bulk.parseError`), { description: String(errCode(e)) }),
  })

  const commitMut = useMutation({
    mutationFn: () => {
      const rows = (preview?.rows ?? [])
        .filter((r) => r.status === 'READY' && r.groupId)
        .map((r) => ({ email: r.email, groupId: r.groupId as string, role: r.role }))
      return bulkCreateRequest({ rows })
    },
    onSuccess: (res) => {
      toast.success(
        t('bulk.done', { created: res.created, skipped: res.skipped, failed: res.failed }),
      )
      void queryClient.invalidateQueries({ queryKey: inviteKeys.list() })
      close()
    },
    onError: (e) => toast.error(t('bulk.parseError'), { description: String(errCode(e)) }),
  })

  function close() {
    setOpen(false)
    setPreview(null)
    previewMut.reset()
    commitMut.reset()
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) previewMut.mutate(file)
    e.target.value = '' // позволить повторно выбрать тот же файл
  }

  const readyCount = preview?.summary.ready ?? 0

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Upload className="size-4" aria-hidden />
        {t('bulk.open')}
      </Button>

      {open && (
        <Modal onClose={close} title={t('bulk.title')} size="3xl">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t('bulk.hint')}</p>

            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={onPick}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={previewMut.isPending || commitMut.isPending}
              >
                {preview ? t('bulk.anotherFile') : t('bulk.choose')}
              </Button>
            </div>

            {previewMut.isPending && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">{t('bulk.checking')}</p>
                <Skeleton className="h-40 w-full rounded-xl" />
              </div>
            )}

            {preview && !previewMut.isPending && (
              <>
                <p className="text-sm font-medium">
                  {t('bulk.summary', {
                    total: preview.summary.total,
                    ready: preview.summary.ready,
                    duplicate: preview.summary.duplicate,
                    error: preview.summary.error,
                  })}
                </p>
                <PreviewTable rows={preview.rows} t={t} />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    onClick={() => commitMut.mutate()}
                    disabled={readyCount === 0 || commitMut.isPending}
                  >
                    {readyCount === 0
                      ? t('bulk.nothingReady')
                      : t('bulk.confirm', { count: readyCount })}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

function PreviewTable({
  rows,
  t,
}: {
  rows: BulkInvitePreviewRow[]
  t: ReturnType<typeof useTranslations>
}) {
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PREVIEW_PAGE_SIZES[0])
  const { rows: ordered, sort, toggle } = useTableSort(rows, sortValue)

  if (rows.length === 0) {
    return <EmptyState title={t('bulk.nothingReady')} />
  }
  // Строки уже разобраны на клиенте — пагинация тоже клиентская: 500 строк импорта
  // в один список превращают предпросмотр в бесконечную простыню.
  const pages = Math.max(1, Math.ceil(rows.length / limit))
  const current = Math.min(page, pages)
  const visible = ordered.slice((current - 1) * limit, current * limit)

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table fixed scrollBody cols={COLS}>
        <TableHeader>
          <TableRow>
            <TableHead sortKey="line" sort={sort} onSort={toggle}>
              {t('bulk.colLine')}
            </TableHead>
            <TableHead sortKey="email" sort={sort} onSort={toggle}>
              {t('bulk.colEmail')}
            </TableHead>
            <TableHead sortKey="groupName" sort={sort} onSort={toggle}>
              {t('bulk.colGroup')}
            </TableHead>
            <TableHead sortKey="role" sort={sort} onSort={toggle}>
              {t('bulk.colRole')}
            </TableHead>
            <TableHead sortKey="status" sort={sort} onSort={toggle}>
              {t('bulk.colStatus')}
            </TableHead>
            <TableHead sortKey="error" sort={sort} onSort={toggle}>
              {t('bulk.colError')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="max-h-[45vh]">
          {visible.map((r) => (
            <TableRow key={`${r.line}-${r.email}`} className="align-top">
              <TableCell className="tabular-nums text-muted-foreground">{r.line}</TableCell>
              <TableCell>
                <TableText value={r.email} />
              </TableCell>
              <TableCell>
                <TableText value={r.groupName} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                <TableText value={r.role} />
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[r.status]}>{t(`bulk.status${r.status}`)}</Badge>
              </TableCell>
              {/* Колонка ошибки: у годной строки её просто нет — это не пустое значение,
                  а отсутствие проблемы, поэтому здесь без «пусто». */}
              <TableCell className="text-xs text-muted-foreground">
                {r.error ? <TableText value={r.error} /> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        page={current}
        total={rows.length}
        limit={limit}
        onPageChange={setPage}
        limitOptions={PREVIEW_PAGE_SIZES}
        onLimitChange={(n) => {
          setLimit(n)
          setPage(1)
        }}
      />
    </div>
  )
}
