'use client'

import { useTranslations } from 'next-intl'
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import { ListPlus, Plus, Trash2 } from 'lucide-react'
import { FormFieldTypeSchema, type FormFieldType } from '@studenthub/shared-schemas'
import {
  Button,
  Checkbox,
  EmptyState,
  FieldError,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { emptyFormField, type Lang, type ServiceFormValues } from '../lib/form-values'

const CHOICE_TYPES: FormFieldType[] = ['SELECT', 'RADIO']

interface FormFieldsEditorProps {
  lang: Lang
  readOnly: boolean
}

// Поля анкеты услуги: что студент заполняет при подаче (причина, место требования…).
export function FormFieldsEditor({ lang, readOnly }: FormFieldsEditorProps) {
  const t = useTranslations('ServiceCatalog')
  const { control, register, formState } = useFormContext<ServiceFormValues>()
  const { fields, append, remove } = useFieldArray({ control, name: 'formFields' })
  const errors = formState.errors.formFields

  const typeLabel: Record<FormFieldType, string> = {
    TEXT: t('fieldTypeText'),
    TEXTAREA: t('fieldTypeTextarea'),
    NUMBER: t('fieldTypeNumber'),
    DATE: t('fieldTypeDate'),
    SELECT: t('fieldTypeSelect'),
    RADIO: t('fieldTypeRadio'),
    CHECKBOX: t('fieldTypeCheckbox'),
    BOOLEAN: t('fieldTypeBoolean'),
  }

  return (
    <div className="flex flex-col gap-3">
      {fields.length === 0 ? (
        <EmptyState
          icon={<ListPlus className="size-6" aria-hidden />}
          title={t('fieldsEmpty')}
          description={t('fieldsEmptyHint')}
          className="border-0 p-6"
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {fields.map((field, index) => (
            <li key={field.id} className="flex flex-col gap-3 rounded-xl border border-border p-3">
              <div className="flex items-start gap-2">
                <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_11rem]">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`field-${index}-label`}>{t('fieldLabel')}</Label>
                    <Input
                      id={`field-${index}-label`}
                      aria-invalid={!!errors?.[index]?.[`label${lang}`]}
                      {...register(`formFields.${index}.label${lang}`)}
                    />
                    <FieldError>
                      {errors?.[index]?.[`label${lang}`] ? t('translationRequired') : null}
                    </FieldError>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('fieldType')}</Label>
                    <Controller
                      control={control}
                      name={`formFields.${index}.type`}
                      render={({ field: f }) => (
                        <Select value={f.value} onValueChange={f.onChange} disabled={readOnly}>
                          <SelectTrigger size="md" aria-label={t('fieldType')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FormFieldTypeSchema.options.map((type) => (
                              <SelectItem key={type} value={type}>
                                {typeLabel[type]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    className="mt-6"
                    aria-label={t('remove')}
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`field-${index}-ph`}>{t('fieldPlaceholder')}</Label>
                <Input
                  id={`field-${index}-ph`}
                  {...register(`formFields.${index}.placeholder${lang}`)}
                />
              </div>

              <FieldOptions index={index} lang={lang} readOnly={readOnly} />

              <Controller
                control={control}
                name={`formFields.${index}.required`}
                render={({ field: f }) => (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={f.value ?? false}
                      onCheckedChange={(v) => f.onChange(v === true)}
                      disabled={readOnly}
                    />
                    {t('fieldRequired')}
                  </label>
                )}
              />
            </li>
          ))}
        </ol>
      )}

      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => append(emptyFormField())}
        >
          <Plus className="size-4" aria-hidden /> {t('addField')}
        </Button>
      )}
    </div>
  )
}

// Варианты ответа — только у полей выбора. Значение (value) — то, что ляжет в ответ формы;
// подпись — то, что увидит студент на своём языке.
function FieldOptions({ index, lang, readOnly }: { index: number; lang: Lang; readOnly: boolean }) {
  const t = useTranslations('ServiceCatalog')
  const { control, register, formState } = useFormContext<ServiceFormValues>()
  const type = useWatch({ control, name: `formFields.${index}.type` })
  const { fields, append, remove } = useFieldArray({
    control,
    name: `formFields.${index}.options`,
  })
  if (!type || !CHOICE_TYPES.includes(type)) return null

  const fieldErrors = formState.errors.formFields?.[index]
  const errors = fieldErrors?.options

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
      <p className="text-sm font-medium">{t('options')}</p>
      {fields.map((option, optionIndex) => (
        <div key={option.id} className="grid items-start gap-2 sm:grid-cols-[9rem_1fr_auto]">
          <Input
            placeholder={t('optionValue')}
            aria-label={t('optionValue')}
            aria-invalid={!!errors?.[optionIndex]?.value}
            {...register(`formFields.${index}.options.${optionIndex}.value`)}
          />
          <Input
            placeholder={t('optionLabel')}
            aria-label={t('optionLabel')}
            aria-invalid={!!errors?.[optionIndex]?.[`label${lang}`]}
            {...register(`formFields.${index}.options.${optionIndex}.label${lang}`)}
          />
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon
              aria-label={t('remove')}
              onClick={() => remove(optionIndex)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      ))}
      {/* Ошибка «нужен хотя бы один вариант» висит на самом массиве, а не на строке. */}
      <FieldError>
        {errors?.message || errors?.root?.message ? t('optionsRequired') : null}
      </FieldError>
      {!readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => append({ value: '', labelRu: '', labelKk: '', labelEn: '' })}
        >
          <Plus className="size-4" aria-hidden /> {t('addOption')}
        </Button>
      )}
    </div>
  )
}
