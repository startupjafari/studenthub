'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Controller, useFieldArray, useFormContext } from 'react-hook-form'
import { FileText, Plus, Trash2 } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { DOCUMENT_TYPE_IDS } from '@studenthub/shared-config'
import { documentTypeKeys, fetchDocumentTypes } from '../../../entities/document-type'
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
import { useAppSelector } from '../../../shared/store'
import { emptyRequirement, type Lang, type ServiceFormValues } from '../lib/form-values'

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
    <div className="flex flex-col gap-3">
      {fields.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-6" aria-hidden />}
          title={t('requirementsEmpty')}
          description={t('requirementsEmptyHint')}
          className="border-0 p-6"
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {fields.map((field, index) => (
            <li key={field.id} className="flex flex-col gap-3 rounded-xl border border-border p-3">
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor={`req-${index}-title`}>{t('requirementTitle')}</Label>
                  <Input
                    id={`req-${index}-title`}
                    aria-invalid={!!errors?.[index]?.[`title${lang}`]}
                    {...register(`requirements.${index}.title${lang}`)}
                  />
                  <FieldError>
                    {errors?.[index]?.[`title${lang}`] ? t('translationRequired') : null}
                  </FieldError>
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

              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <div className="flex flex-col gap-1.5">
                  <Label>{t('documentType')}</Label>
                  <Controller
                    control={control}
                    name={`requirements.${index}.documentType`}
                    render={({ field: f }) => (
                      <Select
                        value={f.value ?? NO_TYPE}
                        onValueChange={(v) => f.onChange(v === NO_TYPE ? null : v)}
                        disabled={readOnly}
                      >
                        <SelectTrigger size="md" aria-label={t('documentType')}>
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
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`req-${index}-max`}>{t('maxFiles')}</Label>
                  <Input
                    id={`req-${index}-max`}
                    type="number"
                    min={1}
                    max={10}
                    aria-invalid={!!errors?.[index]?.maxFiles}
                    {...register(`requirements.${index}.maxFiles`, { valueAsNumber: true })}
                  />
                </div>
              </div>

              <Controller
                control={control}
                name={`requirements.${index}.required`}
                render={({ field: f }) => (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={f.value ?? true}
                      onCheckedChange={(v) => f.onChange(v === true)}
                      disabled={readOnly}
                    />
                    {t('requirementRequired')}
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
          onClick={() => append(emptyRequirement())}
        >
          <Plus className="size-4" aria-hidden /> {t('addRequirement')}
        </Button>
      )}
    </div>
  )
}
