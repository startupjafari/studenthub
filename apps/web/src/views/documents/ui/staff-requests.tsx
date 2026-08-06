'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { CalendarClock, ClipboardList, Plus, Trash2, Users } from 'lucide-react'
import { DOCUMENT_TYPES } from '@studenthub/shared-config'
import { Role } from '@studenthub/shared-types'
import {
  createDocumentRequest,
  documentRequestKeys,
  fetchAuthoredRequests,
  fetchRequestManage,
  fetchSubmission,
  fetchSubmissionFileUrl,
  finalizeSubmission,
  reviewSubmissionItem,
  type StaffRequestSummary,
  type StaffSubmissionItem,
} from '../../../entities/document-request'
import { useAppSelector } from '../../../shared/store'
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from '../../../shared/ui'
import { DocModal } from './doc-modal'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

const SUB_TONE: Record<string, string> = {
  DRAFT: 'secondary',
  SUBMITTED: 'info',
  PARTIAL: 'info',
  ACCEPTED: 'success',
  REJECTED: 'outline',
}
const ITEM_TONE: Record<string, string> = {
  ACCEPTED: 'success',
  REJECTED: 'outline',
  PENDING: 'secondary',
}

// Запросы вуза глазами сотрудника (Ф15C, 15.17): список + создание + проверка комплектов.
export function StaffRequests() {
  const t = useTranslations('Documents')
  const [creating, setCreating] = useState(false)
  const [manageId, setManageId] = useState<string | null>(null)
  const q = useQuery({ queryKey: documentRequestKeys.authored(), queryFn: fetchAuthoredRequests })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden /> {t('req_create')}
        </Button>
      </div>
      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-6" aria-hidden />}
          title={t('req_emptyStaff')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(q.data ?? []).map((r) => (
            <StaffRequestCard key={r.id} req={r} onOpen={() => setManageId(r.id)} />
          ))}
        </div>
      )}
      {creating && <CreateRequestModal onClose={() => setCreating(false)} />}
      {manageId && <ManageRequestModal id={manageId} onClose={() => setManageId(null)} />}
    </div>
  )
}

