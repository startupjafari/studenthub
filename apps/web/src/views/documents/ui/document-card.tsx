'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import {
  Archive,
  ArchiveRestore,
  Clock,
  Download,
  FileText,
  History,
  Lock,
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
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { DocModal } from './doc-modal'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

// Тон бейджа статуса.
const STATUS_TONE: Record<string, string> = {
  DRAFT: 'secondary',
  UPLOADED: 'info',
  IN_REVIEW: 'info',
  VERIFIED: 'success',
  ACCEPTED: 'success',
  REJECTED: 'outline',
  NEEDS_REPLACEMENT: 'outline',
  EXPIRING: 'outline',
  EXPIRED: 'outline',
  ARCHIVED: 'secondary',
}

export function DocumentCard({ doc }: { doc: DocumentDto }) {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const locale = useLocale()
  const qc = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [history, setHistory] = useState(false)
  const [access, setAccess] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

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
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale) : '—')
  const menuItem =
    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted'

  return (
    <Card className="transition-shadow hover:ring-ring/50">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FileText className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{doc.title}</p>
            <p className="text-xs text-muted-foreground">
              {t(`docCat_${doc.category}`)} · {t(`docType_${doc.type}`)}
            </p>
          </div>
          <Badge variant={(STATUS_TONE[doc.status] ?? 'secondary') as 'secondary'}>
            {t(`docStatus_${doc.status}`)}
          </Badge>
          {/* Меню действий */}
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              aria-label={t('actions')}
              onClick={() => setMenuOpen((o) => !o)}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-9 z-20 w-52 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"
              >
                {firstFile && (
                  <>
                    <button
                      type="button"
                      className={menuItem}
                      onClick={() => {
                        setMenuOpen(false)
                        void openFile(firstFile.id, false)
                      }}
                    >
                      <FileText className="size-4 text-muted-foreground" aria-hidden />{' '}
                      {t('actionOpen')}
                    </button>
                    <button
                      type="button"
                      className={menuItem}
                      onClick={() => {
                        setMenuOpen(false)
                        void openFile(firstFile.id, true)
                      }}
                    >
                      <Download className="size-4 text-muted-foreground" aria-hidden />{' '}
                      {t('actionDownload')}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false)
                    setEditing(true)
                  }}
                >
                  <Pencil className="size-4 text-muted-foreground" aria-hidden /> {t('actionEdit')}
                </button>
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false)
                    setAccess(true)
                  }}
                >
                  <Users className="size-4 text-muted-foreground" aria-hidden /> {t('actionAccess')}
                </button>
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false)
                    setHistory(true)
                  }}
                >
                  <History className="size-4 text-muted-foreground" aria-hidden />{' '}
                  {t('actionHistory')}
                </button>
                {doc.archivedAt ? (
                  <button
                    type="button"
                    className={menuItem}
                    onClick={() => {
                      setMenuOpen(false)
                      unarchiveMut.mutate()
                    }}
                  >
                    <ArchiveRestore className="size-4 text-muted-foreground" aria-hidden />{' '}
                    {t('actionUnarchive')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={menuItem}
                    onClick={() => {
                      setMenuOpen(false)
                      archiveMut.mutate()
                    }}
                  >
                    <Archive className="size-4 text-muted-foreground" aria-hidden />{' '}
                    {t('actionArchive')}
                  </button>
                )}
                <button
                  type="button"
                  className={cn(menuItem, 'text-destructive hover:bg-destructive/10')}
                  onClick={() => {
                    setMenuOpen(false)
                    void confirm({ title: t('deleteConfirm'), destructive: true }).then((ok) => {
                      if (ok) delMut.mutate()
                    })
                  }}
                >
                  <Trash2 className="size-4" aria-hidden /> {t('actionDelete')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Данные документа */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <Field label={t('fieldNumber')} value={doc.numberMasked ?? '—'} mono />
          <Field label={t('fieldFiles')} value={String(doc.fileCount)} />
          <Field label={t('fieldIssuedAt')} value={fmt(doc.issuedAt)} />
          <Field label={t('fieldExpiresAt')} value={fmt(doc.expiresAt)} />
        </dl>

        {doc.rejectionReason && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {doc.rejectionReason}
          </p>
        )}

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {doc.accessCount > 0 ? (
              <Users className="size-3.5" aria-hidden />
            ) : (
              <Lock className="size-3.5" aria-hidden />
            )}
            {doc.accessCount > 0 ? t('sharedWith', { count: doc.accessCount }) : t('onlyMe')}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {fmt(doc.createdAt)}
          </span>
        </div>
      </CardContent>

      {editing && <EditModal doc={doc} onClose={() => setEditing(false)} />}
      {history && <HistoryModal docId={doc.id} onClose={() => setHistory(false)} />}
      {access && <AccessModal docId={doc.id} onClose={() => setAccess(false)} />}
    </Card>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('truncate', mono && 'font-mono tabular-nums')}>{value}</dd>
    </div>
  )
}

function EditModal({ doc, onClose }: { doc: DocumentDto; onClose: () => void }) {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [title, setTitle] = useState(doc.title)
  const [issuedBy, setIssuedBy] = useState(doc.issuedBy ?? '')
  const [comment, setComment] = useState(doc.comment ?? '')

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
            disabled={!title.trim()}
            onClick={() => mut.mutate()}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-sm">
        {t('fieldTitle')}
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
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
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const myFacultyId = useAppSelector((s) => s.auth.facultyId)

  const [target, setTarget] = useState<'UNIVERSITY' | 'DEPARTMENT'>('UNIVERSITY')
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

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
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('grantExpiry')}
          <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </label>
        <Button
          type="button"
          className="w-fit"
          loading={grantMut.isPending}
          disabled={!reason.trim()}
          onClick={() => grantMut.mutate()}
        >
          {t('grantSubmit')}
        </Button>
      </div>
    </DocModal>
  )
}
