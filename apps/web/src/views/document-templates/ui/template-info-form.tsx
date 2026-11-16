'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import type { z } from 'zod'
import {
  CreateDocumentTemplateSchema,
  DOCUMENT_TEMPLATE_CATEGORY_VALUES,
  DOCUMENT_TEMPLATE_LOCALE_VALUES,
  type CreateDocumentTemplateInput,
} from '@studenthub/shared-schemas'
import {
  Button,
  FieldError,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../shared/ui'

interface TemplateInfoFormProps {
  defaultValues?: Partial<CreateDocumentTemplateInput>
  submitLabel: string
  pending: boolean
  onSubmit: (values: CreateDocumentTemplateInput) => void
  onCancel: () => void
}

// Название, вид, описание и язык шаблона — шаг 1 мастера и окно «Изменить».
export function TemplateInfoForm({
  defaultValues,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: TemplateInfoFormProps) {
  const t = useTranslations('DocumentTemplates')
  const tCommon = useTranslations('Common')
  // У схемы есть значение по умолчанию (язык), поэтому вход формы и результат проверки —
  // разные типы: поле может прийти пустым, а наружу уходит уже заполненным.
  const form = useForm<
    z.input<typeof CreateDocumentTemplateSchema>,
    unknown,
    CreateDocumentTemplateInput
  >({
    resolver: zodResolver(CreateDocumentTemplateSchema),
    defaultValues: { category: 'CERTIFICATE', locale: 'ru', ...defaultValues },
  })
  const { errors } = form.formState

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-title">{t('fieldTitle')}</Label>
        <Input
          id="tpl-title"
          autoFocus
          placeholder={t('fieldTitlePlaceholder')}
          aria-invalid={!!errors.title}
          {...form.register('title')}
        />
        <FieldError>{errors.title ? t('titleRequired') : null}</FieldError>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-category">{t('fieldCategory')}</Label>
          <Controller
            control={form.control}
            name="category"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="tpl-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TEMPLATE_CATEGORY_VALUES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`category_${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-locale">{t('fieldLocale')}</Label>
          <Controller
            control={form.control}
            name="locale"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="tpl-locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TEMPLATE_LOCALE_VALUES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {t(`locale_${l}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <p className="text-xs text-muted-foreground">{t('fieldLocaleHint')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-description">{t('fieldDescription')}</Label>
        <Textarea
          id="tpl-description"
          rows={3}
          placeholder={t('fieldDescriptionPlaceholder')}
          aria-invalid={!!errors.description}
          {...form.register('description')}
        />
        <FieldError>{errors.description ? t('descriptionTooLong') : null}</FieldError>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
