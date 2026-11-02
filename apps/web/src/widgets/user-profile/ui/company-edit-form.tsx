'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  COMPANY_SIZES,
  UpdateCompanySchema,
  type CompanySize,
  type UpdateCompanyInput,
} from '@studenthub/shared-schemas'
import { companyKeys, updateMyCompany, type Company } from '../../../entities/company'
import {
  Card,
  CardContent,
  FieldError,
  FormAlert,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { ENTER } from './profile-content'

/** Форма отправляется кнопкой «Сохранить» в шапке страницы компании. */
export const COMPANY_EDIT_FORM_ID = 'company-edit-form'

// Пустые текстовые поля — пустые строки: так поле можно очистить (схема переводит '' в null).
function toFormValues(c: Company): UpdateCompanyInput {
  return {
    name: c.name,
    description: c.description ?? '',
    website: c.website ?? '',
    city: c.city ?? '',
    industry: c.industry ?? '',
    size: c.size ?? undefined,
    foundedYear: c.foundedYear ?? undefined,
    contactEmail: c.contactEmail ?? '',
    contactPhone: c.contactPhone ?? '',
    address: c.address ?? '',
    telegram: c.telegram ?? '',
    instagram: c.instagram ?? '',
    linkedin: c.linkedin ?? '',
  }
}

/** Правка профиля компании (только владелец; сервер проверяет это сам — assertOwner). */
export function CompanyEditForm({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const t = useTranslations('Company')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateCompanyInput>({
    resolver: zodResolver(UpdateCompanySchema),
    defaultValues: toFormValues(company),
  })

  const sizeLabels: Record<CompanySize, string> = {
    '1_10': t('size1to10'),
    '11_50': t('size11to50'),
    '51_200': t('size51to200'),
    '201_1000': t('size201to1000'),
    '1000_PLUS': t('size1000plus'),
  }

  const save = useMutation({
    mutationFn: updateMyCompany,
    onMutate: resetApiError,
    onSuccess: (updated) => {
      qc.setQueryData(companyKeys.mine(), updated)
      void qc.invalidateQueries({ queryKey: companyKeys.page(company.id) })
      toast.success(t('saved'))
      onSaved()
    },
    onError: showApiError,
  })

  const field = (
    name: keyof UpdateCompanyInput,
    label: string,
    error: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`company-${name}`}>{label}</Label>
      <Input id={`company-${name}`} aria-invalid={!!errors[name]} {...props} {...register(name)} />
      <FieldError>{errors[name] ? error : null}</FieldError>
    </div>
  )

  return (
    <Card className={ENTER}>
      <CardContent>
        <form
          id={COMPANY_EDIT_FORM_ID}
          // Кнопка «Сохранить» — в шапке, вне fieldset: повторное нажатие гасим здесь.
          onSubmit={handleSubmit((values) => {
            if (!save.isPending) save.mutate(values)
          })}
          className="flex flex-col gap-6"
        >
          <FormAlert error={apiError} />
          {/* Пока запрос в пути, форма заблокирована: повторное нажатие не отправит дубль. */}
          <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-6">
            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold">{t('about')}</h2>
              {field('name', t('fieldName'), t('errName'))}
              <div className="flex flex-col gap-2">
                <Label htmlFor="company-description">{t('fieldDescription')}</Label>
                <Textarea id="company-description" rows={5} {...register('description')} />
                <FieldError>{errors.description ? t('errDescription') : null}</FieldError>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {field('industry', t('fieldIndustry'), t('errText'))}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="company-size">{t('fieldSize')}</Label>
                  <Controller
                    control={control}
                    name="size"
                    render={({ field: f }) => (
                      <Select
                        value={(f.value as string | null | undefined) || undefined}
                        onValueChange={f.onChange}
                      >
                        <SelectTrigger id="company-size" size="md" className="w-full">
                          <SelectValue placeholder={t('sizeNone')} />
                        </SelectTrigger>
                        <SelectContent>
                          {COMPANY_SIZES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {sizeLabels[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                {field('foundedYear', t('fieldFounded'), t('errYear'), {
                  inputMode: 'numeric',
                  placeholder: '2015',
                })}
              </div>
            </section>

            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold">{t('location')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {field('city', t('fieldCity'), t('errCity'))}
                {field('address', t('fieldAddress'), t('errText'))}
              </div>
            </section>

            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold">{t('contacts')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {field('website', t('fieldWebsite'), t('errWebsite'), { placeholder: 'https://' })}
                {field('contactEmail', t('fieldContactEmail'), t('errEmail'), {
                  type: 'email',
                  autoComplete: 'email',
                })}
                {field('contactPhone', t('fieldContactPhone'), t('errPhone'), {
                  type: 'tel',
                  placeholder: '+7 700 000 00 00',
                })}
                {field('telegram', 'Telegram', t('errTelegram'), { placeholder: '@company' })}
                {field('instagram', 'Instagram', t('errHttps'), {
                  placeholder: 'https://instagram.com/…',
                })}
                {field('linkedin', 'LinkedIn', t('errHttps'), {
                  placeholder: 'https://linkedin.com/company/…',
                })}
              </div>
            </section>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  )
}
