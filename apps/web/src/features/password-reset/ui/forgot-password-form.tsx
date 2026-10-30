'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { MailCheck } from 'lucide-react'
import { ForgotPasswordSchema, type ForgotPasswordInput } from '@studenthub/shared-schemas'
import { Button, FormAlert, Input, Label, FieldError } from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { forgotPasswordRequest } from '../../../shared/api'

// «Забыли пароль»: адрес → письмо со ссылкой. Экран после отправки говорит «если адрес
// зарегистрирован»: сервер отвечает одинаково для любого адреса, и обещать письмо мы не можем.
export function ForgotPasswordForm() {
  const t = useTranslations('Auth')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(ForgotPasswordSchema) })

  if (sentTo) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t('forgotSentTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('forgotSentText', { email: sentTo })}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/login">{t('backToLogin')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">{t('forgotTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('forgotSubtitle')}</p>
      </div>

      <form
        noValidate
        onSubmit={handleSubmit(async (values) => {
          resetApiError()
          try {
            await forgotPasswordRequest(values.email)
            setSentTo(values.email)
          } catch (err) {
            showApiError(err)
          }
        })}
        className="flex flex-col gap-4"
      >
        <FormAlert error={apiError} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">{t('email')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            aria-invalid={!!errors.email}
            {...register('email')}
          />
          <FieldError>{errors.email && t('emailInvalid')}</FieldError>
        </div>
        <Button type="submit" loading={isSubmitting}>
          {t('forgotSubmit')}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/login">{t('backToLogin')}</Link>
        </Button>
      </form>
    </div>
  )
}
