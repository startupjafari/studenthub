'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, FileText, Eye, RefreshCw, X, AlertTriangle } from 'lucide-react'
import {
  attachApplicationDocument,
  removeApplicationDocument,
  fetchApplicationDocumentUrl,
  applicationKeys,
  pickLocale,
  type ApplicationDocumentItem,
  type ServiceRequirement,
} from '../../../entities/application-service'
import { fetchDocuments } from '../../../entities/document'
import { Button, Card } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Инлайн-пикер документа из личного хранилища, отфильтрованный по типу требования.
function StorageDocPicker({
  documentType,
  onPick,
  pending,
}: {
  documentType: string | null
  onPick: (documentId: string) => void
  pending: boolean
}) {
  const t = useTranslations('Applications')
  const q = useQuery({
    queryKey: ['documents', 'picker'],
    queryFn: () => fetchDocuments({}),
  })
  const docs = (q.data ?? []).filter(
    (d) => (!documentType || d.type === documentType) && d.status !== 'ARCHIVED',
  )
  if (q.isLoading) {
    return <p className="px-1 py-2 text-sm text-muted-foreground">…</p>
  }
  if (docs.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3 text-sm">
        <span className="text-muted-foreground">{t('noStorageDocs')}</span>
        <Link href="/documents" className="font-medium text-primary hover:underline">
          {t('uploadToStorage')}
        </Link>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-1">
      {docs.map((d) => (
        <button
          key={d.id}
          type="button"
          disabled={pending}
          onClick={() => onPick(d.id)}
          className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
        >
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{d.title}</span>
        </button>
      ))}
    </div>
  )
}

// Чек-лист требуемых документов (§3/§4): статус, просмотр, выбор из хранилища, замена.
export function DocumentChecklist({
  appId,
  requirements,
  documents,
  editable,
  locale,
  onChanged,
}: {
  appId: string
  requirements: Pick<
    ServiceRequirement,
    'id' | 'documentType' | 'titleRu' | 'titleKk' | 'titleEn' | 'required'
  >[]
  documents: ApplicationDocumentItem[]
  editable: boolean
  locale: string
  onChanged: () => void
}) {
  const t = useTranslations('Applications')
  const qc = useQueryClient()
  const [picking, setPicking] = useState<string | null>(null)
  const byReq = new Map(documents.map((d) => [d.requirementId, d]))

  const attachMut = useMutation({
    mutationFn: (v: { requirementId: string; documentId: string }) =>
      attachApplicationDocument(appId, v.requirementId, v.documentId),
    onSuccess: () => {
      setPicking(null)
      void qc.invalidateQueries({ queryKey: applicationKeys.detail(appId) })
      onChanged()
    },
    onError: () => toast.error(t('loadError')),
  })
  const removeMut = useMutation({
    mutationFn: (requirementId: string) => removeApplicationDocument(appId, requirementId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: applicationKeys.detail(appId) })
      onChanged()
    },
    onError: () => toast.error(t('loadError')),
  })
  const viewMut = useMutation({
    mutationFn: (docId: string) => fetchApplicationDocumentUrl(appId, docId),
    onSuccess: (url) => window.open(url, '_blank', 'noopener'),
    onError: () => toast.error(t('loadError')),
  })

  const DOC_TONE: Record<string, string> = {
    PENDING: 'text-muted-foreground',
    ACCEPTED: 'text-success',
    REJECTED: 'text-destructive',
    REPLACEMENT_REQUIRED: 'text-amber-600 dark:text-amber-400',
  }

  return (
    <div className="flex flex-col gap-2">
      {requirements.map((r) => {
        const attached = byReq.get(r.id)
        const needsReplace = attached?.status === 'REPLACEMENT_REQUIRED'
        return (
          <Card key={r.id} className="flex flex-col gap-2 p-3">
            <div className="flex items-center gap-2">
              {attached && !needsReplace ? (
                <Check className="size-4 shrink-0 text-success" aria-hidden />
              ) : needsReplace ? (
                <AlertTriangle
                  className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden
                />
              ) : (
                <span
                  className="size-4 shrink-0 rounded-full border border-muted-foreground/40"
                  aria-hidden
                />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {pickLocale(r as unknown as Record<string, unknown>, 'title', locale)}
                {!r.required && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({t('optional')})
                  </span>
                )}
              </span>
              {attached && (
                <span className={cn('text-xs font-medium', DOC_TONE[attached.status])}>
                  {t(`docStatus_${attached.status}`)}
                </span>
              )}
            </div>

            {attached && (
              <div className="flex items-center gap-2 pl-6">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {attached.snapshotTitle}
                </span>
                {attached.documentId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => viewMut.mutate(attached.id)}
                    loading={viewMut.isPending}
                  >
                    <Eye className="size-4" aria-hidden />
                    {t('viewDoc')}
                  </Button>
                )}
              </div>
            )}

            {needsReplace && attached?.reviewComment && (
              <p className="pl-6 text-xs text-amber-600 dark:text-amber-400">
                {t('reviewReason')}: {attached.reviewComment}
              </p>
            )}

            {editable && (
              <div className="pl-6">
                {picking === r.id ? (
                  <div className="flex flex-col gap-2">
                    <StorageDocPicker
                      documentType={r.documentType}
                      pending={attachMut.isPending}
                      onPick={(documentId) => attachMut.mutate({ requirementId: r.id, documentId })}
                    />
                    <button
                      type="button"
                      onClick={() => setPicking(null)}
                      className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3.5" aria-hidden />
                      {t('backBtn')}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPicking(r.id)}>
                      {attached ? (
                        <>
                          <RefreshCw className="size-4" aria-hidden />
                          {t('replaceDoc')}
                        </>
                      ) : (
                        t('attachFromStorage')
                      )}
                    </Button>
                    {attached && !needsReplace && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        onClick={() => removeMut.mutate(r.id)}
                        loading={removeMut.isPending}
                      >
                        {t('removeDoc')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
