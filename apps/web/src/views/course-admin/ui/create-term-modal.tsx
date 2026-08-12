'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CreateTermSchema, type CreateTermInput } from '@studenthub/shared-schemas'
import { Button, Checkbox, DatePicker, Input, Label, Modal } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { courseKeys, createTermRequest } from '../../../entities/course'

interface Props {
  universityId: string
  onClose: () => void
}

// Модалка создания семестра (админ вуза): название, номер, даты, активность.
export function CreateTermModal({ universityId, onClose }: Props) {
  const t = useTranslations('CourseAdmin')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const form = useForm<CreateTermInput>({
    resolver: zodResolver(CreateTermSchema),
    defaultValues: { universityId, isActive: false },
  })

  async function onSubmit(values: CreateTermInput) {
    try {
      await createTermRequest(values)
      await qc.invalidateQueries({ queryKey: courseKeys.terms() })
      toast.success(t('termCreated'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    }
  }

  return (
    <Modal onClose={onClose} title={t('newTerm')}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="term-name">{t('termName')}</Label>
          <Input
            id="term-name"
            placeholder={t('termNamePlaceholder')}
            {...form.register('name')}
            autoFocus
          />
          {form.formState.errors.name && (
            <p className="text-sm text-destructive">{t('required')}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="term-number">{t('termNumber')}</Label>
          <Input
            id="term-number"
            type="number"
            {...form.register('number', { setValueAs: (v) => (v === '' ? undefined : Number(v)) })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t('startsOn')}</Label>
            <Controller
              control={form.control}
              name="startsOn"
              render={({ field }) => (
                <DatePicker value={field.value ?? ''} onChange={field.onChange} />
              )}
            />
            {form.formState.errors.startsOn && (
              <p className="text-sm text-destructive">{t('required')}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('endsOn')}</Label>
            <Controller
              control={form.control}
              name="endsOn"
              render={({ field }) => (
                <DatePicker value={field.value ?? ''} onChange={field.onChange} />
              )}
            />
            {form.formState.errors.endsOn && (
              <p className="text-sm text-destructive">{t('endsAfterStarts')}</p>
            )}
          </div>
        </div>
        <Controller
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} />
              {t('termActive')}
            </label>
          )}
        />
        <div className="flex justify-end gap-2">
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
