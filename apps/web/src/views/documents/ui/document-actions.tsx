'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import {
  Archive,
  ArchiveRestore,
  Download,
  FileText,
  History,
  MoreHorizontal,
  Pencil,
  Trash2,
  Users,
} from 'lucide-react'
import {
  archiveDocument,
  deleteDocument,
  documentKeys,
  fetchDocumentAccess,
  fetchDocumentEvents,
  fetchDocumentFileUrl,
  grantDocumentAccess,
  revokeDocumentAccess,
  unarchiveDocument,
  updateDocument,
  type DocumentDto,
} from '../../../entities/document'
import { useAppSelector } from '../../../shared/store'
import {
  Badge,
  Button,
  DatePicker,
  FieldError,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useConfirm,
} from '../../../shared/ui'
import { DocModal } from './doc-modal'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

// Действия над документом: меню «…» в строке таблицы плюс его модалки (данные, доступ,
// история). Вынесено из строки отдельным компонентом — строка остаётся разметкой, а
// состояние меню и модалок живёт рядом с мутациями.
export function DocumentActions({ doc }: { doc: DocumentDto }) {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [history, setHistory] = useState(false)
  const [access, setAccess] = useState(false)

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: documentKeys.all })
  }
  const err = (e: unknown) => toast.error(tErr(errCode(e)))

  const archiveMut = useMutation({
    mutationFn: () => archiveDocument(doc.id),
    onSuccess: invalidate,
    onError: err,
  })
  const unarchiveMut = useMutation({
    mutationFn: () => unarchiveDocument(doc.id),
    onSuccess: invalidate,
    onError: err,
  })
  const delMut = useMutation({
    mutationFn: () => deleteDocument(doc.id),
    onSuccess: () => {
      invalidate()
      toast.success(t('deleted'))
    },
    onError: err,
  })

  async function openFile(fileId: string, download: boolean): Promise<void> {
    try {
      const url = await fetchDocumentFileUrl(doc.id, fileId)
      if (download) {
        const a = document.createElement('a')
        a.href = url
        a.download = ''
        a.click()
      } else {
        window.open(url, '_blank', 'noopener')
      }
    } catch (e) {
      err(e)
    }
  }

  const firstFile = doc.files[0]

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" icon aria-label={t('actions')}>
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {firstFile && (
            <>
              <DropdownMenuItem onSelect={() => void openFile(firstFile.id, false)}>
                <FileText aria-hidden /> {t('actionOpen')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void openFile(firstFile.id, true)}>
                <Download aria-hidden /> {t('actionDownload')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil aria-hidden /> {t('actionEdit')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAccess(true)}>
            <Users aria-hidden /> {t('actionAccess')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setHistory(true)}>
            <History aria-hidden /> {t('actionHistory')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {doc.archivedAt ? (
            <DropdownMenuItem onSelect={() => unarchiveMut.mutate()}>
              <ArchiveRestore aria-hidden /> {t('actionUnarchive')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => archiveMut.mutate()}>
              <Archive aria-hidden /> {t('actionArchive')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              void confirm({ title: t('deleteConfirm'), destructive: true }).then((ok) => {
                if (ok) delMut.mutate()
              })
            }}
          >
            <Trash2 aria-hidden /> {t('actionDelete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing && <EditModal doc={doc} onClose={() => setEditing(false)} />}
      {history && <HistoryModal docId={doc.id} onClose={() => setHistory(false)} />}
      {access && <AccessModal docId={doc.id} onClose={() => setAccess(false)} />}
    </>
  )
}

function EditModal({ doc, onClose }: { doc: DocumentDto; onClose: () => void }) {
  const t = useTranslations('Documents')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [title, setTitle] = useState(doc.title)
  const [issuedBy, setIssuedBy] = useState(doc.issuedBy ?? '')
  const [comment, setComment] = useState(doc.comment ?? '')
  const [submitted, setSubmitted] = useState(false)
  const titleError = !title.trim() ? tCommon('fieldRequired') : null

  const mut = useMutation({
    mutationFn: () =>
      updateDocument(doc.id, { title, issuedBy: issuedBy || null, comment: comment || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentKeys.all })
      toast.success(t('saved'))
      onClose()
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  return (
    <DocModal
      title={t('actionEdit')}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            loading={mut.isPending}
            onClick={() => {
              setSubmitted(true)
              if (!titleError) mut.mutate()
            }}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-sm">
        {t('fieldTitle')}
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={submitted && !!titleError}
        />
        <FieldError>{submitted ? titleError : null}</FieldError>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t('fieldIssuedBy')}
        <Input value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t('fieldComment')}
        <Input value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      <p className="text-xs text-muted-foreground">{t('numberEditHint')}</p>
    </DocModal>
  )
}

function HistoryModal({ docId, onClose }: { docId: string; onClose: () => void }) {
  const t = useTranslations('Documents')
  const locale = useLocale()
  const q = useQuery({
    queryKey: documentKeys.events(docId),
    queryFn: () => fetchDocumentEvents(docId),
  })
  const events = q.data ?? []

  return (
    <DocModal title={t('historyTitle')} onClose={onClose}>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('historyEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((e) => (
            <li key={e.id} className="flex flex-col border-l-2 border-border pl-3">
              <span className="text-sm font-medium">{t(`evt_${e.action}`)}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(e.createdAt).toLocaleString(locale, {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DocModal>
  )
}

// Управление доступом к документу (ТЗ §9): список грантов + выдача + отзыв.
function AccessModal({ docId, onClose }: { docId: string; onClose: () => void }) {
  const t = useTranslations('Documents')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const myFacultyId = useAppSelector((s) => s.auth.facultyId)

  const [target, setTarget] = useState<'UNIVERSITY' | 'DEPARTMENT'>('UNIVERSITY')
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [submitted, setSubmitted] = useState(false)
  // Основание обязательно: оно уходит в журнал документа и в аудит.
  const reasonError = !reason.trim() ? tCommon('fieldRequired') : null

  const q = useQuery({
    queryKey: documentKeys.access(docId),
    queryFn: () => fetchDocumentAccess(docId),
  })
  const grants = q.data ?? []
  const setData = (list: unknown) => qc.setQueryData(documentKeys.access(docId), list)
  const err = (e: unknown) => toast.error(tErr(errCode(e)))

  const grantMut = useMutation({
    mutationFn: () =>
      grantDocumentAccess(docId, {
        granteeType: target,
        granteeId: target === 'DEPARTMENT' ? (myFacultyId ?? undefined) : undefined,
        reason: reason.trim(),
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      }),
    onSuccess: (list) => {
      setData(list)
      void qc.invalidateQueries({ queryKey: documentKeys.all })
      setReason('')
      setExpiresAt('')
      setSubmitted(false)
      toast.success(t('granted'))
    },
    onError: err,
  })
  const revokeMut = useMutation({
    mutationFn: (accessId: string) => revokeDocumentAccess(docId, accessId),
    onSuccess: (list) => {
      setData(list)
      void qc.invalidateQueries({ queryKey: documentKeys.all })
    },
    onError: err,
  })

  const grantLabel = (g: { granteeType: string }) =>
    g.granteeType === 'UNIVERSITY'
      ? t('grantUniversity')
      : g.granteeType === 'DEPARTMENT'
        ? t('grantDepartment')
        : t('grantUser')
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale) : t('grantForever')

  return (
    <DocModal title={t('accessTitle')} onClose={onClose}>
      {/* Текущие гранты */}
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : grants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('grantEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {grants.map((g) => (
            <li key={g.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{grantLabel(g)}</p>
                <p className="text-xs text-muted-foreground">
                  {t('grantReason')}: {g.reason}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('grantUntil')}: {fmt(g.expiresAt)}
                </p>
              </div>
              {g.active ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={revokeMut.isPending}
                  onClick={() => revokeMut.mutate(g.id)}
                >
                  {t('grantRevoke')}
                </Button>
              ) : (
                <Badge variant="secondary">{t('grantRevoked')}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Новая выдача */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <p className="text-sm font-semibold">{t('grantAdd')}</p>
        <label className="flex flex-col gap-1 text-sm">
          {t('grantTarget')}
          <Select value={target} onValueChange={(v) => setTarget(v as 'UNIVERSITY')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UNIVERSITY">{t('grantUniversity')}</SelectItem>
              {myFacultyId && <SelectItem value="DEPARTMENT">{t('grantDepartment')}</SelectItem>}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('grantReason')}
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('grantReasonHint')}
            aria-invalid={submitted && !!reasonError}
          />
          <FieldError>{submitted ? reasonError : null}</FieldError>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('grantExpiry')}
          <DatePicker value={expiresAt} onChange={setExpiresAt} aria-label={t('grantExpiry')} />
        </label>
        {/* Подтверждающее действие — справа, как во всех окнах (DESIGN_SYSTEM §10.5). */}
        <div className="flex justify-end">
          <Button
            type="button"
            loading={grantMut.isPending}
            onClick={() => {
              setSubmitted(true)
              if (!reasonError) grantMut.mutate()
            }}
          >
            {t('grantSubmit')}
          </Button>
        </div>
      </div>
    </DocModal>
  )
}
