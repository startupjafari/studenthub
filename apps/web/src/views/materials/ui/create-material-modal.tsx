'use client'

import { Controller, useForm, useWatch } from 'react-hook-form'
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
import { GroupSelect } from '../../../entities/group'
import { courseKeys, fetchCourses } from '../../../entities/course'
import { useAppSelector } from '../../../shared/store'
import { Role } from '@studenthub/shared-types'

// «Без дисциплины» в селекте: Radix не принимает пустую строку как значение пункта.
const NO_SUBJECT = '__none__'

// Создание материала. Форма в окне, а не развёрнута на странице (§10.1): иначе список
// материалов уезжает под сгиб, а сама форма висит на экране у всех, кто просто читает.
export function CreateMaterialModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Materials')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const errorToast = useErrorToast('create-material')

  const form = useForm<CreateMaterialInput>({ resolver: zodResolver(CreateMaterialSchema) })
  const role = useAppSelector((s) => s.auth.role)

  // Предмет выбирается из дисциплин группы, а не вводится текстом: студент видит материал
  // во вкладке дисциплины по ТОЧНОМУ совпадению названия, и опечатка прятала материал от
  // него совсем. Преподавателю — только его дисциплины.
  const groupId = useWatch({ control: form.control, name: 'groupId' })
  const courseFilters = { groupId, ...(role === Role.TEACHER ? { mine: true } : {}) }
  const courses = useQuery({
    queryKey: courseKeys.list(courseFilters),
    queryFn: () => fetchCourses(courseFilters),
    enabled: !!groupId,
  })
  const subjects = [...new Set((courses.data ?? []).map((c) => c.subject.name))].sort((a, b) =>
    a.localeCompare(b),
  )

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
            <Label htmlFor="m-group">{t('group')}</Label>
            {/* Поиск по группам на сервере: выбор из первых 100 по алфавиту не давал
                выложить материал группе из хвоста алфавита в большом вузе. */}
            <Controller
              control={form.control}
              name="groupId"
              render={({ field }) => (
                <GroupSelect
                  id="m-group"
                  value={field.value ?? null}
                  onChange={(v) => {
                    field.onChange(v ?? undefined)
                    // Дисциплины у другой группы свои — прежний выбор к ней не относится.
                    form.setValue('subject', undefined)
                  }}
                  placeholder={t('selectGroup')}
                />
              )}
            />
            <FieldError>{form.formState.errors.groupId ? t('required') : null}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('subject')}</Label>
            <Controller
              control={form.control}
              name="subject"
              render={({ field }) => (
                <Select
                  value={field.value ?? NO_SUBJECT}
                  onValueChange={(v) => field.onChange(v === NO_SUBJECT ? undefined : v)}
                  disabled={!groupId}
                >
                  <SelectTrigger aria-label={t('subject')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SUBJECT}>{t('noSubject')}</SelectItem>
                    {subjects.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {groupId && !courses.isLoading && subjects.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('noSubjectsHint')}</p>
            )}
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
