'use client'

import { useState } from 'react'
import { Controller, FormProvider, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  DeliveryModeSchema,
  UpsertApplicationServiceSchema,
  type DeliveryMode,
  type FormFieldType,
  type UpsertApplicationServiceInput,
} from '@studenthub/shared-schemas'
import {
  catalogAdminKeys,
  applicationKeys,
  createApplicationService,
  customizeApplicationService,
  fetchManageCategories,
  pickLocale,
  updateApplicationService,
  type ManagedServiceDetail,
} from '../../../entities/application-service'
import {
  Button,
  Checkbox,
  FieldError,
  Input,
  Label,
  Modal,
  SegmentedTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  LANGS,
  emptyService,
  langsWithErrors,
  toFormValues,
  type Lang,
  type ServiceFormValues,
} from '../lib/form-values'
import { RequirementsEditor } from './requirements-editor'
import { FormFieldsEditor } from './form-fields-editor'

type Section = 'main' | 'documents' | 'fields'

const CHOICE_TYPES: FormFieldType[] = ['SELECT', 'RADIO']

interface ServiceEditorModalProps {
  /** null — новая услуга; иначе — редактирование (или просмотр шаблона). */
  service: ManagedServiceDetail | null
  onClose: () => void
  /** Шаблон настроен — открыть копию вуза вместо него. */
  onCustomized: (copyId: string) => void
}

/**
 * Редактор услуги каталога. Три вкладки (основное, документы, поля анкеты) и переключатель
 * языка: поля трёх языков показываются по одному, чтобы форма не растягивалась втрое.
 * Шаблон платформы у админа вуза открывается только для просмотра — с кнопкой «Настроить».
 */
