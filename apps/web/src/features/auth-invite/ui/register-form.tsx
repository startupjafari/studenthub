'use client'

import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Camera, Eye, EyeOff, Loader2, ShieldAlert, Trash2 } from 'lucide-react'
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

// Кроппер на canvas грузится только при выборе файла: страница регистрации — первый экран
// нового пользователя, тащить его в основной бандл незачем (FRONTEND_RULES §4, §11).
const ImageCropModal = dynamic(
  () => import('../../../shared/ui/image-crop-modal').then((m) => m.ImageCropModal),
  { ssr: false },
)

export function RegisterByInviteForm({ token }: { token: string }) {
  const t = useTranslations('Auth')
  const tRoles = useTranslations('Roles')
  const tCommon = useTranslations('Common')
  const tStrength = useTranslations('Auth.passwordStrength')
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  // Выбранный, но ещё не кадрированный файл — он же признак «открыть кроппер».
  const [cropFile, setCropFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const preview = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => previewInviteRequest(token),
    retry: false,
    enabled: token.length > 0,
  })

  // Инвайт можно выдать без адреса — ссылкой в мессенджер вместо письма. Тогда email
  // спрашиваем здесь: сервер иначе откажет («Для регистрации нужен email»), а поля в
  // форме до этого не было вовсе — регистрация по такой ссылке была невозможна.
  const emailRequired = preview.data?.emailRequired ?? false

  // Схема-SSOT держит email опциональным (у инвайта с адресом поля в форме нет вовсе).
  // Здесь она ужесточается ровно под случай «адреса нет» — через `refine`, а не `extend`:
  // тип выхода остаётся тем же `RegisterByInviteInput`, и resolver не расходится с типом
  // формы. Формат адреса проверяет сама схема, здесь — только «поле не пустое».
  const schema = useMemo(
    () =>
      emailRequired
        ? RegisterByInviteSchema.refine((v) => !!v.email, {
            path: ['email'],
            message: t('emailRequired'),
          })
        : RegisterByInviteSchema,
    [emailRequired, t],
  )

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterByInviteInput>({
    resolver: zodResolver(schema),
    defaultValues: { token },
  })

  const password = watch('password') ?? ''
  const score = passwordScore(password)
  const strength = STRENGTH[score] ?? STRENGTH[0]

  // Инициалы — из уже введённых имени и фамилии: до выбора фото круг показывает человека,
  // а не заглушку. Порядок «фамилия + имя» — тот же, что в профиле (initialsOf).
  const initials = (
    ((watch('lastName') ?? '')[0] ?? '') + ((watch('firstName') ?? '')[0] ?? '')
  ).toUpperCase()

  // Выбор файла ведёт не сразу в превью, а в кроппер: аватар — круг, и кадр решает
  // пользователь, а не случайные пропорции исходника. Ошибки типа/размера — тостом:
  // контрол компактный и стоит в шапке, инлайн-сообщение ломало бы её высоту.
  function pickAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Сброс значения — иначе повторный выбор того же файла не даёт события change.
    e.target.value = ''
    if (!file) return
    if (!AVATAR_MIMES.includes(file.type)) {
      toast.error(t('avatarInvalid'))
      return
    }
    if (file.size > AVATAR_MAX) {
      toast.error(t('avatarTooLarge'))
      return
    }
    setCropFile(file)
  }

  function applyCrop(cropped: File) {
    if (avatarUrl) URL.revokeObjectURL(avatarUrl)
    setAvatarFile(cropped)
    setAvatarUrl(URL.createObjectURL(cropped))
    setCropFile(null)
  }

  function removeAvatar() {
    if (avatarUrl) URL.revokeObjectURL(avatarUrl)
    setAvatarFile(null)
    setAvatarUrl(null)
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
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">{t('createAccountTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('createAccountSubtitle')}</p>
        </div>

        {/* Аватар — в шапке справа, тем же идиомом, что в профиле: круг с инициалами,
            нажатие ведёт в выбор файла и кадрирование, удаление — корзиной на кромке.
            Сама загрузка уходит после регистрации (§7.3, шаг 6): без токена грузить некуда,
            поэтому здесь файл только держится в состоянии. */}
        <div className="group relative size-16 shrink-0 sm:size-20">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={t('avatarLabel')}
              width={160}
              height={160}
              unoptimized
              className="size-full rounded-full border border-border object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground sm:text-2xl">
              {initials || <Camera className="size-6" aria-hidden />}
            </div>
          )}

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label={avatarUrl ? t('avatarChange') : t('avatarAdd')}
            className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/55 text-background opacity-0 outline-none transition-opacity duration-300 ease-out group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
          >
            <Camera className="size-5" aria-hidden />
          </button>

          {/* Значок камеры виден всегда: на тач-устройствах hover-оверлея нет, и без него
              круг читался бы как картинка, а не как кнопка. */}
          <span
            aria-hidden
            className="pointer-events-none absolute -right-0.5 -bottom-0.5 flex size-6 items-center justify-center rounded-full border-2 border-background bg-card text-muted-foreground group-hover:opacity-0"
          >
            <Camera className="size-3.5" />
          </span>

          {avatarUrl && (
            <button
              type="button"
              onClick={removeAvatar}
              aria-label={t('avatarRemove')}
              className="absolute -top-0.5 -left-0.5 flex size-6 items-center justify-center rounded-full border-2 border-background bg-card text-muted-foreground outline-none transition-colors hover:text-destructive focus-visible:text-destructive"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept={AVATAR_MIMES.join(',')}
            className="hidden"
            onChange={pickAvatar}
          />
        </div>
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
          <Label htmlFor="username">{t('username')}</Label>
          <Input
            id="username"
            autoComplete="username"
            placeholder="username"
            aria-invalid={!!errors.username}
            {...register('username')}
          />
          {errors.username ? (
            <p className="text-xs text-destructive">{errors.username.message}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('usernameHint')}</p>
          )}
        </div>

        {emailRequired && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t('email')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="name@example.com"
              aria-invalid={!!errors.email}
              {...register('email')}
            />
            {errors.email ? (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('emailInviteHint')}</p>
            )}
          </div>
        )}

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

        <Button type="submit" size="xl" loading={isSubmitting} className="mt-1 w-full">
          {t('createAccount')}
        </Button>

        <p className="text-center text-xs text-muted-foreground">{t('oneTimeTokenNote')}</p>
      </form>

      {cropFile && (
        <ImageCropModal
          file={cropFile}
          // Здесь ничего не сохраняется на сервер: файл ложится в состояние формы и
          // уходит уже после регистрации, поэтому окно никогда не в состоянии «сохраняю».
          saving={false}
          onCancel={() => setCropFile(null)}
          onSave={applyCrop}
        />
      )}
    </div>
  )
}
