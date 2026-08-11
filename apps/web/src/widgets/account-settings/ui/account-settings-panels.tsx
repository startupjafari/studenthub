'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  Bell,
  Check,
  FolderLock,
  Lock,
  Palette,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import {
  ChangePasswordSchema,
  UpdateProfileSchema,
  PROFILE_VISIBILITY,
  type ChangePasswordInput,
  type UpdateProfileInput,
  type ProfileVisibilityValue,
} from '@studenthub/shared-schemas'
import type { MeResponse } from '../../../shared/api'
import { setup2faRequest, enable2faRequest, disable2faRequest } from '../../../shared/api'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DictSingleSelect,
  Flag,
  FormAlert,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  type FlagCode,
} from '../../../shared/ui'
import { MARITAL_STATUS_DICT } from '../../../shared/config'
import {
  changePasswordRequest,
  deleteAccountRequest,
  fetchMe,
  updateProfileRequest,
  userKeys,
} from '../../../entities/user'
import {
  fetchNotificationSettings,
  notificationKeys,
  updateNotificationSettings,
  type NotificationSettingsData,
} from '../../../entities/notification'
import { endSession } from '../../../shared/session'
import { cn } from '../../../shared/lib/utils'
import { useFormAlert } from '../../../shared/lib'
import { subscribeToPush, unsubscribeFromPush, pushSupported } from '../../../shared/lib/push'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

const NAV: { id: string; labelKey: string; icon: LucideIcon }[] = [
  { id: 'personal', labelKey: 'navPersonal', icon: UserRound },
  { id: 'security', labelKey: 'navSecurity', icon: ShieldCheck },
  { id: 'notifications', labelKey: 'navNotifications', icon: Bell },
  { id: 'appearance', labelKey: 'navAppearance', icon: Palette },
  { id: 'privacy', labelKey: 'navPrivacy', icon: Lock },
  { id: 'danger', labelKey: 'navDanger', icon: ShieldAlert },
]

// Языки интерфейса (эндонимы не переводятся — как в топбаре).
const LOCALES: { value: FlagCode; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'kk', label: 'Қазақша' },
  { value: 'en', label: 'English' },
]

// Панели настроек аккаунта с внутренними табами. Используются и на странице /settings,
// и как вкладка «Настройки» в профиле (widget → widget-инъекция контента через профиль).
export function AccountSettingsPanels() {
  const tS = useTranslations('Settings')
  const tErr = useTranslations('Errors')
  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const [tab, setTab] = useState('personal')

  return (
    <div className="grid w-full items-start gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
      {/* Левая навигация по блокам настроек */}
      <nav
        aria-label={tS('title')}
        className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-muted/40 p-2 lg:flex-col lg:overflow-visible lg:sticky lg:top-6"
      >
        {NAV.map((item) => {
          const Icon = item.icon
          const active = tab === item.id
          const danger = item.id === 'danger'
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => setTab(item.id)}
              className={cn(
                'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? danger
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-primary/10 text-primary'
                  : danger
                    ? 'text-destructive/80 hover:bg-destructive/10 hover:text-destructive'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">{tS(item.labelKey)}</span>
            </button>
          )
        })}
      </nav>

      {/* Активный блок */}
      <div className="flex min-w-0 flex-col gap-5">
        {me.isLoading && <SectionSkeleton />}
        {me.isError && <p className="text-destructive">{tErr('INTERNAL_ERROR')}</p>}
        {me.data && (
          <>
            {tab === 'personal' && <PersonalSection me={me.data} />}
            {tab === 'security' && <SecuritySection me={me.data} />}
            {tab === 'notifications' && <NotificationsSection />}
            {tab === 'appearance' && <AppearanceSection />}
            {tab === 'privacy' && <PrivacySection me={me.data} />}
            {tab === 'danger' && <DangerSection />}
          </>
        )}
      </div>
    </div>
  )
}

