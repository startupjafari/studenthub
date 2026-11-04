'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CreateCampusSchema, type CreateCampusInput } from '@studenthub/shared-schemas'
import { campusKeys, createCampus } from '../../../entities/campus'
import { Button, FieldError, Input, Label, Modal, Textarea } from '../../../shared/ui'
import { OPTIONAL_TEXT, toApiError } from '../../../shared/lib'

export function CreateCampusModal({
  basePath,
  onClose,
}: {
  basePath: string
  onClose: () => void
}) {
  const t = useTranslations('Campus')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const router = useRouter()
  const form = useForm<CreateCampusInput>({
    resolver: zodResolver(CreateCampusSchema),
    defaultValues: { name: '' },
  })
  const mut = useMutation({
    mutationFn: createCampus,
    onSuccess: (campus) => {
      void qc.invalidateQueries({ queryKey: campusKeys.list() })
      onClose()
      router.push(`${basePath}/${campus.id}`)
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })
  return (
    <Modal onClose={onClose} title={t('createCampus')} size="md">
      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => mut.mutate(v))}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campus-name">{t('campusName')}</Label>
          <Input
            id="campus-name"
            autoFocus
            placeholder={t('campusNamePlaceholder')}
            aria-invalid={!!form.formState.errors.name}
            {...form.register('name')}
          />
          <FieldError>{form.formState.errors.name ? t('nameRequired') : null}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campus-description">{t('campusDescription')}</Label>
          <Textarea
            id="campus-description"
            rows={3}
            {...form.register('description', OPTIONAL_TEXT)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={mut.isPending}>
            {t('create')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
