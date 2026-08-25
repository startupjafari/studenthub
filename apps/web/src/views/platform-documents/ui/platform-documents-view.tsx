'use client'

import { useState } from 'react'
import { useMutation, useQueries } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { AlertTriangle, FileSearch, FileText, History } from 'lucide-react'
import { auditKeys, fetchAudit, type AuditLogItem } from '../../../entities/audit'
import {
  fetchDocumentPlatform,
  platformDocumentFileUrl,
  type DocumentDto,
} from '../../../entities/document'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  EmptyState,
  FieldError,
  Input,
  Label,
  Modal,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableText,
  Textarea,
} from '../../../shared/ui'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

// Минимальная длина причины — как в серверной схеме PlatformDocumentAccessSchema.
const REASON_MIN = 5
// Действия аудита, которые пишет спец-режим (documents.service: platformGet / platformFileUrl).
const LOG_ACTIONS = ['DOCUMENT_PLATFORM_DOWNLOAD', 'DOCUMENT_PLATFORM_VIEW'] as const
const LOG_LIMIT = 20
// Ширины: дата · документ · действие · основание · кнопка.
const LOG_COLS = ['16%', '26%', '14%', '32%', '12%'] as const

interface AccessRequest {
  docId: string
  reason: string
}

// Спец-доступ платформенного админа к документам (Ф15D, 15.21). Обычного доступа к
// содержимому нет: открытие файла требует причину и пишется в аудит + журнал документа.
// ID и основание собирает модалка: это разовый запрос, а не панель управления страницей —
// постоянная форма занимала пол-экрана и висела пустой всё остальное время.
export function PlatformDocumentsView() {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const [request, setRequest] = useState<AccessRequest | null>(null)
  const [doc, setDoc] = useState<DocumentDto | null>(null)
  // Две стадии одного сценария, обе в модалке: сначала запрос (ID + основание),
  // после загрузки — карточка документа с файлами. Страница под ними — только журнал.
  const [stage, setStage] = useState<'none' | 'form' | 'doc'>('none')
  // Значения, которыми открыть форму (правка запроса или «повторить» из журнала).
  const [prefill, setPrefill] = useState<AccessRequest | null>(null)

  function openForm(values: AccessRequest | null = null): void {
    setPrefill(values)
    setStage('form')
  }

  const onErr = (e: unknown) => toast.error(tErr(errCode(e)))

  const loadMut = useMutation({
    mutationFn: (req: AccessRequest) => fetchDocumentPlatform(req.docId),
    onSuccess: (d, req) => {
      setDoc(d)
      setRequest(req)
      setStage('doc')
    },
    onError: (e) => {
      setDoc(null)
      onErr(e)
    },
  })

  const openMut = useMutation({
    mutationFn: (fileId: string) =>
      platformDocumentFileUrl(request!.docId, fileId, request!.reason),
    onSuccess: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
    onError: onErr,
  })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('pa_title')}
        subtitle={t('pa_subtitle')}
        actions={
          <Button size="md" onClick={() => openForm()}>
            <FileSearch className="size-4" aria-hidden /> {t('pa_request')}
          </Button>
        }
      />

      <AccessLog onRepeat={openForm} />

      {stage === 'form' && (
        <AccessModal
          initial={prefill ?? request}
          pending={loadMut.isPending}
          onSubmit={(req) => loadMut.mutate(req)}
          onClose={() => {
            setStage('none')
            setPrefill(null)
          }}
        />
      )}

      {stage === 'doc' && doc && request && (
        <DocumentModal
          doc={doc}
          request={request}
          openingFileId={openMut.isPending ? (openMut.variables ?? null) : null}
          onOpenFile={(fileId) => openMut.mutate(fileId)}
          onBack={() => openForm(request)}
          onClose={() => setStage('none')}
        />
      )}
    </div>
  )
}

