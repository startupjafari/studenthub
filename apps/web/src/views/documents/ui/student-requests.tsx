'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { CalendarClock, ClipboardList, FileCheck2 } from 'lucide-react'
import {
  documentRequestKeys,
  fetchMyRequests,
  fetchRequestForStudent,
  saveSubmission,
  submitSubmission,
  type StudentRequestSummary,
} from '../../../entities/document-request'
import { documentKeys, fetchDocuments, type DocumentDto } from '../../../entities/document'
import {
  Badge,
  Button,
  EmptyState,
  FieldError,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { DocModal } from './doc-modal'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

const ITEM_TONE: Record<string, string> = {
  ACCEPTED: 'success',
  REJECTED: 'outline',
  PENDING: 'secondary',
}
const SUB_TONE: Record<string, string> = {
  DRAFT: 'secondary',
  SUBMITTED: 'info',
  PARTIAL: 'info',
  ACCEPTED: 'success',
  REJECTED: 'outline',
}

// Запросы вуза глазами студента (Ф15C, 15.17): список + детальный чек-лист с ответом.
export function StudentRequests() {
  const t = useTranslations('Documents')
  const [openId, setOpenId] = useState<string | null>(null)
  const q = useQuery({ queryKey: documentRequestKeys.mine(), queryFn: fetchMyRequests })

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    )
  }
  const requests = q.data ?? []
  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList className="size-6" aria-hidden />}
        title={t('req_emptyStudent')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {requests.map((r) => (
          <RequestCard key={r.id} req={r} onOpen={() => setOpenId(r.id)} />
        ))}
      </div>
      {openId && <StudentRequestModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function RequestCard({ req, onOpen }: { req: StudentRequestSummary; onOpen: () => void }) {
  const t = useTranslations('Documents')
  const locale = t('req_dueLocale')
  const due = req.dueAt ? new Date(req.dueAt).toLocaleDateString(locale) : null
  const done = req.filledRequired >= req.requiredCount
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{req.title}</h3>
        {req.submissionStatus && (
          <Badge variant={(SUB_TONE[req.submissionStatus] ?? 'secondary') as 'secondary'}>
            {t(`req_sub_${req.submissionStatus}`)}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <FileCheck2 className="size-4" aria-hidden />
          <span className={cn(done && 'text-success')}>
            {t('req_progress', { done: req.filledRequired, total: req.requiredCount })}
          </span>
        </span>
        {due && (
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-4" aria-hidden />
            {t('req_due', { date: due })}
          </span>
        )}
      </div>
    </button>
  )
}

function StudentRequestModal({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('Documents')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const detail = useQuery({
    queryKey: documentRequestKeys.detail(id),
    queryFn: () => fetchRequestForStudent(id),
  })
  // Свои активные документы для выбора в позициях.
  const docsQ = useQuery({
    queryKey: documentKeys.list({ view: 'active' }),
    queryFn: () => fetchDocuments({ view: 'active' }),
  })
  const [picks, setPicks] = useState<Record<string, string | null> | null>(null)

  const current = useMemo<Record<string, string | null>>(() => {
    if (picks) return picks
    const base: Record<string, string | null> = {}
    for (const it of detail.data?.items ?? []) {
      const si = detail.data?.submission?.items.find((s) => s.requestItemId === it.id)
      base[it.id] = si?.document?.id ?? null
    }
    return base
  }, [picks, detail.data])

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: documentRequestKeys.all })
  }
  const err = (e: unknown) => toast.error(tErr(errCode(e)))

  const saveMut = useMutation({
    mutationFn: () =>
      saveSubmission(id, {
        items: Object.entries(current).map(([requestItemId, documentId]) => ({
          requestItemId,
          documentId,
        })),
      }),
    onSuccess: () => {
      invalidate()
      toast.success(t('req_saved'))
    },
    onError: err,
  })
  const submitMut = useMutation({
    mutationFn: async () => {
      await saveSubmission(id, {
        items: Object.entries(current).map(([requestItemId, documentId]) => ({
          requestItemId,
          documentId,
        })),
      })
      return submitSubmission(id)
    },
    onSuccess: () => {
      invalidate()
      toast.success(t('req_submitted'))
      onClose()
    },
    onError: err,
  })

  const d = detail.data
  const locked = d?.submission?.status === 'SUBMITTED' || d?.submission?.status === 'ACCEPTED'
  const requiredFilled =
    d?.items.filter((it) => it.required).every((it) => !!current[it.id]) ?? false
  // Отправку не блокируем молча: по нажатию подсвечиваем незаполненные обязательные позиции.
  const [submitted, setSubmitted] = useState(false)
  const itemError = (it: { id: string; required: boolean }): string | null =>
    submitted && it.required && !current[it.id] ? tCommon('fieldRequired') : null

  const docsByType = (type: string): DocumentDto[] =>
    (docsQ.data ?? []).filter((x) => x.type === type)

  return (
    <DocModal
      title={d?.title ?? t('req_title')}
      size="xl"
      onClose={onClose}
      footer={
        !locked ? (
          <>
            <Button variant="ghost" onClick={() => saveMut.mutate()} loading={saveMut.isPending}>
              {t('req_saveDraft')}
            </Button>
            <Button
              onClick={() => {
                setSubmitted(true)
                if (requiredFilled) submitMut.mutate()
              }}
              loading={submitMut.isPending}
            >
              {t('req_submit')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t('close')}
          </Button>
        )
      }
    >
      {detail.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : !d ? (
        <p className="text-sm text-destructive">{tErr('NOT_FOUND')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
          {locked && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              {t(`req_sub_${d.submission?.status}`)}
            </div>
          )}
          <ul className="flex flex-col gap-3">
            {d.items.map((it) => {
              const si = d.submission?.items.find((s) => s.requestItemId === it.id)
              const options = docsByType(it.documentType)
              return (
                <li key={it.id} className="rounded-xl border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {it.title}
                      {it.required && <span className="ml-1 text-destructive">*</span>}
                    </span>
                    {si && (
                      <Badge variant={(ITEM_TONE[si.status] ?? 'secondary') as 'secondary'}>
                        {t(`req_item_${si.status}`)}
                      </Badge>
                    )}
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {t(`docType_${it.documentType}`)}
                  </p>
                  {!locked ? (
                    <Select
                      value={current[it.id] ?? '__none__'}
                      onValueChange={(v) =>
                        setPicks({ ...current, [it.id]: v === '__none__' ? null : v })
                      }
                    >
                      <SelectTrigger aria-label={it.title} aria-invalid={!!itemError(it)}>
                        <SelectValue placeholder={t('req_pickDoc')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t('req_notSelected')}</SelectItem>
                        {options.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm">{si?.document?.title ?? t('req_notSelected')}</p>
                  )}
                  {!locked && <FieldError className="mt-1">{itemError(it)}</FieldError>}
                  {options.length === 0 && !locked && (
                    <p className="mt-1 text-xs text-muted-foreground">{t('req_noMatchingDocs')}</p>
                  )}
                  {si?.status === 'REJECTED' && si.rejectionReason && (
                    <p className="mt-2 text-sm text-destructive">
                      {t('req_rejectedReason', { reason: si.rejectionReason })}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </DocModal>
  )
}
