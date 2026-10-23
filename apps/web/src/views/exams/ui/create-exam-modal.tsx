'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Role } from '@studenthub/shared-types'
import {
  CreateExamSchema,
  EXAM_FORMATS,
  UpdateExamSchema,
  type ExamFormat,
} from '@studenthub/shared-schemas'
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
import { useAppSelector } from '../../../shared/store'
import { CourseSelect, courseKeys, fetchAllCourses } from '../../../entities/course'
import {
  examKeys,
  createExamRequest,
  updateExamRequest,
  type ExamItem,
} from '../../../entities/exam'
import { RoomSelect } from '../../../entities/room'
import { EXAM_FORMAT_KEY } from '../lib/visuals'
import { buildExamPatch, examFormDefaults } from '../lib/exam-patch'
import { ExaminerSelect } from './examiner-select'

interface Props {
  mine: boolean
  onClose: () => void
  /** Экзамен на правку (перенос, аудитория, экзаменатор); без него — назначение нового. */
  exam?: ExamItem
}

// Назначение и правка экзамена (декан/преподаватель): дисциплина, дата/время, формат,
// макс. балл, аудитория и экзаменатор (§8.3 «Экзамены»). Правка шлёт только изменённые
// поля; дисциплину у экзамена не меняют.
export function CreateExamModal({ mine, onClose, exam }: Props) {
  const t = useTranslations('Exams')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const editing = !!exam
  // Экзаменатора выбирают из пользователей вуза — список открыт деканату и администрации
  // (GET /users). Преподавателю поле не показываем: сервер ставит его самого.
  const role = useAppSelector((s) => s.auth.role)
  const canPickExaminer = role !== Role.TEACHER
  const courses = useQuery({
    queryKey: courseKeys.listAll({ mine }),
    queryFn: () => fetchAllCourses({ mine }),
    retry: false,
    enabled: !editing,
  })

  const initial = exam ? examFormDefaults(exam) : null
  const [courseId, setCourseId] = useState('')
  const [dateLocal, setDateLocal] = useState(initial?.dateLocal ?? '')
  const [format, setFormat] = useState<ExamFormat>(initial?.format ?? 'WRITTEN')
  const [maxScore, setMaxScore] = useState(initial ? initial.maxScore : '100')
  const [roomId, setRoomId] = useState<string | null>(initial?.roomId ?? null)
  const [examinerId, setExaminerId] = useState<string | null>(initial?.examinerId ?? null)
  const [pending, setPending] = useState(false)
  // Ошибки — после первой попытки отправки, а не на нетронутой форме.
  const [submitted, setSubmitted] = useState(false)
  // Сервер не даёт опустить максимум ниже уже выставленного балла — отказ под полем.
  const [maxScoreServerError, setMaxScoreServerError] = useState<string | null>(null)

  const errors = {
    course: !editing && !courseId ? tCommon('fieldRequired') : null,
    date: !dateLocal ? tCommon('dateRequired') : null,
    // Серверная схема: целое 1…1000.
    maxScore: !maxScore.trim()
      ? tCommon('fieldRequired')
      : !Number.isInteger(Number(maxScore)) || Number(maxScore) < 1 || Number(maxScore) > 1000
        ? tCommon('numberRange', { min: 1, max: 1000 })
        : null,
  }
  const show = (key: keyof typeof errors): string | null => (submitted ? errors[key] : null)

  async function save(): Promise<void> {
    if (exam) {
      const patch = buildExamPatch(exam, {
        dateLocal,
        format,
        maxScore,
        roomId,
        examinerId: canPickExaminer ? examinerId : undefined,
      })
      if (Object.keys(patch).length === 0) return
      const parsed = UpdateExamSchema.safeParse(patch)
      if (!parsed.success) throw new Error('invalid')
      await updateExamRequest(exam.id, parsed.data)
      return
    }
    const parsed = CreateExamSchema.safeParse({
      courseId,
      date: new Date(dateLocal).toISOString(),
      format,
      maxScore: Number(maxScore),
      ...(roomId ? { roomId } : {}),
      ...(canPickExaminer && examinerId ? { examinerId } : {}),
    })
    if (!parsed.success) throw new Error('invalid')
    await createExamRequest(parsed.data)
  }

  async function onSubmit() {
    setSubmitted(true)
    setMaxScoreServerError(null)
    if (Object.values(errors).some(Boolean)) return
    setPending(true)
    try {
      await save()
      await qc.invalidateQueries({ queryKey: examKeys.all })
      toast.success(editing ? t('updated') : t('created'))
      onClose()
    } catch (e) {
      if (e instanceof Error && e.message === 'invalid') {
        toast.error(t('formInvalid'))
        return
      }
      const err = toApiError(e)
      if (err.code === 'CONFLICT' && err.details?.some((d) => d.field === 'maxScore')) {
        setMaxScoreServerError(t('maxScoreBelowGraded'))
        return
      }
      // CONFLICT — у группы, аудитории или экзаменатора в это время другой экзамен (C-F22).
      toast.error(err.code === 'CONFLICT' ? t('scheduleConflict') : tErr(err.code))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal onClose={onClose} title={editing ? t('editExam') : t('newExam')}>
      <div className="flex flex-col gap-4">
        {exam ? (
          <p className="text-sm text-muted-foreground">
            {exam.course.subject.name} · {exam.group.name}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exam-course">{t('course')}</Label>
            <CourseSelect
              id="exam-course"
              courses={courses.data ?? []}
              value={courseId}
              onChange={setCourseId}
              loading={courses.isFetching}
              placeholder={t('selectCourse')}
            />
            <FieldError>{show('course')}</FieldError>
          </div>
        )}
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
            <Select value={format} onValueChange={(v) => setFormat(v as ExamFormat)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXAM_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {t(EXAM_FORMAT_KEY[f])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exam-room">{t('room')}</Label>
          <RoomSelect
            id="exam-room"
            value={roomId}
            onChange={setRoomId}
            initialLabel={exam?.room?.name ?? null}
          />
        </div>
        {canPickExaminer && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exam-examiner">{t('examiner')}</Label>
            <ExaminerSelect
              id="exam-examiner"
              value={examinerId}
              onChange={setExaminerId}
              initial={exam?.examiner ?? null}
              placeholder={t('examinerPlaceholder')}
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exam-max">{t('maxScore')}</Label>
          <Input
            id="exam-max"
            type="number"
            value={maxScore}
            onChange={(e) => {
              setMaxScore(e.target.value)
              setMaxScoreServerError(null)
            }}
            aria-invalid={!!show('maxScore') || !!maxScoreServerError}
          />
          <FieldError>{show('maxScore') ?? maxScoreServerError}</FieldError>
        </div>
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
