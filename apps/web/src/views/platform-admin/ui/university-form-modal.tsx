'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  CreateUniversitySchema,
  type CreateUniversityInput,
  type UpdateUniversityInput,
} from '@studenthub/shared-schemas'
import {
  createUniversityRequest,
  deleteUniversityRequest,
  updateUniversityRequest,
  universityKeys,
  type University,
} from '../../../entities/university'
import { KatoSelect } from '../../../entities/kato'
import { Button, Input, Label, Modal, useConfirm } from '../../../shared/ui'
import { OPTIONAL_TEXT } from '../../../shared/lib'
import { DEFAULT_UNIVERSITY_TIMEZONE, TimezoneSelect } from './timezone-select'

interface Props {
  /** Вуз для правки; без него окно создаёт новый. */
  university?: University
  onClose: () => void
}

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

// Создание и правка вуза платформенным админом. Действие редкое, поэтому живёт в модалке
// за кнопкой шапки (создание) или кликом по строке таблицы (правка), а не занимает верх
// страницы формой на постоянной основе.
export function UniversityFormModal({ university, onClose }: Props) {
  const t = useTranslations('Universities')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()

  const form = useForm<CreateUniversityInput>({
    resolver: zodResolver(CreateUniversitySchema),
    defaultValues: university
      ? {
          name: university.name,
          shortName: university.shortName ?? undefined,
          city: university.city ?? undefined,
          timezone: university.timezone,
        }
      : { timezone: DEFAULT_UNIVERSITY_TIMEZONE },
  })

  const done = (message: string): void => {
    void qc.invalidateQueries({ queryKey: universityKeys.all })
    toast.success(message)
    onClose()
  }

  const saveMut = useMutation({
    mutationFn: (input: CreateUniversityInput) => {
      if (!university) return createUniversityRequest(input)
      // Только изменённое. Очистить аббревиатуру или город схема правки не даёт
      // (поля необязательные, но не nullable) — пустое поле значит «не трогать».
      const patch: UpdateUniversityInput = {
        ...(input.name !== university.name ? { name: input.name } : {}),
        ...(input.shortName && input.shortName !== university.shortName
          ? { shortName: input.shortName }
          : {}),
        ...(input.city && input.city !== university.city ? { city: input.city } : {}),
        ...(input.timezone && input.timezone !== university.timezone
          ? { timezone: input.timezone }
          : {}),
      }
      return updateUniversityRequest(university.id, patch)
    },
    onSuccess: () => done(university ? t('updated') : t('created')),
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteUniversityRequest(id),
    onSuccess: () => done(t('deleted')),
    // Сервер удаляет только пустой вуз: с факультетами, аудиториями или людьми — CONFLICT.
    onError: (e) => toast.error(errCode(e) === 'CONFLICT' ? t('deleteConflict') : tErr(errCode(e))),
  })

  async function onDelete(u: University): Promise<void> {
    const ok = await confirm({
      title: t('deleteConfirmTitle'),
      description: t('deleteConfirmDesc', { name: u.name }),
      confirmLabel: t('delete'),
      destructive: true,
    })
    if (ok) deleteMut.mutate(u.id)
  }

  return (
    <Modal onClose={onClose} title={university ? t('edit') : t('add')} size="md">
      <form onSubmit={form.handleSubmit((v) => saveMut.mutate(v))} className="flex flex-col gap-4">
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="u-tz">{t('timezone')}</Label>
          <Controller
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <TimezoneSelect
                id="u-tz"
                value={field.value ?? DEFAULT_UNIVERSITY_TIMEZONE}
                onChange={field.onChange}
              />
            )}
          />
          <p className="text-xs text-muted-foreground">{t('timezoneHint')}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {university ? (
            <Button
              type="button"
              variant="destructive"
              loading={deleteMut.isPending}
              onClick={() => void onDelete(university)}
            >
              {t('delete')}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
          )}
          <Button type="submit" loading={saveMut.isPending}>
            {university ? tCommon('save') : t('create')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
