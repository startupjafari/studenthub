'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Download, FileText } from 'lucide-react'
import {
  fetchAttachmentUrl,
  type ApplicationAttachment,
  type ApplicationHistoryEntry,
  type ApplicationStatusValue,
} from '../../../entities/application'
import { cn } from '../../../shared/lib/utils'

// Цвет бейджа по статусу.
const STATUS_STYLE: Record<ApplicationStatusValue, string> = {
  NEW: 'bg-muted text-foreground',
  PROCESSING: 'bg-primary/10 text-primary',
  CLARIFICATION: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  APPROVED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  REJECTED: 'bg-destructive/15 text-destructive',
  READY: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  CLOSED: 'bg-muted text-muted-foreground',
}

export function StatusBadge({ status }: { status: ApplicationStatusValue }) {
  const t = useTranslations('Applications')
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        STATUS_STYLE[status],
      )}
    >
      {t(`status${status}`)}
    </span>
  )
}

export function StatusTimeline({ history }: { history: ApplicationHistoryEntry[] }) {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const fmt = (iso: string): string =>
    new Date(iso).toLocaleString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <ol className="flex flex-col gap-3">
      {history.map((h) => (
        <li key={h.id} className="flex gap-3">
          <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={h.toStatus} />
              <span className="text-xs text-muted-foreground">{fmt(h.createdAt)}</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {h.fromStatus === null
                ? t('systemInitial')
                : `${h.changedBy.lastName} ${h.changedBy.firstName}`}
            </p>
            {h.comment && <p className="mt-1 text-sm">{h.comment}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function AttachmentList({
  applicationId,
  attachments,
}: {
  applicationId: string
  attachments: ApplicationAttachment[]
}) {
  const t = useTranslations('Applications')
  const tErr = useTranslations('Errors')
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function open(fileId: string): Promise<void> {
    setLoadingId(fileId)
    try {
      const url = await fetchAttachmentUrl(applicationId, fileId)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
    } finally {
      setLoadingId(null)
    }
  }

  if (attachments.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noAttachments')}</p>
  }

  return (
    <ul className="flex flex-col gap-2">
      {attachments.map((a) => (
        <li
          key={a.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{a.mime}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {(a.size / 1024).toFixed(0)} КБ
            </span>
          </span>
          <button
            type="button"
            onClick={() => open(a.id)}
            disabled={loadingId === a.id}
            aria-label={t('download')}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Download className="size-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}
