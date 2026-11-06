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
import { CourseSelect, courseKeys, fetchAllCourses } from '../../../entities/course'
import {
  assignmentKeys,
  createAssignmentRequest,
  updateAssignmentRequest,
  type AssignmentItem,
} from '../../../entities/assignment'
import { assignmentFormDefaults, buildAssignmentPatch } from '../lib/assignment-patch'

interface Props {
  onClose: () => void
  /** Задание на правку (C-F20); без него — создание нового. */
  assignment?: AssignmentItem
}

// Модалка создания и правки задания (преподаватель). Валидация — общей CreateAssignmentSchema
// (safeParse), т.к. dueAt требует ISO с оффсетом (преобразуем из локального DateTimePicker).
// Правка шлёт только изменённые поля; дисциплину у задания не меняют.
export function CreateAssignmentModal({ onClose, assignment }: Props) {
  const t = useTranslations('Assignments')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const editing = !!assignment
  const courses = useQuery({
    queryKey: courseKeys.listAll({ mine: true }),
    queryFn: () => fetchAllCourses({ mine: true }),
    retry: false,
    enabled: !editing,
  })

  const initial = assignment ? assignmentFormDefaults(assignment) : null
  const [courseId, setCourseId] = useState(assignment?.course.id ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [type, setType] = useState<(typeof ASSIGNMENT_TYPES)[number]>(initial?.type ?? 'HOMEWORK')
  const [submissionType, setSubmissionType] = useState<(typeof SUBMISSION_TYPES)[number]>(
    initial?.submissionType ?? 'TEXT',
  )
  const [maxScore, setMaxScore] = useState(initial?.maxScore ?? '')
  const [dueAtLocal, setDueAtLocal] = useState(initial?.dueAtLocal ?? '')
  const [allowLate, setAllowLate] = useState(initial?.allowLate ?? false)
  const [pending, setPending] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  // Сервер не даёт опустить максимум ниже уже выставленного балла — отказ под полем.
  const [maxScoreServerError, setMaxScoreServerError] = useState<string | null>(null)

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

  async function onUpdate(a: AssignmentItem) {
    const patch = buildAssignmentPatch(a, {
      title,
      description,
      type,
      submissionType,
      maxScore,
      dueAtLocal,
      allowLate,
    })
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    setPending(true)
    try {
      await updateAssignmentRequest(a.id, patch)
      await qc.invalidateQueries({ queryKey: assignmentKeys.all })
      toast.success(t('updated'))
      onClose()
    } catch (e) {
      const err = toApiError(e)
      if (err.code === 'CONFLICT' && err.details?.some((d) => d.field === 'maxScore')) {
        setMaxScoreServerError(t('maxScoreBelowGraded'))
        return
      }
      toast.error(tErr(err.code))
    } finally {
      setPending(false)
    }
  }

  async function onSubmit() {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    if (assignment) {
      await onUpdate(assignment)
      return
    }
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
    <Modal onClose={onClose} title={editing ? t('editAssignment') : t('newAssignment')} size="lg">
      <div className="flex flex-col gap-4">
        {assignment ? (
          // Дисциплину у задания не меняют — сдачи и журнал привязаны к ней.
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">
              {assignment.course.subject.name} · {assignment.course.group.name}
            </p>
            {assignment.status !== 'DRAFT' && (
              <p className="text-xs text-muted-foreground">{t('editPublishedHint')}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="a-course">{t('course')}</Label>
            <CourseSelect
              id="a-course"
              courses={courses.data ?? []}
              value={courseId}
              onChange={setCourseId}
              loading={courses.isFetching}
              placeholder={t('selectCourse')}
            />
          </div>
        )}

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
              onChange={(e) => {
                setMaxScore(e.target.value)
                setMaxScoreServerError(null)
              }}
              aria-invalid={!!(show('maxScore') ?? maxScoreServerError)}
            />
            <FieldError>{show('maxScore') ?? maxScoreServerError}</FieldError>
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
            {editing ? t('save') : t('create')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
