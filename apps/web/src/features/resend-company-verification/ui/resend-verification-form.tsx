'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  ResendCompanyVerificationSchema,
  type ResendCompanyVerificationInput,
} from '@studenthub/shared-schemas'
import { resendCompanyVerification } from '../../../entities/company'
import { Button, FieldError, Input, Label } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

// Новая ссылка по адресу — для страницы из письма, когда ссылка истекла или потерялась:
// адрес там неизвестен, токен его не раскрывает.
export function ResendVerificationForm() {
  const t = useTranslations('Employer')
  const tErr = useTranslations('Errors')
  const form = useForm<ResendCompanyVerificationInput>({
    resolver: zodResolver(ResendCompanyVerificationSchema),
  })
  const resend = useMutation({
    mutationFn: (values: ResendCompanyVerificationInput) => resendCompanyVerification(values.email),
  })

  if (resend.isSuccess) {
    // Ответ сервера одинаков для любого адреса, поэтому и текст осторожный: «если…».
    return <p className="text-sm text-muted-foreground">{t('resendMaybeSent')}</p>
  }

  return (
    <form
      onSubmit={form.handleSubmit((values) => resend.mutate(values))}
      className="flex w-full flex-col gap-3 text-left"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="resend-email">{t('resendEmailLabel')}</Label>
        <Input
          id="resend-email"
          type="email"
          autoComplete="email"
          aria-invalid={!!form.formState.errors.email}
          {...form.register('email')}
        />
        <FieldError>{form.formState.errors.email ? t('resendEmailInvalid') : null}</FieldError>
        {resend.isError && <FieldError>{tErr(toApiError(resend.error).code)}</FieldError>}
      </div>
      <Button type="submit" variant="outline" loading={resend.isPending}>
        {t('resend')}
      </Button>
    </form>
  )
}
