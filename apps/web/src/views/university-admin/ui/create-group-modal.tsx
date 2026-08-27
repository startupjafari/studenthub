'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { CreateGroupSchema, type CreateGroupInput } from '@studenthub/shared-schemas'
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
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import { createGroupRequest, groupKeys } from '../../../entities/group'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

interface Props {
  onClose: () => void
}

// Создание учебной группы. Форма из трёх полей занимала верх страницы постоянно, хотя
// группы заводят пачкой раз в год, а список смотрят каждый день.
export function CreateGroupModal({ onClose }: Props) {
  const t = useTranslations('UniAdmin')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const faculties = useQuery({ queryKey: facultyKeys.list(), queryFn: () => fetchFaculties() })
  const form = useForm<CreateGroupInput>({ resolver: zodResolver(CreateGroupSchema) })

  const createMut = useMutation({
    mutationFn: createGroupRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: groupKeys.list() })
      toast.success(t('groupCreated'))
      onClose()
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  return (
    <Modal onClose={onClose} title={t('addGroup')} size="md">
      <form
        onSubmit={form.handleSubmit((v) => createMut.mutate(v))}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gname">{t('groupName')}</Label>
          <Input
            id="gname"
            autoFocus
            placeholder={t('groupNamePlaceholder')}
            aria-invalid={!!form.formState.errors.name}
            {...form.register('name')}
          />
          <FieldError>{form.formState.errors.name ? t('nameRequired') : null}</FieldError>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gyear">{t('year')}</Label>
            <Input
              id="gyear"
              type="number"
              placeholder="2024"
              aria-invalid={!!form.formState.errors.year}
              {...form.register('year', {
                // Пустое поле — «год не указан», а не NaN: Number('') даёт 0 и прошёл бы
                // как валидный год.
                setValueAs: (v: string) => (v === '' ? undefined : Number(v)),
              })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('faculty')}</Label>
            <Controller
              control={form.control}
              name="facultyId"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger aria-invalid={!!form.formState.errors.facultyId}>
                    <SelectValue placeholder={t('selectFaculty')} />
                  </SelectTrigger>
                  <SelectContent>
                    {faculties.data?.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError>{form.formState.errors.facultyId ? t('selectFaculty') : null}</FieldError>
          </div>
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
