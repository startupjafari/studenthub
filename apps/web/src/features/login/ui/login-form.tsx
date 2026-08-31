'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Eye, EyeOff, QrCode } from 'lucide-react'
import { LoginSchema, type LoginInput } from '@studenthub/shared-schemas'
import { Button, CodeInput, FormAlert, Input, Label, LegalLinks } from '../../../shared/ui'
// safeNextPath — то же правило, что в middleware (защита от открытого редиректа).
import { useFormAlert, safeNextPath } from '../../../shared/lib'
import { loginRequest, loginVerify2faRequest } from '../../../shared/api'
import { establishSession } from '../../../shared/session'
import { ROLE_HOME } from '../../../shared/config'
import { QrLoginPanel } from './qr-login-panel'

export function LoginForm() {
  const t = useTranslations('Auth')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showPassword, setShowPassword] = useState(false)
  const [mode, setMode] = useState<'password' | 'qr'>('password')
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
    // ?next= проставляет middleware, когда пользователь пришёл по ссылке без сессии
    // (например, отсканировал печатный QR помещения, Ф16). Возвращаем его туда.
    router.replace(safeNextPath(searchParams.get('next')) ?? ROLE_HOME[role])
  }

  async function onSubmit(values: LoginInput) {
    resetApiError()
    try {
      const result = await loginRequest(values.identifier, values.password)
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

  // Шаг рисуем в переменную, а не ранним return: юридические ссылки ниже должны
  // оставаться на экране и на QR-панели, и на вводе кода 2FA.
  let step: ReactNode

  if (mode === 'qr') {
    step = <QrLoginPanel onAuthenticated={completeLogin} onCancel={() => setMode('password')} />
  } else if (challengeToken) {
    step = (
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
  } else {
    step = (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">{t('welcome')}</h2>
          <p className="text-sm text-muted-foreground">{t('welcomeSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormAlert error={apiError} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="identifier">{t('emailOrUsername')}</Label>
            <Input
              id="identifier"
              type="text"
              autoComplete="username"
              placeholder={t('identifierPlaceholder')}
              aria-invalid={!!errors.identifier}
              {...register('identifier')}
            />
            {errors.identifier && (
              <p className="text-xs text-destructive">{errors.identifier.message}</p>
            )}
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
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>

          <Button type="submit" size="xl" loading={isSubmitting} className="mt-2 w-full">
            {t('signIn')}
          </Button>

          <div className="relative my-1 flex items-center">
            <span className="h-px flex-1 bg-border" />
            <span className="px-3 text-xs text-muted-foreground">{t('or')}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            type="button"
            variant="outline"
            size="xl"
            className="w-full"
            onClick={() => setMode('qr')}
          >
            <QrCode className="size-4" aria-hidden />
            {t('qrTab')}
          </Button>
        </form>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {step}
      <LegalLinks />
    </div>
  )
}

// Длины кодов заданы сервером: TOTP — 6 цифр, backup — 8 hex-символов
// (two-factor.service.ts: /^\d{6}$/ → TOTP, иначе сверка с backup-хэшами).
const TOTP_LENGTH = 6
const BACKUP_LENGTH = 8

// Второй шаг входа при включённой 2FA: ввод 6-значного кода из приложения или backup-кода.
// Ввод сегментированный (пин-код), поэтому у двух форматов кода — два режима: длина
// и алфавит ячеек разные, одним полем их не покрыть.
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
  const [backupMode, setBackupMode] = useState(false)
  // Счётчик попыток входит в key поля: после неверного кода поле пересоздаётся,
  // фокус возвращается в первую ячейку — иначе пришлось бы стирать код вручную.
  const [attempt, setAttempt] = useState(0)

  const length = backupMode ? BACKUP_LENGTH : TOTP_LENGTH
  const canSubmit = code.length === length && !verifying

  useEffect(() => {
    if (!apiError) return
    setCode('')
    setAttempt((n) => n + 1)
  }, [apiError])

  async function verify(value: string) {
    if (verifying) return
    setVerifying(true)
    try {
      await onVerify(value)
    } finally {
      setVerifying(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    await verify(code)
  }

  function switchMode() {
    setBackupMode((v) => !v)
    setCode('')
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">{t('twoFactorTitle')}</h2>
        <p className="text-sm text-muted-foreground">
          {backupMode ? t('twoFactorBackupPrompt') : t('twoFactorPrompt')}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormAlert error={apiError} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="twoFactorCode">
            {backupMode ? t('twoFactorBackupCodeLabel') : t('twoFactorCodeLabel')}
          </Label>
          <CodeInput
            id="twoFactorCode"
            aria-label={backupMode ? t('twoFactorBackupCodeLabel') : t('twoFactorCodeLabel')}
            value={code}
            onChange={setCode}
            length={length}
            // Полный код отправляем сразу — лишнее нажатие «Подтвердить» не нужно.
            onComplete={verify}
            alphabet={backupMode ? 'hex' : 'numeric'}
            groupSize={backupMode ? 4 : 3}
            disabled={verifying}
            // Красная рамка только пока поле пусто после ошибки: начал вводить — снялась.
            invalid={!!apiError && code.length === 0}
            autoFocus
            // key — чтобы при смене режима и после неверной попытки ячейки
            // пересоздались и фокус встал в первую.
            key={`${backupMode ? 'backup' : 'totp'}-${attempt}`}
          />
          <button
            type="button"
            onClick={switchMode}
            className="cursor-pointer self-center rounded text-center text-xs text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {backupMode ? t('twoFactorUseAppHint') : t('twoFactorBackupHint')}
          </button>
        </div>

        <Button
          type="submit"
          size="xl"
          loading={verifying}
          disabled={!canSubmit}
          className="mt-2 w-full"
        >
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
