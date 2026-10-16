'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { UpdateCourseSchema, type UpdateCourseInput } from '@studenthub/shared-schemas'
import { Button, FieldError, Input, Label, Modal } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { courseKeys, updateCourseRequest, type CourseItem } from '../../../entities/course'
import { buildCoursePatch, courseEditDefaults } from '../lib/course-patch'
import { TeacherSelect } from './teacher-select'
import { TermSelect } from './term-select'

interface Props {
  course: CourseItem
  onClose: () => void
}

// Правка назначенной дисциплины (декан/админ вуза): преподаватель, семестр, кредиты.
// Предмет и группу сервер не меняет — они показаны строкой над формой.
export function EditCourseModal({ course, onClose }: Props) {
  const t = useTranslations('CourseAdmin')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const form = useForm<UpdateCourseInput>({
    resolver: zodResolver(UpdateCourseSchema),
    defaultValues: courseEditDefaults(course),
  })
  async function onSubmit(values: UpdateCourseInput) {
    const patch = buildCoursePatch(course, values)
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    try {
      await updateCourseRequest(course.id, patch)
      await qc.invalidateQueries({ queryKey: courseKeys.all })
      toast.success(t('courseUpdated'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    }
  }

  return (
    <Modal onClose={onClose} title={t('editCourse')}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {course.subject.name} · {course.group.name}
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-course-teacher">{t('teacher')}</Label>
          <Controller
            control={form.control}
            name="teacherId"
            render={({ field }) => (
              <TeacherSelect
                id="edit-course-teacher"
                value={field.value ?? null}
                onChange={field.onChange}
                initial={course.teacher}
              />
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-course-term">{t('term')}</Label>
            <Controller
              control={form.control}
              name="termId"
              render={({ field }) => (
                <TermSelect
                  id="edit-course-term"
                  value={field.value ?? null}
                  onChange={field.onChange}
                  initial={course.term}
                />
              )}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-course-credits">{t('credits')}</Label>
            <Input
              id="edit-course-credits"
              type="number"
              aria-invalid={!!form.formState.errors.credits}
              {...form.register('credits', {
                setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
              })}
            />
            <FieldError>{form.formState.errors.credits && t('creditsRange')}</FieldError>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
