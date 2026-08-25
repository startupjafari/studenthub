'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CreateSubjectSchema, type CreateSubjectInput } from '@studenthub/shared-schemas'
import { Button, Input, Label, Modal } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { courseKeys, createSubjectRequest } from '../../../entities/course'

interface Props {
  universityId: string
  onClose: () => void
}

// Модалка создания дисциплины-справочника (админ вуза). universityId — из scope.
export function CreateSubjectModal({ universityId, onClose }: Props) {
  const t = useTranslations('CourseAdmin')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const form = useForm<CreateSubjectInput>({
    resolver: zodResolver(CreateSubjectSchema),
    defaultValues: { universityId },
  })

  async function onSubmit(values: CreateSubjectInput) {
    try {
      await createSubjectRequest(values)
      await qc.invalidateQueries({ queryKey: courseKeys.subjects() })
      toast.success(t('subjectCreated'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    }
  }

  return (
    <Modal onClose={onClose} title={t('newSubject')}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="subject-name">{t('subjectName')}</Label>
          <Input id="subject-name" {...form.register('name')} autoFocus />
          {form.formState.errors.name && (
            <p className="text-sm text-destructive">{t('required')}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="subject-code">{t('subjectCode')}</Label>
          <Input id="subject-code" placeholder="CS101" {...form.register('code')} />
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
