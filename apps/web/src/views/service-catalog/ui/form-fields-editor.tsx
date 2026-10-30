'use client'

import { useTranslations } from 'next-intl'
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import { ListPlus, Plus, Trash2 } from 'lucide-react'
import { FormFieldTypeSchema, type FormFieldType } from '@studenthub/shared-schemas'
import {
  Button,
  FieldError,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { emptyFormField, type Lang, type ServiceFormValues } from '../lib/form-values'
import { Field, ItemCard, ItemList, RequiredToggle } from './form-parts'

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
    <ItemList
      empty={
        fields.length === 0
          ? {
              icon: <ListPlus className="size-6" aria-hidden />,
              title: t('fieldsEmpty'),
              description: t('fieldsEmptyHint'),
            }
          : null
      }
      addLabel={t('addField')}
      onAdd={() => append(emptyFormField())}
      readOnly={readOnly}
    >
      {fields.map((field, index) => (
        <ItemCard
          key={field.id}
          removeLabel={t('remove')}
          onRemove={readOnly ? undefined : () => remove(index)}
          required={
            <Controller
              control={control}
              name={`formFields.${index}.required`}
              render={({ field: f }) => (
                <RequiredToggle
                  label={t('fieldRequired')}
                  checked={f.value ?? false}
                  onChange={f.onChange}
                  disabled={readOnly}
                />
              )}
            />
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('fieldLabel')}
              htmlFor={`field-${index}-label`}
              error={errors?.[index]?.[`label${lang}`] ? t('translationRequired') : null}
            >
              <Input
                id={`field-${index}-label`}
                aria-invalid={!!errors?.[index]?.[`label${lang}`]}
                {...register(`formFields.${index}.label${lang}`)}
              />
            </Field>
            <Field label={t('fieldType')} htmlFor={`field-${index}-type`}>
              <Controller
                control={control}
                name={`formFields.${index}.type`}
                render={({ field: f }) => (
                  <Select value={f.value} onValueChange={f.onChange} disabled={readOnly}>
                    <SelectTrigger id={`field-${index}-type`}>
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
            </Field>
          </div>

          <Field label={t('fieldPlaceholder')} htmlFor={`field-${index}-ph`}>
            <Input
              id={`field-${index}-ph`}
              {...register(`formFields.${index}.placeholder${lang}`)}
            />
          </Field>

          <FieldOptions index={index} lang={lang} readOnly={readOnly} />
        </ItemCard>
      ))}
    </ItemList>
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
    <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
      {/* Шапка блока: заголовок слева, добавление справа — как у панелей системы. */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{t('options')}</p>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => append({ value: '', labelRu: '', labelKk: '', labelEn: '' })}
          >
            <Plus className="size-4" aria-hidden /> {t('addOption')}
          </Button>
        )}
      </div>
      {/* Значение и подпись — две равные колонки, удаление — квадрат той же высоты. */}
      {fields.map((option, optionIndex) => (
        <div key={option.id} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_auto]">
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
              icon
              aria-label={t('remove')}
              title={t('remove')}
              onClick={() => remove(optionIndex)}
              className="text-muted-foreground hover:text-destructive"
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
    </div>
  )
}
