'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { CreateUniversitySchema, type CreateUniversityInput } from '@studenthub/shared-schemas'
import { createUniversityRequest, universityKeys } from '../../../entities/university'
import { KatoSelect } from '../../../entities/kato'
import { Button, Input, Label, Modal } from '../../../shared/ui'
import { OPTIONAL_TEXT } from '../../../shared/lib'

interface Props {
  onClose: () => void
}

// Создание вуза платформенным админом. Действие редкое, поэтому живёт в модалке за
// кнопкой шапки, а не занимает верх страницы формой на постоянной основе.
export function CreateUniversityModal({ onClose }: Props) {
  const t = useTranslations('Universities')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const form = useForm<CreateUniversityInput>({ resolver: zodResolver(CreateUniversitySchema) })

  const createMut = useMutation({
    mutationFn: (input: CreateUniversityInput) => createUniversityRequest(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: universityKeys.list() })
      toast.success(t('created'))
      onClose()
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  return (
    <Modal onClose={onClose} title={t('add')} size="md">
      <form
        onSubmit={form.handleSubmit((v) => createMut.mutate(v))}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="u-name">{t('name')}</Label>
          <Input id="u-name" autoFocus {...form.register('name')} />
          {form.formState.errors.name && (
            <p className="text-sm text-destructive">{t('required')}</p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-short">{t('shortName')}</Label>
            <Input id="u-short" {...form.register('shortName', OPTIONAL_TEXT)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-city">{t('city')}</Label>
            {/* Хранится код КАТО, а не название: город переименуют — записи не протухнут,
                и казахская локаль берётся из справочника. Свободный ввод оставлен для
                зарубежного вуза, которого в КАТО нет. */}
            <Controller
              control={form.control}
              name="city"
              render={({ field }) => (
                <KatoSelect
                  id="u-city"
                  value={field.value ?? ''}
                  // Очистка даёт пустую строку, а схема принимает либо непустую, либо
                  // ничего — иначе сброс города валил бы валидацию формы.
                  onChange={(v) => field.onChange(v === '' ? undefined : v)}
                />
              )}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={createMut.isPending}>
            {t('create')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
