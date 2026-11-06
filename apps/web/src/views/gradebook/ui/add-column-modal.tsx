'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  GRADE_COLUMN_KINDS,
  CreateGradeColumnSchema,
  UpdateGradeColumnSchema,
} from '@studenthub/shared-schemas'
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
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  gradebookKeys,
  createColumnRequest,
  updateColumnRequest,
  type GradeColumnItem,
} from '../../../entities/gradebook'

interface Props {
  courseId: string
  /** Правка существующей колонки; без неё — добавление новой. */
  column?: GradeColumnItem
  onClose: () => void
}

type Kind = (typeof GRADE_COLUMN_KINDS)[number]

// Модалка контрольной точки (колонки журнала): добавление и правка.
export function AddColumnModal({ courseId, column, onClose }: Props) {
  const t = useTranslations('Gradebook')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [title, setTitle] = useState(column?.title ?? '')
  const [kind, setKind] = useState<Kind>(
    GRADE_COLUMN_KINDS.find((k) => k === column?.kind) ?? (column ? 'OTHER' : 'LAB'),
  )
  // Колонка без максимума (созданная не из журнала) так и правится: пустое поле — «без максимума».
  const [maxScore, setMaxScore] = useState(
    column ? (column.maxScore == null ? '' : String(column.maxScore)) : '100',
  )
  const [pending, setPending] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const errors = {
    title: !title.trim() ? tCommon('fieldRequired') : null,
    // Серверная схема: целое 1…1000.
    maxScore: !maxScore.trim()
      ? column && column.maxScore == null
        ? null
        : tCommon('fieldRequired')
      : !Number.isInteger(Number(maxScore)) || Number(maxScore) < 1 || Number(maxScore) > 1000
        ? tCommon('numberRange', { min: 1, max: 1000 })
        : null,
  }
  const show = (key: keyof typeof errors): string | null => (submitted ? errors[key] : null)

  async function onSubmit() {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    if (column) return onUpdate(column)
    const payload = {
      courseId,
      title: title.trim(),
      kind,
      ...(maxScore ? { maxScore: Number(maxScore) } : {}),
    }
    const parsed = CreateGradeColumnSchema.safeParse(payload)
    if (!parsed.success) {
      toast.error(t('formInvalid'))
      return
    }
    setPending(true)
    try {
      await createColumnRequest(parsed.data)
      await qc.invalidateQueries({ queryKey: gradebookKeys.course(courseId) })
      toast.success(t('columnAdded'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    } finally {
      setPending(false)
    }
  }

  // Уходят только изменённые поля: PATCH без лишнего не трогает того, что не правили.
  async function onUpdate(col: GradeColumnItem) {
    const nextMax = maxScore.trim() ? Number(maxScore) : null
    const payload = {
      ...(title.trim() !== col.title ? { title: title.trim() } : {}),
      ...(kind !== col.kind ? { kind } : {}),
      ...(nextMax !== col.maxScore ? { maxScore: nextMax } : {}),
    }
    if (Object.keys(payload).length === 0) {
      onClose()
      return
    }
    const parsed = UpdateGradeColumnSchema.safeParse(payload)
    if (!parsed.success) {
      toast.error(t('formInvalid'))
      return
    }
    setPending(true)
    try {
      await updateColumnRequest(col.id, parsed.data)
      await qc.invalidateQueries({ queryKey: gradebookKeys.course(courseId) })
      toast.success(t('columnUpdated'))
      onClose()
    } catch (e) {
      const code = toApiError(e).code
      // Сервер не даёт опустить максимум ниже уже выставленной оценки.
      toast.error(code === 'CONFLICT' ? t('maxBelowGrades') : tErr(code))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal onClose={onClose} title={column ? t('editColumnTitle') : t('newColumn')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="col-title">{t('columnTitle')}</Label>
          <Input
            id="col-title"
            placeholder={t('columnTitlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            aria-invalid={!!show('title')}
          />
          <FieldError>{show('title')}</FieldError>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t('kind')}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRADE_COLUMN_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`kind_${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="col-max">{t('maxScore')}</Label>
            <Input
              id="col-max"
              type="number"
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              aria-invalid={!!show('maxScore')}
            />
            <FieldError>{show('maxScore')}</FieldError>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={onSubmit} loading={pending}>
            {column ? t('save') : t('add')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
