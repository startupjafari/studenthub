'use client'

import { useState } from 'react'
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Info } from 'lucide-react'
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
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  FieldError,
  Input,
  Modal,
  SectionPanel,
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
import { Field, OptionRow } from './form-parts'

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

  // Счётчики на вкладках: сколько документов и вопросов, видно, не открывая раздел.
  const requirementsCount = useWatch({ control, name: 'requirements' })?.length ?? 0
  const fieldsCount = useWatch({ control, name: 'formFields' })?.length ?? 0

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
    // Окно со вкладками — постоянной высоты (DESIGN_SYSTEM §10.5): переключение разделов не
    // двигает его под курсором. Тело отдаёт отступы и прокрутку содержимому: вкладки сверху
    // и кнопки снизу закреплены, прокручивается только раздел между ними.
    <Modal
      onClose={onClose}
      title={title}
      size="3xl"
      height="stable"
      bodyClassName="overflow-hidden p-0"
    >
      <FormProvider {...form}>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-5 pt-5">
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
                  count: requirementsCount,
                },
                {
                  value: 'fields',
                  label: <TabLabel text={t('sectionFields')} alert={sectionHasError.fields} />,
                  count: fieldsCount,
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

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-5">
            {readOnly && (
              <Alert variant="info">
                <Info aria-hidden />
                <AlertDescription>{t('templateReadOnly')}</AlertDescription>
              </Alert>
            )}

            <fieldset disabled={readOnly} className="flex min-w-0 flex-1 flex-col gap-4">
              {section === 'main' && (
                <>
                  {/* Поля попарно в две равные колонки: у каждой пары одинаковая высота
                      контролов (общий размер lg) и одинаковое устройство — подпись, поле,
                      подсказка, ошибка, — поэтому колонки идут ровно друг против друга. */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label={t('name')}
                      htmlFor="svc-name"
                      error={errors[`name${lang}`] ? t('translationRequired') : null}
                    >
                      <Input
                        id="svc-name"
                        aria-invalid={!!errors[`name${lang}`]}
                        {...register(`name${lang}`)}
                      />
                    </Field>
                    <Field
                      label={t('category')}
                      htmlFor="svc-category"
                      error={errors.categoryId ? t('categoryRequired') : null}
                    >
                      <Controller
                        control={control}
                        name="categoryId"
                        render={({ field }) => (
                          <Select value={field.value || undefined} onValueChange={field.onChange}>
                            <SelectTrigger id="svc-category" aria-invalid={!!errors.categoryId}>
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
                    </Field>

                    {/* Код — ключ, по которому копия вуза заменяет шаблон; после создания
                        не меняется (сервер это тоже проверяет). */}
                    <Field
                      label={t('code')}
                      htmlFor="svc-code"
                      hint={t('codeHint')}
                      error={errors.code ? t('codeInvalid') : null}
                    >
                      <Input
                        id="svc-code"
                        disabled={service !== null}
                        placeholder="dorm-certificate"
                        aria-invalid={!!errors.code}
                        aria-describedby="svc-code-hint"
                        {...register('code')}
                      />
                    </Field>
                    <Field
                      label={t('slaHours')}
                      htmlFor="svc-sla"
                      hint={t('slaHint')}
                      error={errors.slaHours ? t('slaInvalid') : null}
                    >
                      <Input
                        id="svc-sla"
                        type="number"
                        min={1}
                        aria-invalid={!!errors.slaHours}
                        aria-describedby="svc-sla-hint"
                        {...register('slaHours', { valueAsNumber: true })}
                      />
                    </Field>

                    <Field label={t('description')} htmlFor="svc-desc">
                      <Textarea id="svc-desc" rows={4} {...register(`description${lang}`)} />
                    </Field>
                    <Field label={t('instructions')} htmlFor="svc-instr">
                      <Textarea
                        id="svc-instr"
                        rows={4}
                        placeholder={t('instructionsPlaceholder')}
                        {...register(`instructions${lang}`)}
                      />
                    </Field>
                  </div>

                  {/* Флаги — две панели настроек одной высоты (DESIGN_SYSTEM §10.6): слева
                      выдача результата, справа обработка заявки. */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SectionPanel
                      title={t('delivery')}
                      subtitle={t('deliveryHint')}
                      bodyClassName="py-0"
                    >
                      <Controller
                        control={control}
                        name="deliveryModes"
                        render={({ field }) => (
                          <>
                            {DeliveryModeSchema.options.map((mode) => (
                              <OptionRow
                                key={mode}
                                label={deliveryLabel[mode]}
                                control={
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
                                }
                              />
                            ))}
                          </>
                        )}
                      />
                      <Flag name="requiresPickup" label={t('requiresPickup')} />
                      <FieldError className="pb-3">
                        {errors.deliveryModes ? t('deliveryRequired') : null}
                      </FieldError>
                    </SectionPanel>
                    <SectionPanel
                      title={t('processing')}
                      subtitle={t('processingHint')}
                      bodyClassName="py-0"
                    >
                      <Flag
                        name="facultyScoped"
                        label={t('facultyScoped')}
                        hint={t('facultyScopedHint')}
                      />
                      <Flag name="active" label={t('active')} hint={t('activeHint')} />
                    </SectionPanel>
                  </div>
                </>
              )}

              {section === 'documents' && <RequirementsEditor lang={lang} readOnly={readOnly} />}
              {section === 'fields' && <FormFieldsEditor lang={lang} readOnly={readOnly} />}
            </fieldset>
          </div>

          {/* Стороны кнопок фиксированы (DESIGN_SYSTEM §10.5): уход слева, подтверждение
              справа. Ряд закреплён под разделом — на любой вкладке он в одном месте. */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-4">
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
        <OptionRow
          label={label}
          hint={hint}
          control={
            <Checkbox
              checked={field.value ?? false}
              onCheckedChange={(v) => field.onChange(v === true)}
            />
          }
        />
      )}
    />
  )
}
