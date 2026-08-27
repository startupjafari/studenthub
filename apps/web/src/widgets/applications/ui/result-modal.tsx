'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Paperclip, X } from 'lucide-react'
import { DOCUMENT_TYPES } from '@studenthub/shared-config'
import type { ApplicationResultType } from '@studenthub/shared-schemas'
import { uploadDocumentFile } from '../../../entities/document'
import { addResultRequest } from '../../../entities/application-service'
import {
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../shared/ui'

const RESULT_TYPES: ApplicationResultType[] = [
  'ELECTRONIC_DOCUMENT',
  'PAPER_DOCUMENT',
  'INFORMATION',
  'OTHER',
]
// Выдать можно только то, что каталог относит к «Выданным университетом»: справка,
// транскрипт, договор — но не паспорт студента. Тот же список проверяет сервер.
const ISSUED_TYPES = DOCUMENT_TYPES.filter((d) => d.category === 'ISSUED_BY_UNIVERSITY')

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

/**
 * Результат заявки: чем закончилась услуга. Для электронного документа сотрудник
 * прикладывает сам файл — бэкенд заведёт по нему документ в кабинете СТУДЕНТА
 * (раздел «Выданные университетом»), поэтому здесь уходит `fileId`, а не готовый
 * `documentId`: документ, созданный обычным путём, принадлежал бы сотруднику.
 */
export function ResultModal({
  appId,
  onClose,
  onDone,
}: {
  appId: string
  onClose: () => void
  onDone: () => void
}) {
  const t = useTranslations('Applications')
  const tDoc = useTranslations('Documents')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const fileRef = useRef<HTMLInputElement>(null)

  const [type, setType] = useState<ApplicationResultType>('ELECTRONIC_DOCUMENT')
  const [documentType, setDocumentType] = useState('')
  const [file, setFile] = useState<{ id: string; name: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [number, setNumber] = useState('')
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)

  // Файл нужен только электронному документу: «информация» и бумажный оригинал
  // существуют вне платформы.
  const needsFile = type === 'ELECTRONIC_DOCUMENT'
  const errors = {
    file: needsFile && !file ? tCommon('fieldRequired') : null,
    documentType: needsFile && file && !documentType ? tCommon('fieldRequired') : null,
  }
  const invalid = Object.values(errors).some(Boolean)

  async function pick(list: FileList | null): Promise<void> {
    const picked = list?.[0]
    if (!picked) return
    setUploading(true)
    try {
      const up = await uploadDocumentFile(picked)
      setFile({ id: up.id, name: picked.name })
    } catch (e) {
      toast.error(tErr(errCode(e)))
    } finally {
      setUploading(false)
      // Сбрасываем input, иначе повторный выбор того же файла не вызовет change.
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const saveMut = useMutation({
    mutationFn: () =>
      addResultRequest(appId, {
        type,
        ...(needsFile && file ? { fileId: file.id, documentType } : {}),
        ...(number.trim() ? { documentNumber: number.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success(t('resultAdded'))
      onDone()
      onClose()
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  return (
    <Modal onClose={onClose} title={t('addResult')} size="lg">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          setTried(true)
          if (!invalid) saveMut.mutate()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="r-type">{t('resultTypeLabel')}</Label>
          <Select value={type} onValueChange={(v) => setType(v as ApplicationResultType)}>
            <SelectTrigger id="r-type" aria-label={t('resultTypeLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESULT_TYPES.map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`resultType_${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {needsFile && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>{t('resultFileLabel')}</Label>
              {file ? (
                <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                  <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={tCommon('clear')}
                    onClick={() => setFile(null)}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="justify-center"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Paperclip className="size-4" aria-hidden />
                  )}
                  {t('resultFilePick')}
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="hidden"
                onChange={(e) => void pick(e.target.files)}
              />
              <p className="text-xs text-muted-foreground">{t('resultFileHint')}</p>
              {tried && <FieldError>{errors.file}</FieldError>}
            </div>

            {file && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="r-doc-type">{t('resultDocTypeLabel')}</Label>
                <Select value={documentType} onValueChange={setDocumentType}>
                  <SelectTrigger id="r-doc-type" aria-label={t('resultDocTypeLabel')}>
                    <SelectValue placeholder={tCommon('dictPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {ISSUED_TYPES.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {tDoc(`docType_${d.id}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tried && <FieldError>{errors.documentType}</FieldError>}
              </div>
            )}
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="r-number">{t('resultDocNumber')}</Label>
          <Input id="r-number" value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="r-note">{t('resultNoteLabel')}</Label>
          <Textarea id="r-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={saveMut.isPending} disabled={uploading}>
            {t('addResult')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
