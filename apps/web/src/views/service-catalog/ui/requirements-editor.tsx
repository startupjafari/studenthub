'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Controller, useFieldArray, useFormContext } from 'react-hook-form'
import { FileText } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { DOCUMENT_TYPE_IDS } from '@studenthub/shared-config'
import { documentTypeKeys, fetchDocumentTypes } from '../../../entities/document-type'
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { useAppSelector } from '../../../shared/store'
import { emptyRequirement, type Lang, type ServiceFormValues } from '../lib/form-values'
import { Field, ItemCard, ItemList, RequiredToggle } from './form-parts'

// Значение «без типа» для Select: Radix не принимает пустую строку как значение пункта.
const NO_TYPE = '__none__'

interface RequirementsEditorProps {
  lang: Lang
  readOnly: boolean
}

/**
 * Документы, которые студент прикладывает к заявке. Тип из каталога «Документов» даёт
 * студенту выбрать уже загруженный документ из хранилища вместо повторной загрузки.
 */
export function RequirementsEditor({ lang, readOnly }: RequirementsEditorProps) {
  const t = useTranslations('ServiceCatalog')
  const tDoc = useTranslations('Documents')
  const role = useAppSelector((s) => s.auth.role)
  const { control, register, formState } = useFormContext<ServiceFormValues>()
  const { fields, append, remove } = useFieldArray({ control, name: 'requirements' })

  // У вуза каталог типов свой (с выключенными и собственными типами); шаблон платформы
  // общий для всех вузов — ему доступны только статические типы.
  const isUniAdmin = role === Role.UNIVERSITY_ADMIN
  const types = useQuery({
    queryKey: documentTypeKeys.list(),
    queryFn: fetchDocumentTypes,
    enabled: isUniAdmin,
  })
  const typeOptions = isUniAdmin
    ? (types.data ?? [])
        .filter((d) => d.enabled)
        .map((d) => ({
          id: d.typeId,
          label: d.custom ? (d.label ?? d.typeId) : tDoc(`docType_${d.typeId}`),
        }))
    : DOCUMENT_TYPE_IDS.map((id) => ({ id, label: tDoc(`docType_${id}`) }))

  const errors = formState.errors.requirements

  return (
    <ItemList
      empty={
        fields.length === 0
          ? {
              icon: <FileText className="size-6" aria-hidden />,
              title: t('requirementsEmpty'),
              description: t('requirementsEmptyHint'),
            }
          : null
      }
      addLabel={t('addRequirement')}
      onAdd={() => append(emptyRequirement())}
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
              name={`requirements.${index}.required`}
              render={({ field: f }) => (
                <RequiredToggle
                  label={t('requirementRequired')}
                  checked={f.value ?? true}
                  onChange={f.onChange}
                  disabled={readOnly}
                />
              )}
            />
          }
        >
          <Field
            label={t('requirementTitle')}
            htmlFor={`req-${index}-title`}
            error={errors?.[index]?.[`title${lang}`] ? t('translationRequired') : null}
          >
            <Input
              id={`req-${index}-title`}
              aria-invalid={!!errors?.[index]?.[`title${lang}`]}
              {...register(`requirements.${index}.title${lang}`)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('documentType')} htmlFor={`req-${index}-type`}>
              <Controller
                control={control}
                name={`requirements.${index}.documentType`}
                render={({ field: f }) => (
                  <Select
                    value={f.value ?? NO_TYPE}
                    onValueChange={(v) => f.onChange(v === NO_TYPE ? null : v)}
                    disabled={readOnly}
                  >
                    <SelectTrigger id={`req-${index}-type`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TYPE}>{t('documentTypeAny')}</SelectItem>
                      {/* Тип мог пропасть из каталога вуза (выключен) — значение всё равно
                          показываем, иначе селект выглядел бы пустым и вводил в заблуждение. */}
                      {f.value && !typeOptions.some((o) => o.id === f.value) && (
                        <SelectItem value={f.value}>{f.value}</SelectItem>
                      )}
                      {typeOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label={t('maxFiles')} htmlFor={`req-${index}-max`}>
              <Input
                id={`req-${index}-max`}
                type="number"
                min={1}
                max={10}
                aria-invalid={!!errors?.[index]?.maxFiles}
                {...register(`requirements.${index}.maxFiles`, { valueAsNumber: true })}
              />
            </Field>
          </div>
        </ItemCard>
      ))}
    </ItemList>
  )
}
