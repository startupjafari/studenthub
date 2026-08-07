'use client'

import { useState, type ChangeEvent } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, ShieldAlert, Upload, X } from 'lucide-react'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import { RegisterByInviteSchema, type RegisterByInviteInput } from '@studenthub/shared-schemas'
import { Badge, Button, FormAlert, Input, Label } from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { previewInviteRequest, registerByInviteRequest } from '../../../shared/api'
import { uploadAvatarRequest } from '../../../entities/user'
import { establishSession } from '../../../shared/session'
import { ROLE_HOME } from '../../../shared/config'

// Надёжность пароля по критериям политики (docs/BACKEND_RULES.md §3): 0..4.
function passwordScore(pw: string): number {
  let score = 0
  if (pw.length >= 8) score++
  if (/[A-Za-zА-Яа-я]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-zА-Яа-я0-9]/.test(pw)) score++
  return score
}

const STRENGTH = [
  { key: 'weak', bar: 'bg-destructive', text: 'text-destructive' },
  { key: 'weak', bar: 'bg-destructive', text: 'text-destructive' },
  { key: 'fair', bar: 'bg-warning', text: 'text-warning' },
  { key: 'good', bar: 'bg-info', text: 'text-info' },
  { key: 'strong', bar: 'bg-success', text: 'text-success' },
] as const

const AVATAR_MAX = FILE_UPLOAD.MAX_BYTES.IMAGE
const AVATAR_MIMES = FILE_UPLOAD.ALLOWED_MIME.IMAGE as readonly string[]

export function RegisterByInviteForm({ token }: { token: string }) {
  const t = useTranslations('Auth')
  const tRoles = useTranslations('Roles')
  const tCommon = useTranslations('Common')
  const tStrength = useTranslations('Auth.passwordStrength')
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const preview = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => previewInviteRequest(token),
    retry: false,
    enabled: token.length > 0,
  })

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterByInviteInput>({
    resolver: zodResolver(RegisterByInviteSchema),
    defaultValues: { token },
  })

  const password = watch('password') ?? ''
  const score = passwordScore(password)
  const strength = STRENGTH[score] ?? STRENGTH[0]

  function pickAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!AVATAR_MIMES.includes(file.type)) {
      setAvatarError(t('avatarInvalid'))
      return
    }
    if (file.size > AVATAR_MAX) {
      setAvatarError(t('avatarTooLarge'))
      return
    }
    if (avatarUrl) URL.revokeObjectURL(avatarUrl)
    setAvatarError(null)
    setAvatarFile(file)
    setAvatarUrl(URL.createObjectURL(file))
  }

  function removeAvatar() {
    if (avatarUrl) URL.revokeObjectURL(avatarUrl)
    setAvatarFile(null)
    setAvatarUrl(null)
    setAvatarError(null)
  }

  async function onSubmit(values: RegisterByInviteInput) {
    resetApiError()
    try {
      const accessToken = await registerByInviteRequest(values)
      const role = await establishSession(accessToken)
      // Аватар грузим уже авторизованным запросом; его сбой не блокирует вход.
      if (avatarFile) {
        try {
          await uploadAvatarRequest(avatarFile)
        } catch {
          toast.error(t('avatarUploadFailed'))
        }
      }
      router.replace(ROLE_HOME[role])
    } catch (err) {
      // Серверные ошибки (в т.ч. VALIDATION_ERROR с details[]) — в Alert над формой (§5.4/§7).
      showApiError(err)
    }
  }

  // Приглашение отсутствует/недействительно — заглушка с возвратом на главную.
  if (!token || preview.isError) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="size-7" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">{t('inviteInvalidTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('inviteInvalidText')}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/login">{t('backToHome')}</Link>
        </Button>
      </div>
    )
  }

  if (preview.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {tCommon('loading')}
      </div>
    )
  }

  const scopeBadges: string[] = []
  if (preview.data?.universityId) scopeBadges.push(t('scopeUniversity'))
  if (preview.data?.facultyId) scopeBadges.push(t('scopeFaculty'))
  if (preview.data?.groupId) scopeBadges.push(t('scopeGroup'))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">{t('createAccountTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('createAccountSubtitle')}</p>
      </div>

      {preview.data && (
        <div className="flex flex-wrap gap-2">
          <Badge>{tRoles(preview.data.role)}</Badge>
          {scopeBadges.map((label) => (
            <Badge key={label} variant="secondary">
              {label}
            </Badge>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <input type="hidden" {...register('token')} />
        <FormAlert error={apiError} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="firstName">{t('firstName')}</Label>
            <Input id="firstName" autoComplete="given-name" {...register('firstName')} />
            {errors.firstName && (
              <p className="text-xs text-destructive">{errors.firstName.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="lastName">{t('lastName')}</Label>
            <Input id="lastName" autoComplete="family-name" {...register('lastName')} />
            {errors.lastName && (
              <p className="text-xs text-destructive">{errors.lastName.message}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">{t('password')}</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
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
          {password.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full ${i < score ? strength.bar : 'bg-muted'}`}
                  />
                ))}
              </div>
              <p className={`text-xs ${strength.text}`}>
                {t('passwordStrengthLabel')}: {tStrength(strength.key)}
              </p>
            </div>
          )}
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <Label>
            {t('avatarLabel')}{' '}
            <span className="font-normal text-muted-foreground">({t('avatarOptional')})</span>
          </Label>
          {avatarUrl ? (
            <div className="flex items-center gap-3">
              <Image
                src={avatarUrl}
                alt={t('avatarLabel')}
                width={56}
                height={56}
                unoptimized
                className="size-14 rounded-full object-cover"
              />
              <Button type="button" variant="ghost" size="sm" onClick={removeAvatar}>
                <X className="size-4" aria-hidden />
                {t('avatarRemove')}
              </Button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input p-5 text-center text-muted-foreground transition-colors hover:border-ring hover:text-foreground">
              <Upload className="size-5" aria-hidden />
              <span className="text-xs">{t('avatarHint')}</span>
              <input
                type="file"
                accept={AVATAR_MIMES.join(',')}
                className="sr-only"
                onChange={pickAvatar}
              />
            </label>
          )}
          {avatarError && <p className="text-xs text-destructive">{avatarError}</p>}
        </div>

        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
          {t('createAccount')}
        </Button>

        <p className="text-center text-xs text-muted-foreground">{t('oneTimeTokenNote')}</p>
      </form>
    </div>
  )
}
