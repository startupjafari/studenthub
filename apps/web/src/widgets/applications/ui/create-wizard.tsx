'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Clock, FileText, Check } from 'lucide-react'
import type { DeliveryType } from '@studenthub/shared-schemas'
import {
  applicationKeys,
  fetchCategories,
  fetchService,
  fetchApplication,
  createDraftRequest,
  updateDraftRequest,
  submitApplicationRequest,
  pickLocale,
  type ServiceDetail,
  type ServiceFormField,
} from '../../../entities/application-service'
import { Button, Card, EmptyState, Input, Label, Skeleton, Textarea } from '../../../shared/ui'

type Step = 'catalog' | 'info' | 'form' | 'review'

function allowedDeliveryTypes(modes: string[]): DeliveryType[] {
  const e = modes.includes('ELECTRONIC')
  const p = modes.includes('PAPER')
  const out: DeliveryType[] = []
  if (e) out.push('ELECTRONIC')
  if (p) out.push('PAPER')
  if (e && p) out.push('BOTH')
  return out
}

// Мастер создания заявки: каталог → услуга → форма → проверка → отправка (§30, mobile-first).
export function CreateWizard({
  onDone,
  onCancel,
  initialDraftId,
}: {
  onDone: (id: string) => void
  onCancel: () => void
  initialDraftId?: string
}) {
  const t = useTranslations('Applications')
  const locale = useLocale()
  const qc = useQueryClient()

  const [step, setStep] = useState<Step>('catalog')
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [deliveryType, setDeliveryType] = useState<DeliveryType | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [seeded, setSeeded] = useState(false)

  // Продолжение существующего черновика (§8): подгружаем и стартуем сразу с формы.
  const draftQ = useQuery({
    queryKey: applicationKeys.detail(initialDraftId ?? ''),
    queryFn: () => fetchApplication(initialDraftId!),
    enabled: !!initialDraftId && !seeded,
  })
  useEffect(() => {
    if (!initialDraftId || seeded || !draftQ.data) return
    const a = draftQ.data
    setServiceId(a.service.id)
    setDraftId(a.id)
    setDeliveryType(a.deliveryType)
    setFormData((a.formData as Record<string, unknown>) ?? {})
    setStep('form')
    setSeeded(true)
  }, [initialDraftId, seeded, draftQ.data])

  const catalogQ = useQuery({ queryKey: applicationKeys.categories(), queryFn: fetchCategories })
  const serviceQ = useQuery({
    queryKey: applicationKeys.service(serviceId ?? ''),
    queryFn: () => fetchService(serviceId!),
    enabled: !!serviceId,
  })
  const service = serviceQ.data

  const createMut = useMutation({
    mutationFn: (id: string) => createDraftRequest(id),
    onSuccess: (app) => {
      setDraftId(app.id)
      setStep('form')
    },
    onError: () => toast.error(t('loadError')),
  })
  const saveMut = useMutation({
    mutationFn: () =>
      updateDraftRequest(draftId!, { deliveryType: deliveryType ?? undefined, formData }),
    onError: () => toast.error(t('loadError')),
  })
  const submitMut = useMutation({
    mutationFn: async () => {
      await updateDraftRequest(draftId!, { deliveryType: deliveryType ?? undefined, formData })
      return submitApplicationRequest(draftId!)
    },
    onSuccess: (app) => {
      void qc.invalidateQueries({ queryKey: applicationKeys.all })
      toast.success(t('submittedToast', { number: app.number ?? '' }))
      onDone(app.id)
    },
    onError: () => toast.error(t('loadError')),
  })

  const deliveryOptions = useMemo(
    () => (service ? allowedDeliveryTypes(service.deliveryModes) : []),
    [service],
  )

  const missingRequired = useMemo(() => {
    if (!service) return true
    if (!deliveryType) return true
    return service.formFields.some((f) => {
      if (!f.required) return false
      const v = formData[f.code]
      return v === undefined || v === null || v === ''
    })
  }, [service, deliveryType, formData])

  // Режим правки черновика: пока подгружается — скелетон.
  if (initialDraftId && !seeded) {
    return (
      <Wrapper title="" onBack={onCancel}>
        <SkeletonList />
      </Wrapper>
    )
  }

  // ── Каталог ────────────────────────────────────────────────────────────────
  if (step === 'catalog') {
    return (
      <Wrapper title={t('catalogTitle')} onBack={onCancel}>
        {catalogQ.isLoading ? (
          <SkeletonList />
        ) : catalogQ.isError ? (
          <ErrorState onRetry={() => catalogQ.refetch()} />
        ) : !catalogQ.data?.length ? (
          <EmptyState icon={<FileText className="size-6" aria-hidden />} title={t('noServices')} />
        ) : (
          <div className="flex flex-col gap-5">
            {catalogQ.data.map((cat) => (
              <section key={cat.id} className="flex flex-col gap-2">
                <h3 className="px-1 text-sm font-semibold text-muted-foreground">
                  {pickLocale(cat as unknown as Record<string, unknown>, 'name', locale)}
                </h3>
                <div className="flex flex-col gap-2">
                  {cat.services.map((s) => (
                    <Card
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setServiceId(s.id)
                        setStep('info')
                      }}
                      className="cursor-pointer p-4 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/30"
                    >
                      <span className="font-medium">
                        {pickLocale(s as unknown as Record<string, unknown>, 'name', locale)}
                      </span>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Wrapper>
    )
  }

  // ── Информация об услуге ────────────────────────────────────────────────────
  if (step === 'info') {
    return (
      <Wrapper title="" onBack={() => setStep('catalog')}>
        {serviceQ.isLoading || !service ? (
          <SkeletonList />
        ) : (
          <ServiceInfo
            service={service}
            locale={locale}
            onProceed={() => createMut.mutate(service.id)}
            proceeding={createMut.isPending}
          />
        )}
      </Wrapper>
    )
  }

  // ── Форма ───────────────────────────────────────────────────────────────────
  if (step === 'form' && service) {
    return (
      <Wrapper
        title={pickLocale(service as unknown as Record<string, unknown>, 'name', locale)}
        onBack={() => setStep('info')}
      >
        <div className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">{t('deliveryTitle')}</legend>
            {deliveryOptions.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-input p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="delivery"
                  className="size-4 accent-primary"
                  checked={deliveryType === opt}
                  onChange={() => setDeliveryType(opt)}
                />
                <span className="text-sm">{t(`delivery_${opt}`)}</span>
              </label>
            ))}
          </fieldset>

          {service.formFields.length > 0 && (
            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold">{t('formTitle')}</h3>
              {service.formFields.map((f) => (
                <DynamicField
                  key={f.id}
                  field={f}
                  locale={locale}
                  value={formData[f.code]}
                  onChange={(v) => setFormData((prev) => ({ ...prev, [f.code]: v }))}
                  optionalLabel={t('optional')}
                />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="w-full"
              loading={saveMut.isPending}
              onClick={() =>
                saveMut.mutate(undefined, {
                  onSuccess: () => {
                    toast.success(t('draftSaved'))
                    void qc.invalidateQueries({ queryKey: applicationKeys.all })
                    onCancel()
                  },
                })
              }
            >
              {t('saveDraft')}
            </Button>
            <Button className="w-full" disabled={missingRequired} onClick={() => setStep('review')}>
              {t('nextBtn')}
            </Button>
          </div>
        </div>
      </Wrapper>
    )
  }

  // ── Проверка ────────────────────────────────────────────────────────────────
  if (step === 'review' && service) {
    return (
      <Wrapper title={t('reviewTitle')} onBack={() => setStep('form')}>
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <Row
              label={t('title')}
              value={pickLocale(service as unknown as Record<string, unknown>, 'name', locale)}
            />
            {deliveryType && (
              <Row label={t('deliveryTitle')} value={t(`delivery_${deliveryType}`)} />
            )}
            {service.formFields.map((f) => {
              const v = formData[f.code]
              if (v === undefined || v === null || v === '') return null
              return (
                <Row
                  key={f.id}
                  label={pickLocale(f as unknown as Record<string, unknown>, 'label', locale)}
                  value={String(v)}
                />
              )
            })}
          </Card>
          <Button
            className="w-full"
            loading={submitMut.isPending}
            onClick={() => submitMut.mutate()}
          >
            {t('submitApplication')}
          </Button>
        </div>
      </Wrapper>
    )
  }

  return null
}

// ── Вспомогательные ───────────────────────────────────────────────────────────
function Wrapper({
  title,
  onBack,
  children,
}: {
  title: string
  onBack: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="back">
          <ArrowLeft className="size-5" aria-hidden />
        </Button>
        {title && <h2 className="truncate text-lg font-semibold">{title}</h2>}
      </div>
      {children}
    </div>
  )
}

function ServiceInfo({
  service,
  locale,
  onProceed,
  proceeding,
}: {
  service: ServiceDetail
  locale: string
  onProceed: () => void
  proceeding: boolean
}) {
  const t = useTranslations('Applications')
  const rec = service as unknown as Record<string, unknown>
  const desc = pickLocale(rec, 'description', locale)
  const hours = service.slaHours
  const sla =
    hours % 24 === 0 ? t('daysShort', { count: hours / 24 }) : t('hoursShort', { count: hours })
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold">{pickLocale(rec, 'name', locale)}</h2>
        {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
      </div>
      <Card className="flex items-center gap-2 p-3 text-sm">
        <Clock className="size-4 text-muted-foreground" aria-hidden />
        {t('slaLabel')}: <span className="font-medium">{sla}</span>
      </Card>
      {service.requirements.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t('requirementsTitle')}</h3>
          <ul className="flex flex-col gap-1.5">
            {service.requirements.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <Check className="size-4 shrink-0 text-primary" aria-hidden />
                {pickLocale(r as unknown as Record<string, unknown>, 'title', locale)}
                {!r.required && (
                  <span className="text-xs text-muted-foreground">({t('optional')})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button className="w-full" loading={proceeding} onClick={onProceed}>
        {t('createApplication')}
      </Button>
    </div>
  )
}

function DynamicField({
  field,
  locale,
  value,
  onChange,
  optionalLabel,
}: {
  field: ServiceFormField
  locale: string
  value: unknown
  onChange: (v: unknown) => void
  optionalLabel: string
}) {
  const rec = field as unknown as Record<string, unknown>
  const label = pickLocale(rec, 'label', locale)
  const placeholder = pickLocale(rec, 'placeholder', locale)
  const id = `field-${field.code}`
  const common = { id, placeholder, 'aria-required': field.required }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {label}
        {!field.required && (
          <span className="ml-1 text-xs text-muted-foreground">({optionalLabel})</span>
        )}
      </Label>
      {field.type === 'TEXTAREA' ? (
        <Textarea
          {...common}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === 'SELECT' || field.type === 'RADIO' ? (
        <select
          id={id}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="" disabled>
            —
          </option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {pickLocale(o as unknown as Record<string, unknown>, 'label', locale) || o.value}
            </option>
          ))}
        </select>
      ) : field.type === 'BOOLEAN' || field.type === 'CHECKBOX' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {placeholder || label}
        </label>
      ) : (
        <Input
          {...common}
          type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('Applications')
  return (
    <EmptyState
      icon={<FileText className="size-6" aria-hidden />}
      title={t('loadError')}
      action={
        <Button variant="outline" onClick={onRetry}>
          {t('retry')}
        </Button>
      }
    />
  )
}
