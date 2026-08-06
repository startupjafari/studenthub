'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Eye, EyeOff } from 'lucide-react'
import { LoginSchema, type LoginInput } from '@studenthub/shared-schemas'
import { Button, Input, Label } from '../../../shared/ui'
import { loginRequest } from '../../../shared/api'
import { establishSession } from '../../../shared/session'
import { ROLE_HOME } from '../../../shared/config'

export function LoginForm() {
  const t = useTranslations('Auth')
  const tErr = useTranslations('Errors')
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginSchema) })

  async function onSubmit(values: LoginInput) {
    try {
      const token = await loginRequest(values.email, values.password)
      const role = await establishSession(token)
      router.replace(ROLE_HOME[role])
    } catch (err) {
      // Серверные ошибки (401/429/500) — тостом справа внизу; полевые zod — под полями (§7).
      toast.error(tErr((err as { code?: string }).code ?? 'INTERNAL_ERROR'))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">{t('welcome')}</h2>
        <p className="text-sm text-muted-foreground">{t('welcomeSubtitle')}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">{t('email')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={!!errors.email}
            {...register('email')}
          />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t('password')}</Label>
            <button
              type="button"
              onClick={() => toast.info(t('forgotSoon'))}
              className="cursor-pointer rounded text-xs font-medium text-primary underline-offset-4 transition-colors outline-none hover:text-primary/70 hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              {t('forgotPassword')}
            </button>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
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
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>

        <Button type="submit" size="lg" loading={isSubmitting} className="mt-2 w-full">
          {t('signIn')}
        </Button>
      </form>
    </div>
  )
}
