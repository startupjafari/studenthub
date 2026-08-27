'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { CreateFacultySchema, type CreateFacultyInput } from '@studenthub/shared-schemas'
import { Button, FieldError, Input, Label, Modal } from '../../../shared/ui'
import { createFacultyRequest, facultyKeys } from '../../../entities/faculty'
import { fetchMe, userKeys } from '../../../entities/user'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

interface Props {
  onClose: () => void
}

// Создание факультета. Форма занимала верх страницы постоянно, хотя факультеты заводят
// один раз при настройке вуза, а смотрят на список — каждый раз.
export function CreateFacultyModal({ onClose }: Props) {
  const t = useTranslations('UniAdmin')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })

  const form = useForm<CreateFacultyInput>({ resolver: zodResolver(CreateFacultySchema) })
  // Вуз берётся из профиля создателя, а не из формы: админ заводит факультет только
  // в своём вузе (scope на сервере всё равно перепроверяется).
  useEffect(() => {
    if (me.data) form.setValue('universityId', me.data.universityId ?? '')
  }, [me.data, form])

  const createMut = useMutation({
    mutationFn: createFacultyRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: facultyKeys.list() })
      toast.success(t('facultyCreated'))
      onClose()
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  return (
    <Modal onClose={onClose} title={t('addFaculty')} size="md">
      <form
        onSubmit={form.handleSubmit((v) => createMut.mutate(v))}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fname">{t('facultyName')}</Label>
          <Input
            id="fname"
            autoFocus
            placeholder={t('facultyNamePlaceholder')}
            aria-invalid={!!form.formState.errors.name}
            {...form.register('name')}
          />
          <FieldError>{form.formState.errors.name ? t('nameRequired') : null}</FieldError>
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
