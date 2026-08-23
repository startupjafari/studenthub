'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  BadgeCheck,
  Ban,
  Bell,
  BellOff,
  Briefcase,
  CalendarDays,
  Copy,
  GraduationCap,
  Globe,
  Loader2,
  Mail,
  Phone,
  Send,
  UserCheck,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { userKeys, fetchUserById } from '../../../entities/user'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useBodyScrollLock } from '../../../shared/lib'

function initials(a: string, b: string): string {
  return `${a[0] ?? ''}${b[0] ?? ''}`.toUpperCase() || '#'
}

// Строка информации: иконка + значение (значение может быть ссылкой) + кнопка копирования справа.
function InfoRow({
  icon: Icon,
  label,
  children,
  copyValue,
  copyTitle,
  copiedText,
}: {
  icon: LucideIcon
  label: string
  children: React.ReactNode
  copyValue?: string | null
  copyTitle: string
  copiedText: string
}) {
  const copy = (): void => {
    if (!copyValue) return
    void navigator.clipboard?.writeText(copyValue)
    toast.success(copiedText)
  }
  return (
    <div className="group flex items-start gap-3 px-1 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[0.7rem] text-muted-foreground">{label}</p>
        <div className="text-sm break-words">{children}</div>
      </div>
      {copyValue && (
        <button
          type="button"
          onClick={copy}
          aria-label={copyTitle}
          title={copyTitle}
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Copy className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}

// Подробная карточка собеседника (Telegram-стиль) для личного чата: аватар, статус, действия,
// профильная информация. Данные — GET /users/:id (email/phone приходят null, если скрыты).
export function PeerInfoCard({
  userId,
  online,
  blocked,
  muted,
  onToggleBlock,
  onToggleMute,
  onClose,
}: {
  userId: string
  online: boolean
  blocked: boolean
  muted: boolean
  onToggleBlock: () => void
  onToggleMute: () => void
  onClose: () => void
}) {
  useBodyScrollLock()
  const t = useTranslations('Profile')
  const tc = useTranslations('Chats')
  const tRoles = useTranslations('Roles')
  const locale = useLocale()
  const router = useRouter()

  const user = useQuery({ queryKey: userKeys.detail(userId), queryFn: () => fetchUserById(userId) })
  const u = user.data
  const copyTitle = tc('copy')
  const copiedText = tc('copied')

  const isStudent = u ? ['STUDENT', 'STAROSTA'].includes(u.role) : false

  const action = (opts: {
    key: string
    icon: LucideIcon
    label: string
    onClick: () => void
    danger?: boolean
  }): React.ReactNode => {
    const Icon = opts.icon
    return (
      <button
        key={opts.key}
        type="button"
        onClick={opts.onClick}
        aria-label={opts.label}
        title={opts.label}
        className={cn(
          'flex flex-1 items-center justify-center rounded-xl bg-muted/60 py-3.5 transition-colors hover:bg-muted',
          opts.danger ? 'text-destructive' : 'text-foreground',
        )}
      >
        <Icon className="size-5" aria-hidden />
      </button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 duration-150 animate-in fade-in"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg duration-150 animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="relative flex flex-col items-center gap-2 p-5 pb-4">
          <button
            type="button"
            aria-label={tc('cancel')}
            onClick={onClose}
            className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
          <span className="relative">
            <Avatar className="size-20">
              {u?.avatarUrl && (
                <AvatarImage src={u.avatarUrl} alt={`${u.firstName} ${u.lastName}`} />
              )}
              <AvatarFallback className="bg-primary text-2xl font-semibold text-primary-foreground">
                {u ? initials(u.lastName, u.firstName) : '·'}
              </AvatarFallback>
            </Avatar>
            {online && (
              <span
                className="absolute right-1 bottom-1 size-4 rounded-full border-2 border-card bg-success"
                aria-hidden
              />
            )}
          </span>
          {user.isLoading ? (
            <Loader2 className="my-2 size-5 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <>
              <span className="flex items-center gap-1.5 text-center text-lg font-semibold">
                {u ? `${u.lastName} ${u.firstName}` : ''}
                <BadgeCheck className="size-4 shrink-0 text-primary" aria-hidden />
              </span>
              {u?.headline && (
                <span className="text-center text-sm text-muted-foreground">{u.headline}</span>
              )}
              <div className="flex flex-wrap items-center justify-center gap-2">
                {u && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {tRoles(u.role)}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {online ? tc('online') : tc('offlineStatus')}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Действия (Telegram-стиль): профиль · звук · блокировка */}
        <div className="flex gap-2 px-4 pb-3">
          {action({
            key: 'profile',
            icon: UserRound,
            label: tc('openProfile'),
            onClick: () => {
              onClose()
              router.push(`/profile/${userId}`)
            },
          })}
          {action({
            key: 'mute',
            icon: muted ? BellOff : Bell,
            label: muted ? tc('unmute') : tc('mute'),
            onClick: onToggleMute,
          })}
          {action({
            key: 'block',
            icon: blocked ? UserCheck : Ban,
            label: blocked ? tc('unblockUser') : tc('blockUser'),
            onClick: () => {
              onToggleBlock()
              onClose()
            },
            danger: !blocked,
          })}
        </div>

        {/* Информация из профиля (что доступно смотрящему) */}
        {u && u.access === 'full' && (
          <div className="flex-1 overflow-y-auto border-t border-border px-4 py-1">
            {u.email && (
              <InfoRow
                icon={Mail}
                label={t('email')}
                copyValue={u.email}
                copyTitle={copyTitle}
                copiedText={copiedText}
              >
                <a href={`mailto:${u.email}`} className="text-primary hover:underline">
                  {u.email}
                </a>
              </InfoRow>
            )}
            {u.phone && (
              <InfoRow
                icon={Phone}
                label={t('phone')}
                copyValue={u.phone}
                copyTitle={copyTitle}
                copiedText={copiedText}
              >
                {u.phone}
              </InfoRow>
            )}
            {isStudent && u.specialty && (
              <InfoRow
                icon={GraduationCap}
                label={t('specialty')}
                copyValue={u.specialty}
                copyTitle={copyTitle}
                copiedText={copiedText}
              >
                {u.specialty}
              </InfoRow>
            )}
            {isStudent && u.course != null && (
              <InfoRow
                icon={GraduationCap}
                label={t('course')}
                copyValue={String(u.course)}
                copyTitle={copyTitle}
                copiedText={copiedText}
              >
                {u.course} {t('courseShort')}
              </InfoRow>
            )}
            {!isStudent && (u.position ?? u.jobTitle) && (
              <InfoRow
                icon={Briefcase}
                label={t('position')}
                copyValue={u.position ?? u.jobTitle}
                copyTitle={copyTitle}
                copiedText={copiedText}
              >
                {u.position ?? u.jobTitle}
              </InfoRow>
            )}
            {!isStudent && u.department && (
              <InfoRow
                icon={Briefcase}
                label={t('department')}
                copyValue={u.department}
                copyTitle={copyTitle}
                copiedText={copiedText}
              >
                {u.department}
              </InfoRow>
            )}
            {u.telegram && (
              <InfoRow
                icon={Send}
                label={t('telegram')}
                copyValue={u.telegram}
                copyTitle={copyTitle}
                copiedText={copiedText}
              >
                {u.telegram}
              </InfoRow>
            )}
            {u.website && (
              <InfoRow
                icon={Globe}
                label={t('website')}
                copyValue={u.website}
                copyTitle={copyTitle}
                copiedText={copiedText}
              >
                <a
                  href={u.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {u.website}
                </a>
              </InfoRow>
            )}
            {u.bio && (
              <InfoRow
                icon={UserRound}
                label={t('bio')}
                copyValue={u.bio}
                copyTitle={copyTitle}
                copiedText={copiedText}
              >
                {u.bio}
              </InfoRow>
            )}
            <InfoRow
              icon={CalendarDays}
              label={t('memberSince')}
              copyTitle={copyTitle}
              copiedText={copiedText}
            >
              {new Date(u.createdAt).toLocaleDateString(locale)}
            </InfoRow>
          </div>
        )}
      </div>
    </div>
  )
}
