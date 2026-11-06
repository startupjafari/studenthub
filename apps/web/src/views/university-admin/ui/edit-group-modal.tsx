'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { UpdateGroupSchema, type UpdateGroupInput } from '@studenthub/shared-schemas'
import { Button, FieldError, Input, Label, Modal } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { groupKeys, updateGroupRequest, type Group } from '../../../entities/group'

interface EditGroupModalProps {
  group: Group
  onClose: () => void
}

// Правка группы: название и год набора. Факультет не меняется — перенос группы между
// факультетами API не поддерживает (за ней тянутся расписание, дисциплины и деканат).
export function EditGroupModal({ group, onClose }: EditGroupModalProps) {
  const t = useTranslations('UniAdmin')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const form = useForm<UpdateGroupInput>({
    resolver: zodResolver(UpdateGroupSchema),
    defaultValues: { name: group.name, year: group.year ?? undefined },
  })

  const save = useMutation({
    mutationFn: (input: UpdateGroupInput) => updateGroupRequest(group.id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: groupKeys.all })
      toast.success(t('groupUpdated'))
      onClose()
    },
    onError: (e) => {
      const code = toApiError(e).code
      toast.error(code === 'CONFLICT' ? t('nameTaken') : tErr(code))
    },
  })

  return (
    <Modal onClose={onClose} title={t('editGroup')} size="md">
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="egname">{t('groupName')}</Label>
          <Input
            id="egname"
            autoFocus
            aria-invalid={!!form.formState.errors.name}
            {...form.register('name')}
          />
          <FieldError>{form.formState.errors.name ? t('nameRequired') : null}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="egyear">{t('year')}</Label>
          <Input
            id="egyear"
            type="number"
            placeholder="2024"
            aria-invalid={!!form.formState.errors.year}
            {...form.register('year', {
              // Пустое поле — «год не указан» (null стирает прежний), а не «не менять».
              setValueAs: (v: string | number | null | undefined) =>
                v === '' || v === undefined || v === null ? null : Number(v),
            })}
          />
          <FieldError>{form.formState.errors.year ? t('yearInvalid') : null}</FieldError>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
