'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  STICKER_LIMITS,
  StickerSetCreateSchema,
  type StickerSetCreateInput,
} from '@studenthub/shared-schemas'
import {
  createStickerSetRequest,
  stickerSetKeys,
  updateStickerSetRequest,
  type AdminStickerSet,
} from '../../../entities/sticker-set'
import { Button, FieldError, Input, Label, Modal } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib/api-error'

/** Переименование: из схемы создания берём только название — slug после создания не меняется. */
const RenameSchema = StickerSetCreateSchema.pick({ title: true })
type RenameInput = { title: string }

interface Props {
  /** Набор для переименования; без него окно создаёт новый. */
  set?: AdminStickerSet
  onClose: () => void
}

/** Создание набора (название + короткое имя) и переименование существующего. */
export function StickerSetFormModal({ set, onClose }: Props) {
  return set ? <RenameForm set={set} onClose={onClose} /> : <CreateForm onClose={onClose} />
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations('StickerAdmin')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const form = useForm<StickerSetCreateInput>({
    resolver: zodResolver(StickerSetCreateSchema),
    defaultValues: { title: '', slug: '' },
  })
  const { errors, isSubmitting } = form.formState

  const create = useMutation({
    mutationFn: createStickerSetRequest,
    onSuccess: (created) => {
      qc.setQueryData<AdminStickerSet[]>(stickerSetKeys.admin(), (old) =>
        old ? [...old, created] : old,
      )
      void qc.invalidateQueries({ queryKey: stickerSetKeys.all })
      toast.success(t('created'))
      onClose()
    },
    onError: (e) => {
      const err = toApiError(e)
      // Занятый slug — ошибка поля, а не тост: человек правит именно его.
      if (err.code === 'CONFLICT') {
        form.setError('slug', { message: t('slugTaken') })
        return
      }
      if (err.code === 'VALIDATION_ERROR' && err.details?.length) {
        for (const d of err.details) {
          if (d.field === 'title' || d.field === 'slug')
            form.setError(d.field, { message: d.message })
        }
        return
      }
      toast.error(tErr(err.code))
    },
  })

  return (
    <Modal onClose={onClose} title={t('formCreateTitle')} size="md">
      <form
        onSubmit={form.handleSubmit((v) => create.mutateAsync(v).catch(() => undefined))}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sticker-set-title">{t('fieldTitle')}</Label>
          <Input
            id="sticker-set-title"
            autoFocus
            maxLength={STICKER_LIMITS.TITLE_MAX}
            aria-invalid={errors.title ? true : undefined}
            {...form.register('title')}
          />
          {/* Длину режет maxLength, так что ошибка схемы у названия одна — пустое. */}
          <FieldError>{errors.title ? t('titleRequired') : undefined}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sticker-set-slug">{t('fieldSlug')}</Label>
          <Input
            id="sticker-set-slug"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={64}
            aria-invalid={errors.slug ? true : undefined}
            aria-describedby="sticker-set-slug-hint"
            {...form.register('slug')}
          />
          <FieldError>{errors.slug?.message}</FieldError>
          <p id="sticker-set-slug-hint" className="text-xs text-muted-foreground">
            {t('slugHint')}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" size="md" loading={isSubmitting} disabled={isSubmitting}>
            {t('create')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function RenameForm({ set, onClose }: { set: AdminStickerSet; onClose: () => void }) {
  const t = useTranslations('StickerAdmin')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const form = useForm<RenameInput>({
    resolver: zodResolver(RenameSchema),
    defaultValues: { title: set.title },
  })
  const { errors, isSubmitting } = form.formState

  const rename = useMutation({
    mutationFn: (input: RenameInput) => updateStickerSetRequest(set.id, { title: input.title }),
    onSuccess: (updated) => {
      qc.setQueryData<AdminStickerSet[]>(stickerSetKeys.admin(), (old) =>
        old?.map((s) => (s.id === updated.id ? updated : s)),
      )
      toast.success(t('renamed'))
      onClose()
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  return (
    <Modal onClose={onClose} title={t('formEditTitle')} size="md">
      <form
        onSubmit={form.handleSubmit((v) => {
          // Ничего не изменилось — сервер ответил бы «нечего менять»; просто закрываем.
          if (v.title === set.title) {
            onClose()
            return
          }
          return rename.mutateAsync(v).catch(() => undefined)
        })}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sticker-set-rename">{t('fieldTitle')}</Label>
          <Input
            id="sticker-set-rename"
            autoFocus
            maxLength={STICKER_LIMITS.TITLE_MAX}
            aria-invalid={errors.title ? true : undefined}
            {...form.register('title')}
          />
          <FieldError>{errors.title ? t('titleRequired') : undefined}</FieldError>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" size="md" loading={isSubmitting} disabled={isSubmitting}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
