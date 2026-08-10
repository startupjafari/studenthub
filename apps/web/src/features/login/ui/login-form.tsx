'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Eye, EyeOff } from 'lucide-react'
import { LoginSchema, type LoginInput } from '@studenthub/shared-schemas'
import { Button, FormAlert, Input, Label } from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { loginRequest, loginVerify2faRequest } from '../../../shared/api'
import { establishSession } from '../../../shared/session'
import { ROLE_HOME } from '../../../shared/config'

export function LoginForm() {
  const t = useTranslations('Auth')
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  // Если у пользователя включена 2FA — после пароля храним challenge и показываем ввод кода.
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginSchema) })

  async function completeLogin(token: string) {
    const role = await establishSession(token)
    router.replace(ROLE_HOME[role])
  }

  async function onSubmit(values: LoginInput) {
    resetApiError()
    try {
      const result = await loginRequest(values.email, values.password)
      if ('twoFactorRequired' in result) {
        setChallengeToken(result.challengeToken)
        return
      }
      await completeLogin(result.accessToken)
    } catch (err) {
      // Серверные ошибки (в т.ч. VALIDATION_ERROR с details[]) — в Alert над формой (§5.4/§7).
      showApiError(err)
    }
  }

  if (challengeToken) {
    return (
      <TwoFactorStep
        onBack={() => {
          resetApiError()
          setChallengeToken(null)
        }}
        onVerify={async (code) => {
          resetApiError()
          try {
            const token = await loginVerify2faRequest(challengeToken, code)
            await completeLogin(token)
          } catch (err) {
            showApiError(err)
          }
        }}
        apiError={apiError}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">{t('welcome')}</h2>
        <p className="text-sm text-muted-foreground">{t('welcomeSubtitle')}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormAlert error={apiError} />
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

// Второй шаг входа при включённой 2FA: ввод 6-значного кода из приложения или backup-кода.
function TwoFactorStep({
  onVerify,
  onBack,
  apiError,
}: {
  onVerify: (code: string) => Promise<void>
  onBack: () => void
  apiError: React.ComponentProps<typeof FormAlert>['error']
}) {
  const t = useTranslations('Auth')
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim() || verifying) return
    setVerifying(true)
    try {
      await onVerify(code.trim())
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">{t('twoFactorTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('twoFactorPrompt')}</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormAlert error={apiError} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="twoFactorCode">{t('twoFactorCodeLabel')}</Label>
          <Input
            id="twoFactorCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('twoFactorBackupHint')}</p>
        </div>

        <Button type="submit" size="lg" loading={verifying} className="mt-2 w-full">
          {t('twoFactorVerify')}
        </Button>
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer rounded text-sm font-medium text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          {t('twoFactorBack')}
        </button>
      </form>
    </div>
  )
}
