'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CreateExamSchema, type CreateExamInput } from '@studenthub/shared-schemas'
import {
  Button,
  DateTimePicker,
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
import { courseKeys, fetchCourses } from '../../../entities/course'
import { examKeys, createExamRequest } from '../../../entities/exam'
import { EXAM_FORMATS, formatKey } from '../lib/visuals'

interface Props {
  mine: boolean
  onClose: () => void
}

// Назначение экзамена (декан/преподаватель): дисциплина, дата/время, формат, макс. балл.
export function CreateExamModal({ mine, onClose }: Props) {
  const t = useTranslations('Exams')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const courses = useQuery({
    queryKey: courseKeys.list({ mine }),
    queryFn: () => fetchCourses({ mine }),
    retry: false,
  })

  const [courseId, setCourseId] = useState('')
  const [dateLocal, setDateLocal] = useState('')
  const [format, setFormat] = useState<CreateExamInput['format']>('WRITTEN')
  const [maxScore, setMaxScore] = useState('100')
  const [pending, setPending] = useState(false)
  // Ошибки — после первой попытки отправки, а не на нетронутой форме.
  const [submitted, setSubmitted] = useState(false)

  const errors = {
    course: !courseId ? tCommon('fieldRequired') : null,
    date: !dateLocal ? tCommon('dateRequired') : null,
    // Серверная схема: целое 1…1000.
    maxScore: !maxScore.trim()
      ? tCommon('fieldRequired')
      : !Number.isInteger(Number(maxScore)) || Number(maxScore) < 1 || Number(maxScore) > 1000
        ? tCommon('numberRange', { min: 1, max: 1000 })
        : null,
  }
  const show = (key: keyof typeof errors): string | null => (submitted ? errors[key] : null)

  async function onSubmit() {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    const payload = {
      courseId,
      date: dateLocal ? new Date(dateLocal).toISOString() : '',
      format,
      ...(maxScore ? { maxScore: Number(maxScore) } : {}),
    }
    const parsed = CreateExamSchema.safeParse(payload)
    if (!parsed.success) {
      toast.error(t('formInvalid'))
      return
    }
    setPending(true)
    try {
      await createExamRequest(parsed.data)
      await qc.invalidateQueries({ queryKey: examKeys.all })
      toast.success(t('created'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal onClose={onClose} title={t('newExam')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t('course')}</Label>
          <Select value={courseId} onValueChange={setCourseId}>
            <SelectTrigger aria-invalid={!!show('course')}>
              <SelectValue placeholder={t('selectCourse')} />
            </SelectTrigger>
            <SelectContent>
              {(courses.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.subject.name} · {c.group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{show('course')}</FieldError>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t('dateTime')}</Label>
            <DateTimePicker
              value={dateLocal}
              onChange={setDateLocal}
              aria-invalid={!!show('date')}
            />
            <FieldError>{show('date')}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('format')}</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXAM_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {t(formatKey(f))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exam-max">{t('maxScore')}</Label>
          <Input
            id="exam-max"
            type="number"
            value={maxScore}
            onChange={(e) => setMaxScore(e.target.value)}
            aria-invalid={!!show('maxScore')}
          />
          <FieldError>{show('maxScore')}</FieldError>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={onSubmit} loading={pending}>
            {t('create')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
