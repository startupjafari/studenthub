'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { CreateSpecialtySchema, type CreateSpecialtyInput } from '@studenthub/shared-schemas'
import { Button, FieldError, Input, Label, Modal } from '../../../shared/ui'
import { createSpecialtyRequest, specialtyKeys } from '../../../entities/specialty'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

interface Props {
  onClose: () => void
}

// Создание специальности. Как и у факультетов, справочник заполняют при настройке вуза,
// поэтому форма живёт за кнопкой в шапке, а не занимает верх страницы постоянно.
export function CreateSpecialtyModal({ onClose }: Props) {
  const t = useTranslations('UniAdmin')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const form = useForm<CreateSpecialtyInput>({ resolver: zodResolver(CreateSpecialtySchema) })

  const createMut = useMutation({
    mutationFn: createSpecialtyRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: specialtyKeys.list() })
      toast.success(t('specialtyCreated'))
      onClose()
    },
    onError: (e) => {
      const code = errCode(e)
      // Дубль показываем прямо у поля: это ошибка ввода, а не сбой — окно не закрываем.
      if (code === 'CONFLICT') form.setError('name', { message: t('specialtyExists') })
      else toast.error(tErr(code))
    },
  })

  return (
    <Modal onClose={onClose} title={t('addSpecialty')} size="md">
      <form
        onSubmit={form.handleSubmit((v) => createMut.mutate(v))}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sname">{t('specialtyName')}</Label>
          <Input
            id="sname"
            autoFocus
            placeholder={t('specialtyNamePlaceholder')}
            aria-invalid={!!form.formState.errors.name}
            {...form.register('name')}
          />
          <FieldError>
            {form.formState.errors.name?.message ??
              (form.formState.errors.name ? t('nameRequired') : null)}
          </FieldError>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={createMut.isPending}>
            {t('add')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