// ── Личные данные ────────────────────────────────────────────────────────────
function PersonalSection({ me }: { me: MeResponse }) {
  const tS = useTranslations('Settings')
  const tP = useTranslations('Profile')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(UpdateProfileSchema),
    values: {
      firstName: me.firstName,
      lastName: me.lastName,
      middleName: me.middleName ?? '',
      headline: me.headline ?? '',
    },
  })

  const mut = useMutation({
    mutationFn: updateProfileRequest,
    onSuccess: (data) => {
      qc.setQueryData(userKeys.me(), data)
      toast.success(tP('saved'))
    },
    onError: (e) => showApiError(e),
  })

  return (
    <SectionCard icon={UserRound} title={tS('personalTitle')} desc={tS('personalDesc')}>
      <form
        onSubmit={form.handleSubmit((v) => {
          resetApiError()
          mut.mutate(v)
        })}
        className="flex flex-col gap-4"
      >
        <FormAlert error={apiError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="lastName">{tP('lastName')}</Label>
            <Input id="lastName" {...form.register('lastName')} />
            {form.formState.errors.lastName && (
              <p className="text-xs text-destructive">{form.formState.errors.lastName.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="firstName">{tP('firstName')}</Label>
            <Input id="firstName" {...form.register('firstName')} />
            {form.formState.errors.firstName && (
              <p className="text-xs text-destructive">{form.formState.errors.firstName.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="middleName">{tP('middleName')}</Label>
            <Input id="middleName" {...form.register('middleName')} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="headline">{tP('headline')}</Label>
            <Controller
              control={form.control}
              name="headline"
              render={({ field }) => (
                <DictSingleSelect
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  options={MARITAL_STATUS_DICT}
                />
              )}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!form.formState.isDirty || mut.isPending}
            onClick={() => form.reset()}
          >
            {tP('cancel')}
          </Button>
          <Button
            type="submit"
            loading={mut.isPending}
            disabled={!form.formState.isDirty}
            className="w-fit"
          >
            <Check className="size-4" aria-hidden />
            {tS('saveChanges')}
          </Button>
        </div>
      </form>
    </SectionCard>
  )
}

// ── Безопасность (смена пароля + 2FA/TOTP) ──────────────────────────────────
function SecuritySection({ me }: { me: MeResponse }) {
  const tS = useTranslations('Settings')
  const tP = useTranslations('Profile')
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const form = useForm<ChangePasswordInput>({ resolver: zodResolver(ChangePasswordSchema) })
  const mut = useMutation({
    mutationFn: changePasswordRequest,
    onSuccess: () => {
      form.reset({ currentPassword: '', newPassword: '' })
      toast.success(tP('passwordChanged'))
    },
    onError: (e) => showApiError(e),
  })

  return (
    <SectionCard icon={ShieldCheck} title={tS('securityTitle')} desc={tS('securityDesc')}>
      <form
        onSubmit={form.handleSubmit((v) => {
          resetApiError()
          mut.mutate(v)
        })}
        className="flex max-w-md flex-col gap-4"
      >
        <FormAlert error={apiError} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="currentPassword">{tP('currentPassword')}</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            {...form.register('currentPassword')}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="newPassword">{tP('newPassword')}</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            {...form.register('newPassword')}
          />
          {form.formState.errors.newPassword && (
            <p className="text-xs text-destructive">{form.formState.errors.newPassword.message}</p>
          )}
        </div>
        <Button type="submit" loading={mut.isPending} className="w-full">
          {tP('changePassword')}
        </Button>
      </form>

      <div className="mt-6 border-t border-border pt-5">
        <TwoFactorManager me={me} />
      </div>
    </SectionCard>
  )
}

// Управление 2FA: включение (QR → код → backup-коды) и отключение (по коду).
function TwoFactorManager({ me }: { me: MeResponse }) {
  const tS = useTranslations('Settings')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [disableCode, setDisableCode] = useState('')

  const refreshMe = () => qc.invalidateQueries({ queryKey: userKeys.me() })
  const errCode = (e: unknown) => (e as { code?: string }).code ?? 'INTERNAL_ERROR'

  const setupMut = useMutation({
    mutationFn: setup2faRequest,
    onSuccess: (data) => setSetup({ qr: data.qr, secret: data.secret }),
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const enableMut = useMutation({
    mutationFn: () => enable2faRequest(code.trim()),
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes)
      setSetup(null)
      setCode('')
      void refreshMe()
      toast.success(tS('twoFactorEnabledToast'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const disableMut = useMutation({
    mutationFn: () => disable2faRequest(disableCode.trim()),
    onSuccess: () => {
      setDisableCode('')
      void refreshMe()
      toast.success(tS('twoFactorDisabledToast'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  // Показ backup-кодов после включения (один раз).
  if (backupCodes) {
    return (
      <div className="flex max-w-md flex-col gap-3">
        <p className="text-sm font-semibold">{tS('backupCodesTitle')}</p>
        <p className="text-xs text-muted-foreground">{tS('backupCodesDesc')}</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-3 font-mono text-sm">
          {backupCodes.map((c) => (
            <li key={c} className="tracking-widest">
              {c}
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setBackupCodes(null)}
        >
          {tS('twoFactorDone')}
        </Button>
      </div>
    )
  }

  // Уже включена → отключение по коду.
  if (me.twoFactorEnabled) {
    return (
      <SettingRow title={tS('twoFactor')} desc={tS('twoFactorDesc')}>
        <div className="flex flex-col items-end gap-3">
          <Badge variant="secondary">{tS('twoFactorOn')}</Badge>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" size="sm">
                {tS('twoFactorDisable')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tS('twoFactorDisable')}</AlertDialogTitle>
                <AlertDialogDescription>{tS('twoFactorDisableDesc')}</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex flex-col gap-2">
                <Label htmlFor="disable2fa">{tS('twoFactorEnterCode')}</Label>
                <Input
                  id="disable2fa"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDisableCode('')}>
                  {tS('twoFactorCancel')}
                </AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  loading={disableMut.isPending}
                  disabled={!disableCode.trim()}
                  onClick={() => disableMut.mutate()}
                >
                  {tS('twoFactorDisable')}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SettingRow>
    )
  }

  // Настройка: показываем QR + секрет + ввод кода.
  if (setup) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <p className="text-sm font-semibold">{tS('twoFactorScanQr')}</p>
        {/* Data-URL от бэкенда — обычный img, не next/image (оптимизатор не нужен). */}
        <img
          src={setup.qr}
          alt={tS('twoFactor')}
          width={200}
          height={200}
          className="rounded-lg border border-border bg-white p-2"
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{tS('twoFactorOrSecret')}</span>
          <code className="rounded bg-muted px-2 py-1 font-mono text-sm break-all">
            {setup.secret}
          </code>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="enable2fa">{tS('twoFactorEnterCode')}</Label>
          <Input
            id="enable2fa"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            loading={enableMut.isPending}
            disabled={!code.trim()}
            onClick={() => enableMut.mutate()}
          >
            {tS('twoFactorConfirm')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSetup(null)
              setCode('')
            }}
          >
            {tS('twoFactorCancel')}
          </Button>
        </div>
      </div>
    )
  }

  // Выключена → предложить настроить.
  return (
    <SettingRow title={tS('twoFactor')} desc={tS('twoFactorDesc')}>
      <Button
        type="button"
        size="sm"
        loading={setupMut.isPending}
        onClick={() => setupMut.mutate()}
      >
        {tS('twoFactorSetup')}
      </Button>
    </SettingRow>
  )
}

// ── Уведомления (реальные /notifications/settings) ──────────────────────────
function NotificationsSection() {
  const tS = useTranslations('Settings')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const settings = useQuery({
    queryKey: notificationKeys.settings(),
    queryFn: fetchNotificationSettings,
  })

  const mut = useMutation({
    mutationFn: updateNotificationSettings,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: notificationKeys.settings() })
      const prev = qc.getQueryData<NotificationSettingsData>(notificationKeys.settings())
      if (prev) qc.setQueryData(notificationKeys.settings(), { ...prev, ...patch })
      return { prev }
    },
    onError: (e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(notificationKeys.settings(), ctx.prev)
      toast.error(tErr(errCode(e)))
    },
    onSuccess: (data) => qc.setQueryData(notificationKeys.settings(), data),
  })

  const s = settings.data
  const set = (key: keyof NotificationSettingsData, value: boolean) =>
    mut.mutate({ [key]: value } as Partial<NotificationSettingsData>)

  // Push (#Ф13.3): включение требует разрешения браузера + подписки SW; выключение — отписки.
  const setPush = (value: boolean): void => {
    if (value) {
      if (!pushSupported()) {
        toast.error(tS('pushUnsupported'))
        return
      }
      void subscribeToPush()
        .then((ok) => (ok ? set('pushEnabled', true) : toast.error(tS('pushDenied'))))
        .catch(() => toast.error(tS('pushDenied')))
    } else {
      void unsubscribeFromPush().finally(() => set('pushEnabled', false))
    }
  }

  const typeRows: { key: keyof NotificationSettingsData; label: string }[] = [
    { key: 'scheduleChangeEnabled', label: tS('notif_scheduleChangeEnabled') },
    { key: 'appUpdateEnabled', label: tS('notif_appUpdateEnabled') },
    { key: 'messageEnabled', label: tS('notif_messageEnabled') },
    { key: 'postEnabled', label: tS('notif_postEnabled') },
    { key: 'eventEnabled', label: tS('notif_eventEnabled') },
    { key: 'systemEnabled', label: tS('notif_systemEnabled') },
  ]

  return (
    <SectionCard icon={Bell} title={tS('notificationsTitle')} desc={tS('notificationsDesc')}>
      {settings.isLoading && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      )}
      {settings.isError && <p className="text-sm text-destructive">{tErr('INTERNAL_ERROR')}</p>}
      {s && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tS('channelsTitle')}
            </p>
            <SettingRow title={tS('channelEmail')} desc={tS('channelEmailDesc')}>
              <ToggleSwitch
                checked={s.emailEnabled}
                onChange={(v) => set('emailEnabled', v)}
                label={tS('channelEmail')}
              />
            </SettingRow>
            <SettingRow title={tS('channelPush')} desc={tS('channelPushDesc')}>
              <ToggleSwitch checked={s.pushEnabled} onChange={setPush} label={tS('channelPush')} />
            </SettingRow>
          </div>

          <div className="flex flex-col border-t border-border pt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tS('typesTitle')}
            </p>
            {typeRows.map((row) => (
              <SettingRow key={row.key} title={row.label}>
                <ToggleSwitch
                  checked={s[row.key]}
                  onChange={(v) => set(row.key, v)}
                  label={row.label}
                />
              </SettingRow>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  )
}

// ── Внешний вид (язык интерфейса) ────────────────────────────────────────────
function AppearanceSection() {
  const tS = useTranslations('Settings')
  const locale = useLocale()
  const router = useRouter()

  function changeLocale(value: string) {
    document.cookie = `NEXT_LOCALE=${value}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }

  return (
    <SectionCard icon={Palette} title={tS('appearanceTitle')} desc={tS('appearanceDesc')}>
      <SettingRow title={tS('language')}>
        <Select value={locale} onValueChange={changeLocale}>
          <SelectTrigger aria-label={tS('language')} className="h-10 w-44 gap-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCALES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                <span className="flex items-center gap-2">
                  <Flag code={l.value} />
                  {l.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    </SectionCard>
  )
}

// ── Конфиденциальность (showEmail / showPhone) ──────────────────────────────
function PrivacySection({ me }: { me: MeResponse }) {
  const tS = useTranslations('Settings')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const mut = useMutation({
    mutationFn: updateProfileRequest,
    onMutate: async (patch) => {
      resetApiError()
      await qc.cancelQueries({ queryKey: userKeys.me() })
      const prev = qc.getQueryData<MeResponse>(userKeys.me())
      if (prev) qc.setQueryData(userKeys.me(), { ...prev, ...patch } as MeResponse)
      return { prev }
    },
    onError: (e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(userKeys.me(), ctx.prev)
      showApiError(e)
    },
    onSuccess: (data) => qc.setQueryData(userKeys.me(), data),
  })

  const visibility = me.profileVisibility ?? 'UNIVERSITY'

  return (
    <SectionCard icon={Lock} title={tS('privacyTitle')} desc={tS('privacyDesc')}>
      <div className="flex flex-col">
        <FormAlert error={apiError} />
        <SettingRow title={tS('documentsStorage')} desc={tS('documentsStorageDesc')}>
          <Link
            href="/documents"
            className="inline-flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <FolderLock className="size-4" aria-hidden />
            {tS('documentsStorageOpen')}
          </Link>
        </SettingRow>
        <SettingRow title={tS('visibilityTitle')} desc={tS('visibilityDesc')}>
          <Select
            value={visibility}
            onValueChange={(v) => mut.mutate({ profileVisibility: v as ProfileVisibilityValue })}
          >
            <SelectTrigger aria-label={tS('visibilityTitle')} className="h-10 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROFILE_VISIBILITY.map((v) => (
                <SelectItem key={v} value={v}>
                  {tS(`visibility${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow title={tS('showEmail')} desc={tS('showEmailDesc')}>
          <ToggleSwitch
            checked={me.showEmail}
            onChange={(v) => mut.mutate({ showEmail: v })}
            label={tS('showEmail')}
          />
        </SettingRow>
        <SettingRow title={tS('showPhone')} desc={tS('showPhoneDesc')}>
          <ToggleSwitch
            checked={me.showPhone ?? false}
            onChange={(v) => mut.mutate({ showPhone: v })}
            label={tS('showPhone')}
          />
        </SettingRow>
      </div>
    </SectionCard>
  )
}

// ── Опасная зона ─────────────────────────────────────────────────────────────
function DangerSection() {
  const tS = useTranslations('Settings')
  const tP = useTranslations('Profile')
  const [open, setOpen] = useState(false)
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const mut = useMutation({
    mutationFn: deleteAccountRequest,
    onMutate: () => resetApiError(),
    onSuccess: async () => {
      await endSession()
      window.location.assign('/login')
    },
    onError: (e) => {
      setOpen(false)
      showApiError(e)
    },
  })

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="size-5" aria-hidden />
          {tS('dangerTitle')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{tS('dangerDesc')}</p>
      </CardHeader>
      <CardContent>
        <FormAlert error={apiError} />
        <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">{tP('deleteAccount')}</p>
            <p className="text-sm text-muted-foreground">{tS('deleteAccountDesc')}</p>
          </div>
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="shrink-0 border-destructive text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-4" aria-hidden />
                {tP('deleteAccount')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tS('deleteConfirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{tP('deleteConfirm')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={mut.isPending}>{tP('cancel')}</AlertDialogCancel>
                <Button variant="destructive" loading={mut.isPending} onClick={() => mut.mutate()}>
                  <Trash2 className="size-4" aria-hidden />
                  {tP('deleteAccount')}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Общие примитивы ──────────────────────────────────────────────────────────
function SectionCard({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: LucideIcon
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-5 text-primary" aria-hidden />
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function SettingRow({
  title,
  desc,
  children,
}: {
  title: string
  desc?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-4 border-b border-border py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-4 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-5 rounded-full bg-background ring-1 ring-border transition-transform motion-reduce:transition-none',
          checked && 'translate-x-5',
        )}
      />
    </button>
  )
}

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}
