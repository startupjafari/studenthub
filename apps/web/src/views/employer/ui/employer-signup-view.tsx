'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { MailCheck } from 'lucide-react'
import { EmployerSignupSchema, type EmployerSignupInput } from '@studenthub/shared-schemas'
import { employerSignup } from '../../../entities/company'
import { Button, FormAlert, Input, Label, FieldError } from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { ResendVerificationButton } from '../../../features/resend-company-verification'

/**
 * Публичная регистрация работодателя — единственный вход на платформу без приглашения.
 *
 * Форма честно говорит, что будет дальше: подтверждение почты, заявка в вуз, решение вуза.
 * Без этого человек ждёт мгновенного доступа к студентам и считает продукт сломанным.
 */
export function EmployerSignupView() {
  const t = useTranslations('Employer')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmployerSignupInput>({ resolver: zodResolver(EmployerSignupSchema) })

  if (sentTo) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t('signupSentTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('signupSentText', { email: sentTo })}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/login">{t('toLogin')}</Link>
          </Button>
          <ResendVerificationButton email={sentTo} variant="ghost" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">{t('signupTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('signupSubtitle')}</p>
      </div>

      <form
        onSubmit={handleSubmit(async (values) => {
          resetApiError()
          try {
            const result = await employerSignup(values)
            setSentTo(result.email)
          } catch (err) {
            showApiError(err)
          }
        })}
        className="flex flex-col gap-4"
      >
        <FormAlert error={apiError} />

        <div className="flex flex-col gap-2">
          <Label htmlFor="companyName">{t('fieldCompanyName')}</Label>
          <Input
            id="companyName"
            aria-invalid={!!errors.companyName}
            {...register('companyName')}
          />
          <FieldError>{errors.companyName && errors.companyName.message}</FieldError>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="firstName">{t('fieldFirstName')}</Label>
            <Input id="firstName" aria-invalid={!!errors.firstName} {...register('firstName')} />
            <FieldError>{errors.firstName && errors.firstName.message}</FieldError>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="lastName">{t('fieldLastName')}</Label>
            <Input id="lastName" aria-invalid={!!errors.lastName} {...register('lastName')} />
            <FieldError>{errors.lastName && errors.lastName.message}</FieldError>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">{t('fieldEmail')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...register('email')}
          />
          <FieldError>{errors.email && errors.email.message}</FieldError>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">{t('fieldPassword')}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register('password')}
          />
          <FieldError>{errors.password && errors.password.message}</FieldError>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="website">
            {t('fieldWebsite')} <span className="text-muted-foreground">({t('optional')})</span>
          </Label>
          <Input id="website" placeholder="https://" {...register('website')} />
          <FieldError>{errors.website && errors.website.message}</FieldError>
        </div>

        <Button type="submit" size="xl" loading={isSubmitting} className="mt-2 w-full">
          {t('signupSubmit')}
        </Button>

        <p className="text-center text-xs text-muted-foreground">{t('signupNote')}</p>
      </form>
    </div>
  )
}
