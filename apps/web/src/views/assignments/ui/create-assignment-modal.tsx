'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  ASSIGNMENT_TYPES,
  SUBMISSION_TYPES,
  CreateAssignmentSchema,
  type CreateAssignmentInput,
} from '@studenthub/shared-schemas'
import {
  Button,
  Checkbox,
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
  Textarea,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { courseKeys, fetchCourses } from '../../../entities/course'
import { assignmentKeys, createAssignmentRequest } from '../../../entities/assignment'

interface Props {
  onClose: () => void
}

// Модалка создания задания (преподаватель). Валидация — общей CreateAssignmentSchema
// (safeParse), т.к. dueAt требует ISO с оффсетом (преобразуем из локального DateTimePicker).
export function CreateAssignmentModal({ onClose }: Props) {
  const t = useTranslations('Assignments')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const courses = useQuery({
    queryKey: courseKeys.list({ mine: true }),
    queryFn: () => fetchCourses({ mine: true }),
    retry: false,
  })

  const [courseId, setCourseId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<(typeof ASSIGNMENT_TYPES)[number]>('HOMEWORK')
  const [submissionType, setSubmissionType] = useState<(typeof SUBMISSION_TYPES)[number]>('TEXT')
  const [maxScore, setMaxScore] = useState('')
  const [dueAtLocal, setDueAtLocal] = useState('')
  const [allowLate, setAllowLate] = useState(false)
  const [pending, setPending] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const errors = {
    course: !courseId ? tCommon('fieldRequired') : null,
    title: !title.trim() ? tCommon('fieldRequired') : null,
    // Балл необязателен, но если введён — серверная схема ждёт целое 1…1000.
    maxScore:
      maxScore.trim() &&
      (!Number.isInteger(Number(maxScore)) || Number(maxScore) < 1 || Number(maxScore) > 1000)
        ? tCommon('numberRange', { min: 1, max: 1000 })
        : null,
  }
  const show = (key: keyof typeof errors): string | null => (submitted ? errors[key] : null)

  async function onSubmit() {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    const payload: CreateAssignmentInput = {
      courseId,
      title: title.trim(),
      type,
      submissionType,
      allowLate,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(maxScore ? { maxScore: Number(maxScore) } : {}),
      ...(dueAtLocal ? { dueAt: new Date(dueAtLocal).toISOString() } : {}),
    }
    const parsed = CreateAssignmentSchema.safeParse(payload)
    if (!parsed.success) {
      toast.error(t('formInvalid'))
      return
    }
    setPending(true)
    try {
      await createAssignmentRequest(parsed.data)
      await qc.invalidateQueries({ queryKey: assignmentKeys.list() })
      toast.success(t('created'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal onClose={onClose} title={t('newAssignment')} size="lg">
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
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-title">{t('assignmentTitle')}</Label>
          <Input
            id="a-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            aria-invalid={!!show('title')}
          />
          <FieldError>{show('title')}</FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="a-desc">{t('description')}</Label>
          <Textarea
            id="a-desc"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t('type')}</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNMENT_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`type_${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('submissionType')}</Label>
            <Select
              value={submissionType}
              onValueChange={(v) => setSubmissionType(v as typeof submissionType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBMISSION_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`subtype_${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="a-max">{t('maxScoreLabel')}</Label>
            <Input
              id="a-max"
              type="number"
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              aria-invalid={!!show('maxScore')}
            />
            <FieldError>{show('maxScore')}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('dueAt')}</Label>
            <DateTimePicker value={dueAtLocal} onChange={setDueAtLocal} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={allowLate} onCheckedChange={(v) => setAllowLate(v === true)} />
          {t('allowLate')}
        </label>

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