// Карточка документа — тоже в модалке: экран остаётся журналом, а разбор одного
// документа читается как отдельный шаг. «Назад» возвращает к форме запроса.
function DocumentModal({
  doc,
  request,
  openingFileId,
  onOpenFile,
  onBack,
  onClose,
}: {
  doc: DocumentDto
  request: AccessRequest
  openingFileId: string | null
  onOpenFile: (fileId: string) => void
  onBack: () => void
  onClose: () => void
}) {
  const t = useTranslations('Documents')
  const locale = useLocale()

  return (
    <Modal onClose={onClose} onBack={onBack} backLabel={t('pa_change')} title={doc.title} size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t(`docStatus_${doc.status}`)}</Badge>
          <span className="text-sm text-muted-foreground">{t(`docCat_${doc.category}`)}</span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <Field label={t('fieldNumber')} value={doc.numberMasked} mono />
          <Field label={t('fieldIssuedBy')} value={doc.issuedBy} />
          <Field
            label={t('fieldIssuedAt')}
            value={doc.issuedAt ? new Date(doc.issuedAt).toLocaleDateString(locale) : null}
          />
          <Field
            label={t('fieldExpiresAt')}
            value={doc.expiresAt ? new Date(doc.expiresAt).toLocaleDateString(locale) : null}
          />
        </dl>

        {/* Основание видно рядом с файлами: именно оно уйдёт в аудит при открытии. */}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <span className="text-xs text-muted-foreground">
            {t('pa_reasonLogged', { reason: request.reason })}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('pa_files', { n: doc.fileCount })}
          </span>
          {doc.files.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pa_noFiles')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {doc.files.map((f, i) => (
                <Button
                  key={f.id}
                  size="sm"
                  variant="outline"
                  loading={openingFileId === f.id}
                  onClick={() => onOpenFile(f.id)}
                >
                  <FileText className="size-4" aria-hidden />
                  {t('pa_openFile', { n: i + 1 })}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// Форма запроса: ID документа и основание. Оба поля обязательны — файл без причины
// открыть нельзя, и проверяем это здесь, а не гашением кнопок на странице.
function AccessModal({
  initial,
  pending,
  onSubmit,
  onClose,
}: {
  initial: AccessRequest | null
  pending: boolean
  onSubmit: (req: AccessRequest) => void
  onClose: () => void
}) {
  const t = useTranslations('Documents')
  const tCommon = useTranslations('Common')
  const [docId, setDocId] = useState(initial?.docId ?? '')
  const [reason, setReason] = useState(initial?.reason ?? '')
  const [submitted, setSubmitted] = useState(false)

  const errors = {
    docId: !docId.trim() ? tCommon('fieldRequired') : null,
    reason: reason.trim().length < REASON_MIN ? t('pa_reasonRequired') : null,
  }
  const show = (key: keyof typeof errors): string | null => (submitted ? errors[key] : null)

  function submit(): void {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    onSubmit({ docId: docId.trim(), reason: reason.trim() })
  }

  return (
    <Modal onClose={onClose} title={t('pa_request')} size="md">
      <div className="flex flex-col gap-4">
        <Alert variant="warning">
          <AlertTriangle aria-hidden />
          <AlertDescription>{t('pa_warning')}</AlertDescription>
        </Alert>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pa-id">{t('pa_docId')}</Label>
          <Input
            id="pa-id"
            autoFocus
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            placeholder="uuid"
            className="font-mono"
            aria-invalid={!!show('docId')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          <FieldError>{show('docId')}</FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pa-reason">{t('pa_reason')}</Label>
          <Textarea
            id="pa-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('pa_reasonHint')}
            aria-invalid={!!show('reason')}
          />
          {show('reason') ? (
            <FieldError>{show('reason')}</FieldError>
          ) : (
            <p className="text-xs text-muted-foreground">{t('pa_reasonRequired')}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" loading={pending} onClick={submit}>
            <FileSearch className="size-4" aria-hidden /> {t('pa_load')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  const tTable = useTranslations('Table')
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'truncate font-mono tabular-nums' : 'truncate'}>
        {value ?? <span className="text-muted-foreground">{tTable('empty')}</span>}
      </dd>
    </div>
  )
}

// Журнал спец-доступа: последние обращения к чужим документам из аудита
// (DOCUMENT_PLATFORM_VIEW — карточка, DOCUMENT_PLATFORM_DOWNLOAD — файл, с основанием).
// Отдельного «срока доступа» у режима нет: он разовый, каждое открытие требует нового
// основания — поэтому таблица показывает историю обращений, а не выданные права.
function AccessLog({ onRepeat }: { onRepeat: (req: AccessRequest) => void }) {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const locale = useLocale()

  // Фильтр аудита принимает одно действие, поэтому берём оба списка и склеиваем по дате.
  const queries = useQueries({
    queries: LOG_ACTIONS.map((action) => ({
      queryKey: auditKeys.list({ action, page: 1, limit: LOG_LIMIT }),
      queryFn: () => fetchAudit({ action, page: 1, limit: LOG_LIMIT }),
    })),
  })
  const loading = queries.some((q) => q.isLoading)
  const error = queries.some((q) => q.isError)
  const rows = queries
    .flatMap((q) => q.data?.items ?? [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, LOG_LIMIT)

  const reasonOf = (entry: AuditLogItem): string | null => {
    const value = entry.metadata?.reason
    return typeof value === 'string' ? value : null
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
      {error ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !loading && rows.length === 0 ? (
        <EmptyState icon={<History className="size-6" aria-hidden />} title={t('pa_logEmpty')} />
      ) : (
        <Table fixed scrollBody fill cols={LOG_COLS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pa_colDate')}</TableHead>
              <TableHead>{t('pa_colDocument')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('pa_colAction')}</TableHead>
              <TableHead className="hidden lg:table-cell">{t('pa_reason')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableSkeletonRows columns={5} />}
            {rows.map((entry) => (
              <TableRow key={entry.id} className="hover:bg-muted/40">
                <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                  {new Date(entry.createdAt).toLocaleString(locale, {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <TableText value={entry.entityId} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant={entry.action === LOG_ACTIONS[0] ? 'warning' : 'secondary'}>
                    {t(entry.action === LOG_ACTIONS[0] ? 'pa_actionFile' : 'pa_actionCard')}
                  </Badge>
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  <TableText value={reasonOf(entry)} />
                </TableCell>
                <TableCell className="text-right">
                  {entry.entityId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onRepeat({ docId: entry.entityId!, reason: reasonOf(entry) ?? '' })
                      }
                    >
                      {t('pa_repeat')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
