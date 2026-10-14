'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { CircleCheck, CircleX, Eye, EyeOff } from 'lucide-react'
import { ResetPasswordSchema, type ResetPasswordInput } from '@studenthub/shared-schemas'
import { Button, FormAlert, Input, Label } from '../../../shared/ui'
import { toApiError, useFormAlert } from '../../../shared/lib'
import { resetPasswordRequest } from '../../../shared/api'

interface ResetPasswordFormProps {
  /** Токен из ссылки в письме (?token=). */
  token: string
}

// Новый пароль по ссылке из письма. Сессию сброс не выдаёт: после него гаснут все сессии,
// и человек входит сам — с 2FA, если она включена.
export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const t = useTranslations('Auth')
  const [showPassword, setShowPassword] = useState(false)
  const [state, setState] = useState<'form' | 'done' | 'invalid'>(token ? 'form' : 'invalid')
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(ResetPasswordSchema),
    defaultValues: { token },
  })

  if (state !== 'form') {
    const ok = state === 'done'
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span
          className={
            ok
              ? 'flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary'
              : 'flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive'
          }
        >
          {ok ? (
            <CircleCheck className="size-6" aria-hidden />
          ) : (
            <CircleX className="size-6" aria-hidden />
          )}
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">
            {ok ? t('resetDoneTitle') : t('resetInvalidTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {ok ? t('resetDoneText') : t('resetInvalidText')}
          </p>
        </div>
        {ok ? (
          <Button asChild>
            <Link href="/login">{t('backToLogin')}</Link>
          </Button>
        ) : (
          <Button asChild>
            <Link href="/forgot-password">{t('resetRequestAgain')}</Link>
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">{t('resetTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('resetSubtitle')}</p>
      </div>

      <form
        noValidate
        onSubmit={handleSubmit(async (values) => {
          resetApiError()
          try {
            await resetPasswordRequest(values.token, values.password)
            setState('done')
          } catch (err) {
            // Неизвестная, использованная и истёкшая ссылка сервер различать не даёт —
            // всё это BAD_REQUEST, и на всё один выход: запросить новую.
            if (toApiError(err).code === 'BAD_REQUEST') setState('invalid')
            else showApiError(err)
          }
        })}
        className="flex flex-col gap-4"
      >
        <FormAlert error={apiError} />
        <input type="hidden" {...register('token')} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">{t('newPassword')}</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              className="pr-10"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
              className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
            >
              {showPassword ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
            </button>
          </div>
          {/* Сообщения политики пароля — из общей схемы, как и на форме регистрации. */}
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>
        <Button type="submit" loading={isSubmitting}>
          {t('resetSubmit')}
        </Button>
      </form>
    </div>
  )
}
