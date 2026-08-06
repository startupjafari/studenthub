'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Camera, ChevronDown, ChevronUp, Lock, Upload, X } from 'lucide-react'
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_TYPES,
  documentTypeDef,
  type DocumentField,
} from '@studenthub/shared-config'
import {
  attachDocumentFiles,
  createDocument,
  documentKeys,
  uploadDocumentFile,
} from '../../../entities/document'
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { DocModal } from './doc-modal'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

interface Picked {
  id: string
  name: string
}

// Мастер загрузки документа (ТЗ §5): 4 шага — тип → файлы → данные → доступ.
export function UploadWizard({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState(1)
  const [category, setCategory] = useState<string>('')
  const [type, setType] = useState<string>('')
  const [files, setFiles] = useState<Picked[]>([])
  const [uploading, setUploading] = useState(false)
  const [title, setTitle] = useState('')
  const [number, setNumber] = useState('')
  const [issuedAt, setIssuedAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [issuedBy, setIssuedBy] = useState('')
  const [comment, setComment] = useState('')

  const typesForCategory = DOCUMENT_TYPES.filter((d) => d.category === category)
  const fields: DocumentField[] = documentTypeDef(type)?.fields ?? []
  const showField = (f: DocumentField) => fields.includes(f)

  async function onPick(list: FileList | null): Promise<void> {
    if (!list || list.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(list)) {
        const up = await uploadDocumentFile(file)
        setFiles((prev) => [...prev, { id: up.id, name: file.name }])
      }
    } catch (e) {
      toast.error(tErr(errCode(e)))
    } finally {
      setUploading(false)
    }
  }

  function move(i: number, dir: -1 | 1): void {
    setFiles((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  }

  const createMut = useMutation({
    mutationFn: async () => {
      const doc = await createDocument({
        category: category as 'PERSONAL',
        type,
        title: title.trim(),
        number: showField('number') && number ? number : undefined,
        issuedBy: showField('issuedBy') && issuedBy ? issuedBy : undefined,
        issuedAt: showField('issuedAt') && issuedAt ? new Date(issuedAt) : undefined,
        expiresAt: showField('expiresAt') && expiresAt ? new Date(expiresAt) : undefined,
        comment: comment || undefined,
      })
      if (files.length > 0)
        await attachDocumentFiles(
          doc.id,
          files.map((f) => f.id),
        )
      return doc
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentKeys.all })
      toast.success(t('saved'))
      onClose()
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const canNext =
    (step === 1 && category && type) ||
    step === 2 ||
    (step === 3 && title.trim().length > 0) ||
    step === 4
  const stepTitle = [t('step1Title'), t('step2Title'), t('step3Title'), t('step4Title')][step - 1]

  const footer = (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
      >
        {step === 1 ? t('cancel') : t('back')}
      </Button>
      {step < 4 ? (
        <Button type="button" disabled={!canNext} onClick={() => setStep(step + 1)}>
          {t('next')}
        </Button>
      ) : (
        <Button
          type="button"
          loading={createMut.isPending}
          disabled={!title.trim()}
          onClick={() => createMut.mutate()}
        >
          {t('finish')}
        </Button>
      )}
    </>
  )

  return (
    <DocModal title={`${t('uploadTitle')} · ${stepTitle}`} onClose={onClose} footer={footer}>
      {/* Индикатор шагов */}
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4].map((s) => (
          <span
            key={s}
            className={cn('h-1.5 flex-1 rounded-full', s <= step ? 'bg-primary' : 'bg-muted')}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('chooseCategory')}
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v)
                setType('')
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('chooseCategory')} />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`docCat_${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {category && (
            <label className="flex flex-col gap-1 text-sm">
              {t('chooseType')}
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue placeholder={t('chooseType')} />
                </SelectTrigger>
                <SelectContent>
                  {typesForCategory.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {t(`docType_${d.id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              void onPick(e.target.files)
              e.target.value = ''
            }}
          />
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void onPick(e.target.files)
              e.target.value = ''
            }}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              loading={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-4" aria-hidden /> {t('addFiles')}
            </Button>
            <Button type="button" variant="outline" onClick={() => camRef.current?.click()}>
              <Camera className="size-4" aria-hidden /> {t('fromCamera')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('filesHint')}</p>
          {files.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t('noFilesYet')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {files.map((f, i) => (
                <li
                  key={f.id}
                  className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
                >
                  <span className="w-5 shrink-0 text-center text-xs text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <button
                    type="button"
                    aria-label={t('moveUp')}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="text-muted-foreground disabled:opacity-30 hover:text-foreground"
                  >
                    <ChevronUp className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={t('moveDown')}
                    disabled={i === files.length - 1}
                    onClick={() => move(i, 1)}
                    className="text-muted-foreground disabled:opacity-30 hover:text-foreground"
                  >
                    <ChevronDown className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={t('remove')}
                    onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('fieldTitle')} <span className="text-destructive">*</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={type ? t(`docType_${type}`) : ''}
            />
          </label>
          {showField('number') && (
            <label className="flex flex-col gap-1 text-sm">
              {t('fieldNumber')}
              <Input value={number} onChange={(e) => setNumber(e.target.value)} />
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            {showField('issuedAt') && (
              <label className="flex flex-col gap-1 text-sm">
                {t('fieldIssuedAt')}
                <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
              </label>
            )}
            {showField('expiresAt') && (
              <label className="flex flex-col gap-1 text-sm">
                {t('fieldExpiresAt')}
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </label>
            )}
          </div>
          {showField('issuedBy') && (
            <label className="flex flex-col gap-1 text-sm">
              {t('fieldIssuedBy')}
              <Input value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            {t('fieldComment')}
            <Input value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          {showField('number') && (
            <p className="text-xs text-muted-foreground">{t('numberMaskHint')}</p>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
            <Lock className="size-5 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-medium">{t('accessOnlyMe')}</p>
              <p className="text-xs text-muted-foreground">{t('accessDefaultHint')}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('accessLaterHint')}</p>
        </div>
      )}
    </DocModal>
  )
}
