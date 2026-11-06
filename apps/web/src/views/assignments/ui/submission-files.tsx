'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Download, FileText, Paperclip, X } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { formatBytes, isOversizeOnPick, toApiError, useByteUnitLabel } from '../../../shared/lib'
import {
  deleteSubmissionFileRequest,
  fetchSubmissionFileUrl,
  uploadSubmissionFileRequest,
  type SubmissionFile,
} from '../../../entities/assignment'
import { saveFileByUrl } from '../../../entities/document'

// Совпадает с SUBMISSION_FILES_LIMIT на сервере: кнопку прячем заранее, а не ждём отказа.
export const SUBMISSION_FILES_MAX = 10

interface Props {
  files: SubmissionFile[]
  /** Сдача, к которой относятся файлы; null — работы ещё нет (скачивать нечего). */
  submissionId: string | null
  /** Можно добавлять и убирать файлы — задаётся только у студента, пока работа не отправлена. */
  editable?: { assignmentId: string; onChanged: () => void }
}

/**
 * Файлы работы: список с размером и скачиванием, а у студента до отправки — «Прикрепить»
 * и «Убрать». Одна строка на файл, как у материалов дисциплины: что за файл слева, чем
 * его открыть — справа.
 */
export function SubmissionFiles({ files, submissionId, editable }: Props) {
  const t = useTranslations('Assignments')
  const tErr = useTranslations('Errors')
  const unit = useByteUnitLabel()
  const inputRef = useRef<HTMLInputElement>(null)
  // Какая кнопка ждёт ответа: `dl:<id>` — скачивание, `rm:<id>` — удаление.
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  async function download(fileId: string) {
    if (!submissionId) return
    setBusy(`dl:${fileId}`)
    try {
      saveFileByUrl(await fetchSubmissionFileUrl(submissionId, fileId))
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    } finally {
      setBusy(null)
    }
  }

  async function remove(fileId: string) {
    if (!editable) return
    setBusy(`rm:${fileId}`)
    try {
      await deleteSubmissionFileRequest(editable.assignmentId, fileId)
      editable.onChanged()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    } finally {
      setBusy(null)
    }
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    if (!editable) return
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    const room = SUBMISSION_FILES_MAX - files.length
    if (picked.length > room) toast.error(t('filesLimit', { n: SUBMISSION_FILES_MAX }))
    // По одному: прогресс один на строку, и отказ по одному файлу не роняет остальные.
    for (const file of picked.slice(0, Math.max(0, room))) {
      if (isOversizeOnPick(file)) {
        toast.error(`${file.name}: ${tErr('FILE_TOO_LARGE')}`)
        continue
      }
      setProgress(0)
      try {
        await uploadSubmissionFileRequest(editable.assignmentId, file, setProgress)
      } catch (err) {
        toast.error(`${file.name}: ${tErr(toApiError(err).code)}`)
      }
    }
    setProgress(null)
    editable.onChanged()
  }

  if (files.length === 0 && !editable) return null

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{t('files')}</span>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((f, i) => (
            <li
              key={f.id}
              className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">
                {f.name ?? t('fileN', { n: i + 1 })}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatBytes(f.size, unit)}
              </span>
              {submissionId && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('fileDownload')}
                  loading={busy === `dl:${f.id}`}
                  onClick={() => download(f.id)}
                >
                  <Download className="size-4" aria-hidden />
                </Button>
              )}
              {editable && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('fileRemove')}
                  loading={busy === `rm:${f.id}`}
                  onClick={() => remove(f.id)}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && files.length < SUBMISSION_FILES_MAX && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={inputRef} type="file" multiple className="hidden" onChange={onPick} />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            // disabled, а не loading: loading прячет подпись, а в ней как раз проценты.
            disabled={progress !== null}
            onClick={() => inputRef.current?.click()}
          >
            <Paperclip className="size-4" aria-hidden />
            {progress !== null ? t('fileUploading', { percent: progress }) : t('attachFile')}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t('filesHint', { n: SUBMISSION_FILES_MAX })}
          </span>
        </div>
      )}
    </div>
  )
}
