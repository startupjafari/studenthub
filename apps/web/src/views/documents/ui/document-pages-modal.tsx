'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronUp, Eye, RefreshCw, Trash2, Upload } from 'lucide-react'
import {
  attachDocumentFiles,
  documentKeys,
  removeDocumentFile,
  reorderDocumentFiles,
  replaceDocumentFile,
  uploadDocumentFile,
  type DocumentDto,
} from '../../../entities/document'
import { Button, useConfirm } from '../../../shared/ui'
import { formatBytes, isOversizeOnPick, useByteUnitLabel } from '../../../shared/lib'
import { DocModal } from './doc-modal'

// Те же типы, что принимает сервер для документа (PDF/JPG/PNG).
const PAGE_ACCEPT = 'application/pdf,image/jpeg,image/png'
const PAGE_MIME = new Set(PAGE_ACCEPT.split(','))

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

const MIME_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
}

// Страницы документа: порядок, замена страницы, удаление, добавление. Сервер держит те же
// правила: единственную страницу не удалить, документ на проверке по запросу не меняется
// (409 — показываем подсказку, а не «Конфликт данных»).
export function DocumentPagesModal({
  doc: initial,
  onOpenPage,
  onClose,
}: {
  doc: DocumentDto
  onOpenPage: (fileId: string) => void
  onClose: () => void
}) {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()
  const unit = useByteUnitLabel()
  const addRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  // Ответ каждой мутации — документ целиком: держим его здесь, чтобы список страниц
  // обновлялся сразу, не дожидаясь перезапроса таблицы.
  const [doc, setDoc] = useState(initial)
  const [replacing, setReplacing] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const pages = doc.files

  const onDone = (next: DocumentDto, message?: string) => {
    setDoc(next)
    void qc.invalidateQueries({ queryKey: documentKeys.all })
    if (message) toast.success(message)
  }
  const onFail = (e: unknown) => {
    const code = errCode(e)
    toast.error(code === 'CONFLICT' ? t('pagesLocked') : tErr(code))
  }

  // Клиентская пред-проверка типа и размера (FRONTEND_RULES §7): сервер всё равно
  // проверит по содержимому, но человек не ждёт загрузки ради отказа.
  function rejectFile(file: File): string | null {
    if (!PAGE_MIME.has(file.type)) return 'FILE_TYPE_NOT_ALLOWED'
    if (isOversizeOnPick(file)) return 'FILE_TOO_LARGE'
    return null
  }

  const reorderMut = useMutation({
    mutationFn: (ids: string[]) => reorderDocumentFiles(doc.id, ids),
    onSuccess: (next) => onDone(next),
    onError: onFail,
  })
  const removeMut = useMutation({
    mutationFn: (fileId: string) => removeDocumentFile(doc.id, fileId),
    onSuccess: (next) => onDone(next, t('pageRemoved')),
    onError: onFail,
  })

  async function upload(file: File): Promise<string | null> {
    const bad = rejectFile(file)
    if (bad) {
      toast.error(tErr(bad))
      return null
    }
    return (await uploadDocumentFile(file)).id
  }

  async function onReplacePicked(file: File | undefined): Promise<void> {
    const target = replacing
    if (!file || !target) return
    setUploading(true)
    try {
      const fileId = await upload(file)
      if (fileId) onDone(await replaceDocumentFile(doc.id, target, fileId), t('pageReplaced'))
    } catch (e) {
      onFail(e)
    } finally {
      setUploading(false)
      setReplacing(null)
    }
  }

  async function onAddPicked(list: FileList | null): Promise<void> {
    if (!list || list.length === 0) return
    setUploading(true)
    try {
      const ids: string[] = []
      for (const file of Array.from(list)) {
        const id = await upload(file)
        if (id) ids.push(id)
      }
      if (ids.length > 0) onDone(await attachDocumentFiles(doc.id, ids), t('pagesAdded'))
    } catch (e) {
      onFail(e)
    } finally {
      setUploading(false)
    }
  }

  function move(i: number, dir: -1 | 1): void {
    const j = i + dir
    if (j < 0 || j >= pages.length) return
    const ids = pages.map((p) => p.id)
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    reorderMut.mutate(ids)
  }

  const busy = uploading || reorderMut.isPending || removeMut.isPending

  return (
    <DocModal title={t('pagesTitle')} onClose={onClose}>
      <input
        ref={addRef}
        type="file"
        multiple
        accept={PAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          void onAddPicked(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept={PAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          void onReplacePicked(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <p className="text-xs text-muted-foreground">{t('pagesHint')}</p>
      {pages.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('pagesEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {pages.map((page, i) => {
            const n = i + 1
            return (
              <li
                key={page.id}
                className="flex items-center gap-1 rounded-lg border border-border py-1 pr-1 pl-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {t('pageN', { n })}
                  <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                    {MIME_LABEL[page.mime] ?? page.mime} · {formatBytes(page.size, unit)}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('pageOpen', { n })}
                  onClick={() => onOpenPage(page.id)}
                >
                  <Eye className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('pageMoveUp', { n })}
                  disabled={busy || i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ChevronUp className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('pageMoveDown', { n })}
                  disabled={busy || i === pages.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ChevronDown className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('pageReplace', { n })}
                  disabled={busy}
                  loading={uploading && replacing === page.id}
                  onClick={() => {
                    setReplacing(page.id)
                    replaceRef.current?.click()
                  }}
                >
                  <RefreshCw className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('pageRemove', { n })}
                  // Единственную страницу сервер не удалит: кнопку гасим, причину — ниже.
                  disabled={busy || pages.length === 1}
                  className="hover:text-destructive"
                  onClick={() => {
                    void confirm({
                      title: t('pageRemoveConfirm', { n }),
                      confirmLabel: t('actionDelete'),
                      destructive: true,
                    }).then((ok) => {
                      if (ok) removeMut.mutate(page.id)
                    })
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      {pages.length === 1 && <p className="text-xs text-muted-foreground">{t('pagesLastHint')}</p>}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          loading={uploading && replacing === null}
          disabled={busy}
          onClick={() => addRef.current?.click()}
        >
          <Upload className="size-4" aria-hidden /> {t('pagesAdd')}
        </Button>
      </div>
    </DocModal>
  )
}
