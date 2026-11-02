'use client'

import { Controller, useForm } from 'react-hook-form'
import type { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  COMPANY_SIZES,
  UpdateCompanySchema,
  type UpdateCompanyInput,
} from '@studenthub/shared-schemas'
import { companyKeys, updateMyCompany, type Company } from '../../../entities/company'
import { KatoSelect } from '../../../entities/kato'
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
  toKzPhone,
} from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { ENTER } from './profile-content'
import { OrgPageFieldsForm } from './org-page-fields'
import { useCompanySizeLabel } from './company-size-label'

/** Значения полей до разбора схемой: пустая строка — «очистить поле». */
type CompanyFormValues = z.input<typeof UpdateCompanySchema>

/** Форма отправляется кнопкой «Сохранить» в шапке страницы компании. */
export const COMPANY_EDIT_FORM_ID = 'company-edit-form'

// Пустые текстовые поля — пустые строки: так поле можно очистить (схема переводит '' в null).
function toFormValues(c: Company): CompanyFormValues {
  return {
    name: c.name,
    description: c.description ?? '',
    website: c.website ?? '',
    city: c.city ?? '',
    industry: c.industry ?? '',
    size: c.size ?? undefined,
    foundedYear: c.foundedYear ?? undefined,
    contactEmail: c.contactEmail ?? '',
    // Номер, сохранённый до маски, приводится к её виду — иначе маска его исказит.
    contactPhone: toKzPhone(c.contactPhone),
    address: c.address ?? '',
    telegram: c.telegram ?? '',
    instagram: c.instagram ?? '',
    linkedin: c.linkedin ?? '',
  }
}

/** Правка профиля компании (только владелец; сервер проверяет это сам — assertOwner). */
export function CompanyEditForm({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const t = useTranslations('Company')
  const tOrg = useTranslations('OrgPage')
  const qc = useQueryClient()
  const sizeLabel = useCompanySizeLabel()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CompanyFormValues, unknown, UpdateCompanyInput>({
    resolver: zodResolver(UpdateCompanySchema),
    defaultValues: toFormValues(company),
  })

  const save = useMutation({
    mutationFn: updateMyCompany,
    onMutate: resetApiError,
    onSuccess: (updated) => {
      qc.setQueryData(companyKeys.mine(), updated)
      void qc.invalidateQueries({ queryKey: companyKeys.page(company.id) })
      toast.success(tOrg('saved'))
      onSaved()
    },
    onError: showApiError,
  })

  const own = (name: 'name' | 'industry', label: string, error: string) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`company-${name}`}>{label}</Label>
      <Input id={`company-${name}`} aria-invalid={!!errors[name]} {...register(name)} />
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
            <OrgPageFieldsForm
              aboutTitle={t('about')}
              linkedinKind="company"
              binding={{
                register,
                hasError: (name) => !!errors[name],
                controlled: (name, render) => (
                  <Controller
                    control={control}
                    name={name}
                    render={({ field: f }) => (
                      <>{render({ value: f.value, onChange: f.onChange, onBlur: f.onBlur })}</>
                    )}
                  />
                ),
              }}
              before={
                <>
                  {own('name', t('fieldName'), t('errName'))}
                  <div className="grid gap-4 sm:grid-cols-3">
                    {own('industry', t('fieldIndustry'), tOrg('errText'))}
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
                                  {sizeLabel(s)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                    {/* Город — из справочника КАТО: свободный текст дал бы три разных «Астаны». */}
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="company-city">{t('fieldCity')}</Label>
                      <Controller
                        control={control}
                        name="city"
                        render={({ field: f }) => (
                          <KatoSelect
                            id="company-city"
                            value={(f.value as string | null | undefined) ?? ''}
                            onChange={f.onChange}
                            allowCustom={false}
                          />
                        )}
                      />
                      <FieldError>{errors.city ? t('errCity') : null}</FieldError>
                    </div>
                  </div>
                </>
              }
            />
          </fieldset>
        </form>
      </CardContent>
    </Card>
  )
}
