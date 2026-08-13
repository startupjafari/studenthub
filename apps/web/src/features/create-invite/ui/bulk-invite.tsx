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
import { Badge, Button, EmptyState, Modal, Skeleton } from '../../../shared/ui'
import { bulkPreviewRequest, bulkCreateRequest, inviteKeys } from '../../../entities/invite'

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
  if (rows.length === 0) {
    return <EmptyState title={t('bulk.nothingReady')} />
  }
  return (
    <div className="max-h-[45vh] overflow-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">{t('bulk.colLine')}</th>
            <th className="px-3 py-2 font-medium">{t('bulk.colEmail')}</th>
            <th className="px-3 py-2 font-medium">{t('bulk.colGroup')}</th>
            <th className="px-3 py-2 font-medium">{t('bulk.colRole')}</th>
            <th className="px-3 py-2 font-medium">{t('bulk.colStatus')}</th>
            <th className="px-3 py-2 font-medium">{t('bulk.colError')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={`${r.line}-${r.email}`} className="align-top">
              <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.line}</td>
              <td className="px-3 py-2">{r.email}</td>
              <td className="px-3 py-2">{r.groupName}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.role}</td>
              <td className="px-3 py-2">
                <Badge variant={STATUS_VARIANT[r.status]}>{t(`bulk.status${r.status}`)}</Badge>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{r.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
