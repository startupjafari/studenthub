'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { UpdateTermSchema, type UpdateTermInput } from '@studenthub/shared-schemas'
import { Button, Checkbox, DatePicker, FieldError, Input, Label, Modal } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { courseKeys, updateTermRequest, type TermItem } from '../../../entities/course'

interface Props {
  term: TermItem
  onClose: () => void
}

// Дата семестра приходит ISO-строкой полуночи UTC, DatePicker ждёт «YYYY-MM-DD».
const day = (iso: string): string => iso.slice(0, 10)

/**
 * Правка семестра (админ вуза): название, номер, даты и «текущий». Сервер сверяет итоговые
 * даты с сохранёнными и снимает «текущий» с остальных семестров вуза — текущий один.
 */
export function EditTermModal({ term, onClose }: Props) {
  const t = useTranslations('CourseAdmin')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const form = useForm<UpdateTermInput>({
    resolver: zodResolver(UpdateTermSchema),
    defaultValues: {
      name: term.name,
      number: term.number,
      startsOn: day(term.startsOn),
      endsOn: day(term.endsOn),
      isActive: term.isActive,
    },
  })
  const isActive = form.watch('isActive')

  async function onSubmit(values: UpdateTermInput) {
    // Схема правки не сверяет даты между собой — сверяем здесь, до запроса.
    if (values.startsOn && values.endsOn && values.endsOn < values.startsOn) {
      form.setError('endsOn', { message: t('endsAfterStarts') })
      return
    }
    const patch: UpdateTermInput = {
      ...(values.name !== undefined && values.name.trim() !== term.name
        ? { name: values.name.trim() }
        : {}),
      ...(values.number !== undefined && values.number !== term.number
        ? { number: values.number }
        : {}),
      ...(values.startsOn && values.startsOn !== day(term.startsOn)
        ? { startsOn: values.startsOn }
        : {}),
      ...(values.endsOn && values.endsOn !== day(term.endsOn) ? { endsOn: values.endsOn } : {}),
      ...(values.isActive !== undefined && values.isActive !== term.isActive
        ? { isActive: values.isActive }
        : {}),
    }
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    try {
      await updateTermRequest(term.id, patch)
      await qc.invalidateQueries({ queryKey: courseKeys.all })
      toast.success(t('termUpdated'))
      onClose()
    } catch (e) {
      const err = toApiError(e)
      if (err.code === 'VALIDATION_ERROR') {
        form.setError('endsOn', { message: t('endsAfterStarts') })
        return
      }
      toast.error(tErr(err.code))
    }
  }

  return (
    <Modal onClose={onClose} title={t('editTerm')}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-term-name">{t('termName')}</Label>
          <Input id="edit-term-name" {...form.register('name')} autoFocus />
          {form.formState.errors.name && (
            <p className="text-sm text-destructive">{t('required')}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-term-number">{t('termNumber')}</Label>
          <Input
            id="edit-term-number"
            type="number"
            {...form.register('number', { setValueAs: (v) => (v === '' ? null : Number(v)) })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t('startsOn')}</Label>
            <Controller
              control={form.control}
              name="startsOn"
              render={({ field }) => (
                <DatePicker
                  value={field.value ?? ''}
                  onChange={(v) => {
                    field.onChange(v)
                    form.clearErrors('endsOn')
                  }}
                />
              )}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('endsOn')}</Label>
            <Controller
              control={form.control}
              name="endsOn"
              render={({ field }) => (
                <DatePicker
                  value={field.value ?? ''}
                  onChange={(v) => {
                    field.onChange(v)
                    form.clearErrors('endsOn')
                  }}
                />
              )}
            />
            <FieldError>{form.formState.errors.endsOn?.message}</FieldError>
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
        {isActive && !term.isActive && (
          <p className="text-xs text-muted-foreground">{t('termActiveHint')}</p>
        )}
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
