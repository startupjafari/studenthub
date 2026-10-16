'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CreateCourseSchema, type CreateCourseInput } from '@studenthub/shared-schemas'
import { Button, FieldError, Input, Label, Modal } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { courseKeys, createCourseRequest } from '../../../entities/course'
import { GroupSelect } from './group-select'
import { SubjectSelect } from './subject-select'
import { TeacherSelect } from './teacher-select'
import { TermSelect } from './term-select'

interface Props {
  onClose: () => void
}

// Модалка назначения дисциплины группе (декан/админ вуза). Преподавателя можно выбрать сразу:
// без него дисциплина не появляется у ведущего в журнале, заданиях и экзаменах.
// Дисциплина, группа и семестр грузятся пикерами сами — из всего справочника вуза, а не
// из текущей страницы вкладок.
export function CreateCourseModal({ onClose }: Props) {
  const t = useTranslations('CourseAdmin')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const form = useForm<CreateCourseInput>({ resolver: zodResolver(CreateCourseSchema) })

  async function onSubmit(values: CreateCourseInput) {
    try {
      await createCourseRequest(values)
      await qc.invalidateQueries({ queryKey: courseKeys.list() })
      toast.success(t('courseCreated'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    }
  }

  return (
    <Modal onClose={onClose} title={t('newCourse')}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="course-subject">{t('subject')}</Label>
          <Controller
            control={form.control}
            name="subjectId"
            render={({ field }) => (
              <SubjectSelect
                id="course-subject"
                value={field.value ?? null}
                onChange={(next) => field.onChange(next ?? undefined)}
              />
            )}
          />
          <FieldError>{form.formState.errors.subjectId && t('required')}</FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="course-group">{t('group')}</Label>
          <Controller
            control={form.control}
            name="groupId"
            render={({ field }) => (
              <GroupSelect
                id="course-group"
                value={field.value ?? null}
                onChange={(next) => field.onChange(next ?? undefined)}
              />
            )}
          />
          <FieldError>{form.formState.errors.groupId && t('required')}</FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="course-teacher">{t('teacher')}</Label>
          <Controller
            control={form.control}
            name="teacherId"
            render={({ field }) => (
              <TeacherSelect
                id="course-teacher"
                value={field.value ?? null}
                onChange={(next) => field.onChange(next ?? undefined)}
              />
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="course-term">{t('term')}</Label>
            <Controller
              control={form.control}
              name="termId"
              render={({ field }) => (
                <TermSelect
                  id="course-term"
                  value={field.value ?? null}
                  onChange={(next) => field.onChange(next ?? undefined)}
                />
              )}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="course-credits">{t('credits')}</Label>
            <Input
              id="course-credits"
              type="number"
              aria-invalid={!!form.formState.errors.credits}
              {...form.register('credits', {
                setValueAs: (v) => (v === '' ? undefined : Number(v)),
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
            {t('create')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
