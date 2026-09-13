'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CreateMaterialSchema, type CreateMaterialInput } from '@studenthub/shared-schemas'
import {
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { OPTIONAL_TEXT, useErrorToast } from '../../../shared/lib'
import { createMaterialRequest, materialKeys } from '../../../entities/material'
import { fetchGroups, groupKeys } from '../../../entities/group'

// Создание материала. Форма в окне, а не развёрнута на странице (§10.1): иначе список
// материалов уезжает под сгиб, а сама форма висит на экране у всех, кто просто читает.
export function CreateMaterialModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Materials')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const errorToast = useErrorToast('create-material')

  const groups = useQuery({ queryKey: groupKeys.list(), queryFn: () => fetchGroups() })
  const form = useForm<CreateMaterialInput>({ resolver: zodResolver(CreateMaterialSchema) })

  const create = useMutation({
    mutationFn: (input: CreateMaterialInput) =>
      createMaterialRequest({ ...input, url: input.url || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: materialKeys.all })
      toast.success(t('created'))
      onClose()
    },
    onError: (e) => errorToast.show(e),
  })

  return (
    <Modal onClose={onClose} title={t('add')}>
      <form
        onSubmit={form.handleSubmit((v) => create.mutate(v))}
        className="flex flex-col gap-4"
        noValidate
      >
        {/* Группа и предмет — короткие поля, стоят в одной строке; название, описание
            и ссылка идут во всю ширину окна. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t('group')}</Label>
            <Controller
              control={form.control}
              name="groupId"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger aria-invalid={!!form.formState.errors.groupId}>
                    <SelectValue placeholder={t('selectGroup')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(groups.data ?? []).map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError>{form.formState.errors.groupId ? t('required') : null}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-subject">{t('subject')}</Label>
            <Input id="m-subject" {...form.register('subject', OPTIONAL_TEXT)} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-title">{t('materialTitle')}</Label>
          <Input
            id="m-title"
            {...form.register('title')}
            aria-invalid={!!form.formState.errors.title}
          />
          <FieldError>{form.formState.errors.title ? t('required') : null}</FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-desc">{t('description')}</Label>
          <Input id="m-desc" {...form.register('description')} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-url">{t('url')}</Label>
          <Input id="m-url" {...form.register('url', OPTIONAL_TEXT)} placeholder="https://…" />
          <FieldError>{form.formState.errors.url ? t('urlInvalid') : null}</FieldError>
        </div>

        <p className="text-xs text-muted-foreground">{t('fileHint')}</p>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={create.isPending}>
            {t('add')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
