'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { UpdateCompanySchema, type UpdateCompanyInput } from '@studenthub/shared-schemas'
import { companyKeys, fetchMyCompany, updateMyCompany } from '../../../entities/company'
import {
  Button,
  FormAlert,
  Input,
  Label,
  PageHeader,
  PageLoader,
  Textarea,
  FieldError,
} from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'

// Профиль компании: то, что увидит студент в карточке вакансии.
export function EmployerCompanyView() {
  const t = useTranslations('Employer')
  const tCommon = useTranslations('Common')
  const queryClient = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const company = useQuery({ queryKey: companyKeys.mine(), queryFn: fetchMyCompany })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<UpdateCompanyInput>({ resolver: zodResolver(UpdateCompanySchema) })

  // Форма заполняется, когда приедет компания: значения по умолчанию на первом рендере
  // ещё неизвестны.
  useEffect(() => {
    if (!company.data) return
    reset({
      name: company.data.name,
      description: company.data.description ?? undefined,
      website: company.data.website ?? undefined,
      city: company.data.city ?? undefined,
    })
  }, [company.data, reset])

  const save = useMutation({
    mutationFn: (values: UpdateCompanyInput) => updateMyCompany(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(companyKeys.mine(), updated)
      reset({
        name: updated.name,
        description: updated.description ?? undefined,
        website: updated.website ?? undefined,
        city: updated.city ?? undefined,
      })
      toast.success(t('saved'))
    },
    onError: showApiError,
  })

  if (company.isLoading) return <PageLoader label={tCommon('loading')} />

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={t('companyTitle')} subtitle={t('companyFormHint')} />

      <form
        onSubmit={handleSubmit((values) => {
          resetApiError()
          save.mutate(values)
        })}
        className="flex max-w-2xl flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6"
      >
        <FormAlert error={apiError} />

        <div className="flex flex-col gap-2">
          <Label htmlFor="name">{t('fieldName')}</Label>
          <Input id="name" aria-invalid={!!errors.name} {...register('name')} />
          <FieldError>{errors.name && errors.name.message}</FieldError>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="description">{t('fieldDescription')}</Label>
          <Textarea id="description" rows={5} {...register('description')} />
          <FieldError>{errors.description && errors.description.message}</FieldError>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="website">{t('fieldWebsite')}</Label>
            <Input id="website" placeholder="https://" {...register('website')} />
            <FieldError>{errors.website && errors.website.message}</FieldError>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="city">{t('fieldCity')}</Label>
            <Input id="city" {...register('city')} />
            <FieldError>{errors.city && errors.city.message}</FieldError>
          </div>
        </div>

        <Button type="submit" className="self-start" loading={save.isPending} disabled={!isDirty}>
          {t('save')}
        </Button>
      </form>
    </div>
  )
}
