'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { AlertTriangle, FileSearch, FileText, FolderLock } from 'lucide-react'
import {
  fetchDocumentPlatform,
  platformDocumentFileUrl,
  type DocumentDto,
} from '../../../entities/document'
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  PageHeader,
  Textarea,
} from '../../../shared/ui'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

// Спец-доступ платформенного админа к документам (Ф15D, 15.21).
// Обычного доступа к содержимому нет: открытие файла требует причину и пишется в аудит+журнал.
export function PlatformDocumentsView() {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const [docId, setDocId] = useState('')
  const [reason, setReason] = useState('')
  const [doc, setDoc] = useState<DocumentDto | null>(null)

  const onErr = (e: unknown) => toast.error(tErr(errCode(e)))

  const loadMut = useMutation({
    mutationFn: () => fetchDocumentPlatform(docId.trim()),
    onSuccess: (d) => setDoc(d),
    onError: (e) => {
      setDoc(null)
      onErr(e)
    },
  })

  const openMut = useMutation({
    mutationFn: (fileId: string) => platformDocumentFileUrl(docId.trim(), fileId, reason.trim()),
    onSuccess: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
    onError: onErr,
  })

  const reasonValid = reason.trim().length >= 5

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader icon={FolderLock} title={t('pa_title')} subtitle={t('pa_subtitle')} />

      <Alert variant="warning">
        <AlertTriangle aria-hidden />
        <AlertDescription>{t('pa_warning')}</AlertDescription>
      </Alert>

      <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pa-id">{t('pa_docId')}</Label>
          <div className="flex gap-2">
            <Input
              id="pa-id"
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              placeholder="uuid"
            />
            <Button
              onClick={() => loadMut.mutate()}
              loading={loadMut.isPending}
              disabled={!docId.trim()}
            >
              <FileSearch className="size-4" aria-hidden /> {t('pa_load')}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pa-reason">{t('pa_reason')}</Label>
          <Textarea
            id="pa-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={t('pa_reasonHint')}
          />
        </div>
      </div>

      {doc && (
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-primary" aria-hidden />
            <div>
              <p className="font-semibold">{doc.title}</p>
              <p className="text-xs text-muted-foreground">
                {doc.type} · {doc.numberMasked ?? '—'} · {t('pa_files', { n: doc.fileCount })}
              </p>
            </div>
          </div>
          {doc.files.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pa_noFiles')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {doc.files.map((f, i) => (
                <Button
                  key={f.id}
                  size="sm"
                  variant="outline"
                  disabled={!reasonValid}
                  loading={openMut.isPending && openMut.variables === f.id}
                  onClick={() => openMut.mutate(f.id)}
                >
                  {t('pa_openFile', { n: i + 1 })}
                </Button>
              ))}
            </div>
          )}
          {!reasonValid && (
            <p className="text-xs text-muted-foreground">{t('pa_reasonRequired')}</p>
          )}
        </div>
      )}
    </div>
  )
}
