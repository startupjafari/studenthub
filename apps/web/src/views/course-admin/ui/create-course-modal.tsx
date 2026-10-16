'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CreateCourseSchema, type CreateCourseInput } from '@studenthub/shared-schemas'
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
  courseKeys,
  createCourseRequest,
  type SubjectItem,
  type TermItem,
} from '../../../entities/course'
import type { Group } from '../../../entities/group'
import { TeacherSelect } from './teacher-select'

interface Props {
  subjects: SubjectItem[]
  groups: Group[]
  terms: TermItem[]
  onClose: () => void
}

const NO_TERM = '__none__'

// Модалка назначения дисциплины группе (декан/админ вуза). Преподавателя можно выбрать сразу:
// без него дисциплина не появляется у ведущего в журнале, заданиях и экзаменах.
export function CreateCourseModal({ subjects, groups, terms, onClose }: Props) {
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
              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                <SelectTrigger id="course-subject" aria-invalid={!!form.formState.errors.subjectId}>
                  <SelectValue placeholder={t('selectSubject')} />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.code ? ` (${s.code})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                <SelectTrigger id="course-group" aria-invalid={!!form.formState.errors.groupId}>
                  <SelectValue placeholder={t('selectGroup')} />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <Select
                  value={field.value ?? NO_TERM}
                  onValueChange={(v) => field.onChange(v === NO_TERM ? undefined : v)}
                >
                  <SelectTrigger id="course-term">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TERM}>{t('noTerm')}</SelectItem>
                    {terms.map((tm) => (
                      <SelectItem key={tm.id} value={tm.id}>
                        {tm.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
