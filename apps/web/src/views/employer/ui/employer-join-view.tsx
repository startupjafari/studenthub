'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { CircleX, UsersRound } from 'lucide-react'
import {
  AcceptCompanyInviteSchema,
  type AcceptCompanyInviteInput,
} from '@studenthub/shared-schemas'
import { acceptCompanyInvite, companyKeys, previewCompanyInvite } from '../../../entities/company'
import { Button, FieldError, FormAlert, Input, Label, PageLoader } from '../../../shared/ui'
import { toApiError, useFormAlert } from '../../../shared/lib'
import { establishSession } from '../../../shared/session'
import { ROLE_HOME } from '../../../shared/config'

/**
 * Приём приглашения в команду компании по ссылке из письма (21.D2).
 *
 * Почта и компания — из приглашения: форма спрашивает только имя и пароль, как регистрация
 * по инвайту вуза. После регистрации — сразу в кабинет работодателя, без отдельного входа.
 */
export function EmployerJoinView({ token }: { token: string }) {
  const t = useTranslations('Employer')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const router = useRouter()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const preview = useQuery({
    queryKey: companyKeys.invitePreview(token),
    queryFn: () => previewCompanyInvite(token),
    retry: false,
    enabled: token.length > 0,
  })

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AcceptCompanyInviteInput>({
    resolver: zodResolver(AcceptCompanyInviteSchema),
    defaultValues: { token },
  })

  if (token && preview.isLoading) return <PageLoader label={tCommon('loading')} />

  // Ссылка без токена, недействительная, принятая, отозванная или истёкшая — объясняем
  // причину кодом ошибки и даём уйти ко входу: регистрироваться тут больше нечем.
  if (!token || preview.isError || !preview.data) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <CircleX className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t('joinFailTitle')}</h2>
          <p className="text-sm text-muted-foreground">
            {token ? tErr(toApiError(preview.error).code) : t('verifyNoToken')}
          </p>
        </div>
        <Button asChild variant="ghost">
          <Link href="/login">{t('toLogin')}</Link>
        </Button>
      </div>
    )
  }

  const until = new Date(preview.data.expiresAt).toLocaleString(locale, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UsersRound className="size-5" aria-hidden />
        </span>
        <h2 className="text-2xl font-semibold">
          {t('joinTitle', { company: preview.data.companyName })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('joinSubtitle', { email: preview.data.email, until })}
        </p>
      </div>

      <form
        onSubmit={handleSubmit(async (values) => {
          resetApiError()
          try {
            const accessToken = await acceptCompanyInvite(values)
            const role = await establishSession(accessToken)
            router.replace(ROLE_HOME[role])
          } catch (err) {
            showApiError(err)
          }
        })}
        className="flex flex-col gap-4"
      >
        <FormAlert error={apiError} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="firstName">{t('fieldFirstName')}</Label>
            <Input id="firstName" aria-invalid={!!errors.firstName} {...register('firstName')} />
            <FieldError>{errors.firstName ? t('errFirstName') : null}</FieldError>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="lastName">{t('fieldLastName')}</Label>
            <Input id="lastName" aria-invalid={!!errors.lastName} {...register('lastName')} />
            <FieldError>{errors.lastName ? t('errLastName') : null}</FieldError>
          </div>
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
          <FieldError>{errors.password ? t('errPassword') : null}</FieldError>
        </div>

        <Button type="submit" size="xl" loading={isSubmitting} className="mt-2 w-full">
          {t('joinSubmit')}
        </Button>

        <p className="text-center text-xs text-muted-foreground">{t('joinNote')}</p>
      </form>
    </div>
  )
}