export function ServiceEditorModal({ service, onClose, onCustomized }: ServiceEditorModalProps) {
  const t = useTranslations('ServiceCatalog')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const [section, setSection] = useState<Section>('main')
  const [lang, setLang] = useState<Lang>('Ru')
  const readOnly = service !== null && !service.editable

  const categories = useQuery({
    queryKey: catalogAdminKeys.categories(),
    queryFn: fetchManageCategories,
  })

  const form = useForm({
    resolver: zodResolver(UpsertApplicationServiceSchema),
    defaultValues: service ? toFormValues(service) : emptyService(),
  })
  const { register, control, formState, handleSubmit } = form
  const errors = formState.errors

  const invalidate = async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: catalogAdminKeys.all })
    // Каталог студентов тоже меняется: услуга появилась, пропала или поменялась.
    await qc.invalidateQueries({ queryKey: applicationKeys.categories() })
  }

  const save = useMutation({
    mutationFn: (input: UpsertApplicationServiceInput) =>
      service ? updateApplicationService(service.id, input) : createApplicationService(input),
    onSuccess: async () => {
      await invalidate()
      toast.success(t('saved'))
      onClose()
    },
    onError: (error) => toast.error(tErr(toApiError(error).code)),
  })

  const customize = useMutation({
    mutationFn: () => customizeApplicationService(service?.id ?? ''),
    onSuccess: async (copy) => {
      await invalidate()
      toast.success(t('customized'))
      onCustomized(copy.id)
    },
    onError: (error) => toast.error(tErr(toApiError(error).code)),
  })

  const onSubmit = handleSubmit((values) =>
    save.mutate({
      ...values,
      // Варианты ответа нужны только полям выбора: тип поменяли — старые варианты не храним.
      formFields: values.formFields.map((f) =>
        CHOICE_TYPES.includes(f.type) ? f : { ...f, options: null },
      ),
    }),
  )

  const errorLangs = langsWithErrors(errors)
  const deliveryLabel: Record<DeliveryMode, string> = {
    ELECTRONIC: t('deliveryElectronic'),
    PAPER: t('deliveryPaper'),
  }
  const sectionHasError: Record<Section, boolean> = {
    main: Object.keys(errors).some((k) => k !== 'requirements' && k !== 'formFields'),
    documents: !!errors.requirements,
    fields: !!errors.formFields,
  }

  const title = service
    ? pickLocale(service as unknown as Record<string, unknown>, 'name', locale) || service.code
    : t('newService')

  return (
    <Modal onClose={onClose} title={title} size="3xl" height="stable">
      <FormProvider {...form}>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegmentedTabs<Section>
              aria-label={t('sections')}
              value={section}
              onChange={setSection}
              compact
              items={[
                {
                  value: 'main',
                  label: <TabLabel text={t('sectionMain')} alert={sectionHasError.main} />,
                },
                {
                  value: 'documents',
                  label: (
                    <TabLabel text={t('sectionDocuments')} alert={sectionHasError.documents} />
                  ),
                },
                {
                  value: 'fields',
                  label: <TabLabel text={t('sectionFields')} alert={sectionHasError.fields} />,
                },
              ]}
            />
            <SegmentedTabs<Lang>
              aria-label={t('language')}
              value={lang}
              onChange={setLang}
              compact
              items={LANGS.map((l) => ({
                value: l,
                label: <TabLabel text={l.toUpperCase()} alert={errorLangs.has(l)} />,
              }))}
            />
          </div>

          {readOnly && <p className="text-sm text-muted-foreground">{t('templateReadOnly')}</p>}

          <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-4">
            {section === 'main' && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="svc-name">{t('name')}</Label>
                    <Input
                      id="svc-name"
                      aria-invalid={!!errors[`name${lang}`]}
                      {...register(`name${lang}`)}
                    />
                    <FieldError>
                      {errors[`name${lang}`] ? t('translationRequired') : null}
                    </FieldError>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('category')}</Label>
                    <Controller
                      control={control}
                      name="categoryId"
                      render={({ field }) => (
                        <Select value={field.value || undefined} onValueChange={field.onChange}>
                          <SelectTrigger
                            size="md"
                            aria-label={t('category')}
                            aria-invalid={!!errors.categoryId}
                          >
                            <SelectValue placeholder={t('categoryPick')} />
                          </SelectTrigger>
                          <SelectContent>
                            {(categories.data ?? []).map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {pickLocale(
                                  c as unknown as Record<string, unknown>,
                                  'name',
                                  locale,
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FieldError>{errors.categoryId ? t('categoryRequired') : null}</FieldError>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="svc-code">{t('code')}</Label>
                    {/* Код — ключ, по которому копия вуза заменяет шаблон; после создания
                        не меняется (сервер это тоже проверяет). */}
                    <Input
                      id="svc-code"
                      disabled={service !== null}
                      placeholder="dorm-certificate"
                      aria-invalid={!!errors.code}
                      aria-describedby="svc-code-hint"
                      {...register('code')}
                    />
                    <p id="svc-code-hint" className="text-xs text-muted-foreground">
                      {t('codeHint')}
                    </p>
                    <FieldError>{errors.code ? t('codeInvalid') : null}</FieldError>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="svc-sla">{t('slaHours')}</Label>
                    <Input
                      id="svc-sla"
                      type="number"
                      min={1}
                      aria-invalid={!!errors.slaHours}
                      {...register('slaHours', { valueAsNumber: true })}
                    />
                    <FieldError>{errors.slaHours ? t('slaInvalid') : null}</FieldError>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="svc-desc">{t('description')}</Label>
                  <Textarea id="svc-desc" rows={3} {...register(`description${lang}`)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="svc-instr">{t('instructions')}</Label>
                  <Textarea
                    id="svc-instr"
                    rows={3}
                    placeholder={t('instructionsPlaceholder')}
                    {...register(`instructions${lang}`)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">{t('delivery')}</p>
                  <Controller
                    control={control}
                    name="deliveryModes"
                    render={({ field }) => (
                      <div className="flex flex-wrap gap-4">
                        {DeliveryModeSchema.options.map((mode) => (
                          <label key={mode} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={field.value.includes(mode)}
                              onCheckedChange={(v) =>
                                field.onChange(
                                  v === true
                                    ? [...field.value, mode]
                                    : field.value.filter((m) => m !== mode),
                                )
                              }
                            />
                            {deliveryLabel[mode]}
                          </label>
                        ))}
                      </div>
                    )}
                  />
                  <FieldError>{errors.deliveryModes ? t('deliveryRequired') : null}</FieldError>
                </div>

                <div className="flex flex-col gap-2">
                  <Flag name="requiresPickup" label={t('requiresPickup')} />
                  <Flag
                    name="facultyScoped"
                    label={t('facultyScoped')}
                    hint={t('facultyScopedHint')}
                  />
                  <Flag name="active" label={t('active')} hint={t('activeHint')} />
                </div>
              </>
            )}

            {section === 'documents' && <RequirementsEditor lang={lang} readOnly={readOnly} />}
            {section === 'fields' && <FormFieldsEditor lang={lang} readOnly={readOnly} />}
          </fieldset>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
            {readOnly ? (
              service?.isTemplate && (
                <Button
                  type="button"
                  loading={customize.isPending}
                  onClick={() => customize.mutate()}
                >
                  {t('customize')}
                </Button>
              )
            ) : (
              <Button type="submit" loading={save.isPending}>
                {t('save')}
              </Button>
            )}
          </div>
        </form>
      </FormProvider>
    </Modal>
  )
}

// Подпись вкладки с точкой-ошибкой: ошибка в скрытой вкладке иначе выглядела бы так, будто
// кнопка «Сохранить» просто не работает.
function TabLabel({ text, alert }: { text: string; alert: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {text}
      {alert && <span className="size-1.5 rounded-full bg-destructive" aria-hidden />}
    </span>
  )
}

function Flag({
  name,
  label,
  hint,
}: {
  name: 'requiresPickup' | 'facultyScoped' | 'active'
  label: string
  hint?: string
}) {
  return (
    <Controller<ServiceFormValues, typeof name>
      name={name}
      render={({ field }) => (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={field.value ?? false}
            onCheckedChange={(v) => field.onChange(v === true)}
          />
          <span className="flex flex-col">
            {label}
            {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
          </span>
        </label>
      )}
    />
  )
}
