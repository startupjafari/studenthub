'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { UpdateSubjectSchema, type UpdateSubjectInput } from '@studenthub/shared-schemas'
import { Button, Input, Label, Modal } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { courseKeys, updateSubjectRequest, type SubjectItem } from '../../../entities/course'

interface Props {
  subject: SubjectItem
  onClose: () => void
}

/**
 * Правка дисциплины-справочника (админ вуза): название и код. Раньше опечатку можно было
 * исправить только удалением, а предмет, на который ссылаются курсы, не удаляется.
 */
export function EditSubjectModal({ subject, onClose }: Props) {
  const t = useTranslations('CourseAdmin')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const form = useForm<UpdateSubjectInput>({
    resolver: zodResolver(UpdateSubjectSchema),
    defaultValues: { name: subject.name, code: subject.code ?? '' },
  })

  async function onSubmit(values: UpdateSubjectInput) {
    const name = values.name?.trim() ?? subject.name
    // Пустое поле кода — снять код (null), а не отправить пустую строку.
    const code = values.code?.trim() ? values.code.trim() : null
    const patch: UpdateSubjectInput = {
      ...(name !== subject.name ? { name } : {}),
      ...(code !== subject.code ? { code } : {}),
    }
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    try {
      await updateSubjectRequest(subject.id, patch)
      await qc.invalidateQueries({ queryKey: courseKeys.all })
      toast.success(t('subjectUpdated'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    }
  }

  return (
    <Modal onClose={onClose} title={t('editSubject')}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-subject-name">{t('subjectName')}</Label>
          <Input id="edit-subject-name" {...form.register('name')} autoFocus />
          {form.formState.errors.name && (
            <p className="text-sm text-destructive">{t('required')}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-subject-code">{t('subjectCode')}</Label>
          <Input
            id="edit-subject-code"
            placeholder="CS101"
            {...form.register('code', { setValueAs: (v) => (v === '' ? null : v) })}
          />
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