function StaffRequestCard({ req, onOpen }: { req: StaffRequestSummary; onOpen: () => void }) {
  const t = useTranslations('Documents')
  const due = req.dueAt ? new Date(req.dueAt).toLocaleDateString(t('req_dueLocale')) : null
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
    >
      <h3 className="font-semibold">{req.title}</h3>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Users className="size-4" aria-hidden />
          {t('req_submittedOf', { done: req.submittedCount, total: req.submissionCount })}
        </span>
        <span>{t('req_itemsN', { n: req.itemCount })}</span>
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

interface DraftItem {
  documentType: string
  title: string
  required: boolean
}

function CreateRequestModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const myFacultyId = useAppSelector((s) => s.auth.facultyId)
  const role = useAppSelector((s) => s.auth.role)
  // §15.2: преподаватель вправе запрашивать только учебные типы.
  const availableTypes =
    role === Role.TEACHER ? DOCUMENT_TYPES.filter((d) => d.category === 'ACADEMIC') : DOCUMENT_TYPES
  const firstType = availableTypes[0]!.id
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [items, setItems] = useState<DraftItem[]>([
    { documentType: firstType, title: '', required: true },
  ])
  const [toUniversity, setToUniversity] = useState(true)
  const [toFaculty, setToFaculty] = useState(false)

  const mut = useMutation({
    mutationFn: () => {
      const targets = [
        ...(toUniversity ? [{ targetType: 'UNIVERSITY' as const }] : []),
        ...(toFaculty && myFacultyId
          ? [{ targetType: 'FACULTY' as const, targetId: myFacultyId }]
          : []),
      ]
      return createDocumentRequest({
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt: dueAt ? new Date(dueAt) : undefined,
        items: items.map((it) => ({
          documentType: it.documentType,
          title: it.title.trim() || t(`docType_${it.documentType}`),
          required: it.required,
        })),
        targets,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentRequestKeys.all })
      toast.success(t('req_created'))
      onClose()
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const targetsChosen = toUniversity || (toFaculty && !!myFacultyId)
  const valid = title.trim().length > 0 && items.length > 0 && targetsChosen

  return (
    <DocModal
      title={t('req_create')}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('close')}
          </Button>
          <Button onClick={() => mut.mutate()} loading={mut.isPending} disabled={!valid}>
            {t('req_create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="req-title">{t('req_fieldTitle')}</Label>
          <Input
            id="req-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('req_fieldTitle')}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="req-desc">{t('req_fieldDesc')}</Label>
          <Textarea
            id="req-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="req-due">{t('req_fieldDue')}</Label>
          <Input
            id="req-due"
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-48"
          />
        </div>

        {/* Позиции */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('req_fieldItems')}</span>
          {items.map((it, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
            >
              <Select
                value={it.documentType}
                onValueChange={(v) =>
                  setItems(items.map((x, j) => (j === i ? { ...x, documentType: v } : x)))
                }
              >
                <SelectTrigger aria-label={t('req_fieldType')} className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableTypes.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {t(`docType_${d.id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={it.title}
                onChange={(e) =>
                  setItems(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                }
                placeholder={t(`docType_${it.documentType}`)}
                className="min-w-[140px] flex-1"
              />
              <label className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={it.required}
                  onCheckedChange={(v) =>
                    setItems(items.map((x, j) => (j === i ? { ...x, required: v === true } : x)))
                  }
                />
                {t('req_required')}
              </label>
              {items.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('req_removeItem')}
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              setItems([...items, { documentType: firstType, title: '', required: true }])
            }
          >
            <Plus className="size-4" aria-hidden /> {t('req_addItem')}
          </Button>
        </div>

        {/* Адресаты */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('req_fieldTargets')}</span>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={toUniversity} onCheckedChange={(v) => setToUniversity(v === true)} />
            {t('req_targetUniversity')}
          </label>
          {myFacultyId && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={toFaculty} onCheckedChange={(v) => setToFaculty(v === true)} />
              {t('req_targetFaculty')}
            </label>
          )}
        </div>
      </div>
    </DocModal>
  )
}

function ManageRequestModal({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const [reviewId, setReviewId] = useState<string | null>(null)
  const q = useQuery({
    queryKey: documentRequestKeys.manage(id),
    queryFn: () => fetchRequestManage(id),
  })
  const d = q.data

  return (
    <DocModal title={d?.title ?? t('req_title')} size="xl" onClose={onClose}>
      {q.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : !d ? (
        <p className="text-sm text-destructive">{tErr('NOT_FOUND')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
          <div>
            <p className="mb-1 text-sm font-medium">{t('req_fieldItems')}</p>
            <ul className="flex flex-wrap gap-2">
              {d.items.map((it) => (
                <Badge key={it.id} variant="secondary">
                  {it.title}
                  {it.required && ' *'}
                </Badge>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{t('req_submissions')}</p>
            {d.submissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('req_noSubmissions')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.submissions.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{s.studentName}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.submittedAt
                          ? t('req_submittedAt', {
                              date: new Date(s.submittedAt).toLocaleDateString(t('req_dueLocale')),
                            })
                          : t('req_notSubmitted')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={(SUB_TONE[s.status] ?? 'secondary') as 'secondary'}>
                        {t(`req_sub_${s.status}`)}
                      </Badge>
                      {s.status !== 'DRAFT' && (
                        <Button size="sm" variant="outline" onClick={() => setReviewId(s.id)}>
                          {t('req_review')}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {reviewId && (
        <ReviewSubmissionModal submissionId={reviewId} onClose={() => setReviewId(null)} />
      )}
    </DocModal>
  )
}

function ReviewSubmissionModal({
  submissionId,
  onClose,
}: {
  submissionId: string
  onClose: () => void
}) {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: documentRequestKeys.submission(submissionId),
    queryFn: () => fetchSubmission(submissionId),
  })
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: documentRequestKeys.all })
    void qc.invalidateQueries({ queryKey: documentRequestKeys.submission(submissionId) })
  }
  const err = (e: unknown) => toast.error(tErr(errCode(e)))
  const finalizeMut = useMutation({
    mutationFn: () => finalizeSubmission(submissionId),
    onSuccess: () => {
      invalidate()
      toast.success(t('req_finalized'))
      onClose()
    },
    onError: err,
  })
  const d = q.data
  const reviewed = d?.status === 'ACCEPTED' || d?.status === 'REJECTED'

  return (
    <DocModal
      title={d ? t('req_reviewOf', { name: d.studentName }) : t('req_review')}
      size="xl"
      onClose={onClose}
      footer={
        !reviewed ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('close')}
            </Button>
            <Button onClick={() => finalizeMut.mutate()} loading={finalizeMut.isPending}>
              {t('req_finalize')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t('close')}
          </Button>
        )
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : !d ? (
        <p className="text-sm text-destructive">{tErr('NOT_FOUND')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {d.items.map((it) => (
            <ReviewItem key={it.id} item={it} readOnly={reviewed} onError={err} />
          ))}
        </ul>
      )}
    </DocModal>
  )
}

function ReviewItem({
  item,
  readOnly,
  onError,
}: {
  item: StaffSubmissionItem
  readOnly: boolean
  onError: (e: unknown) => void
}) {
  const t = useTranslations('Documents')
  const qc = useQueryClient()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState(item.rejectionReason ?? '')

  const reviewMut = useMutation({
    mutationFn: (payload: { status: 'ACCEPTED' | 'REJECTED'; rejectionReason?: string }) =>
      reviewSubmissionItem(item.id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentRequestKeys.all })
      setRejecting(false)
    },
    onError,
  })

  const openFile = async (fileId: string) => {
    try {
      const url = await fetchSubmissionFileUrl(item.id, fileId)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      onError(e)
    }
  }

  return (
    <li className="rounded-xl border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium">
          {item.requestItemTitle}
          {item.required && <span className="ml-1 text-destructive">*</span>}
        </span>
        <Badge variant={(ITEM_TONE[item.status] ?? 'secondary') as 'secondary'}>
          {t(`req_item_${item.status}`)}
        </Badge>
      </div>
      {item.document ? (
        <div className="flex flex-col gap-2">
          <div className="text-sm">
            <span className="font-medium">{item.document.title}</span>
            {item.document.numberMasked && (
              <span className="ml-2 text-muted-foreground">{item.document.numberMasked}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {item.document.files.map((f, i) => (
              <Button key={f.id} size="sm" variant="outline" onClick={() => openFile(f.id)}>
                {t('req_openFile', { n: i + 1 })}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('req_notSelected')}</p>
      )}

      {!readOnly && item.document && (
        <div className="mt-3 flex flex-col gap-2">
          {!rejecting ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => reviewMut.mutate({ status: 'ACCEPTED' })}
                loading={reviewMut.isPending && reviewMut.variables?.status === 'ACCEPTED'}
              >
                {t('req_accept')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
                {t('req_reject')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('req_rejectReasonPlaceholder')}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!reason.trim()}
                  loading={reviewMut.isPending}
                  onClick={() =>
                    reviewMut.mutate({ status: 'REJECTED', rejectionReason: reason.trim() })
                  }
                >
                  {t('req_confirmReject')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                  {t('close')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {item.status === 'REJECTED' && item.rejectionReason && (
        <p className="mt-2 text-sm text-destructive">
          {t('req_rejectedReason', { reason: item.rejectionReason })}
        </p>
      )}
    </li>
  )
}
