'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CreateCourseSchema, type CreateCourseInput } from '@studenthub/shared-schemas'
import {
  Button,
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

interface Props {
  subjects: SubjectItem[]
  groups: Group[]
  terms: TermItem[]
  onClose: () => void
}

const NO_TERM = '__none__'

// Модалка назначения дисциплины группе (декан/админ вуза).
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
          <Label>{t('subject')}</Label>
          <Controller
            control={form.control}
            name="subjectId"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                <SelectTrigger>
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
          {form.formState.errors.subjectId && (
            <p className="text-sm text-destructive">{t('required')}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('group')}</Label>
          <Controller
            control={form.control}
            name="groupId"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                <SelectTrigger>
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
          {form.formState.errors.groupId && (
            <p className="text-sm text-destructive">{t('required')}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t('term')}</Label>
            <Controller
              control={form.control}
              name="termId"
              render={({ field }) => (
                <Select
                  value={field.value ?? NO_TERM}
                  onValueChange={(v) => field.onChange(v === NO_TERM ? undefined : v)}
                >
                  <SelectTrigger>
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
              {...form.register('credits', {
                setValueAs: (v) => (v === '' ? undefined : Number(v)),
              })}
            />
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
