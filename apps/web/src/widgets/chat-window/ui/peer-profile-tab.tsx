'use client'

import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  BadgeCheck,
  Briefcase,
  CalendarDays,
  Copy,
  GraduationCap,
  Globe,
  Loader2,
  Mail,
  Phone,
  Quote,
  Send,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { userKeys, fetchUserById } from '../../../entities/user'

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
    <div className="flex items-start gap-3 px-1 py-2">
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
          className="mt-0.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Copy className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}

/**
 * Вкладка «Профиль» панели деталей личного чата: кто это и чем с ним можно связаться.
 *
 * Раньше то же содержимое открывалось модальным окном поверх переписки по кнопке
 * «Открыть профиль». Окно перекрывало чат целиком ради справки, которую читают
 * одним глазом, и закрывалось, стоило промахнуться мимо. Панель деталей — то самое
 * место, где у мессенджера живут сведения о собеседнике, и профиль стоит в ней
 * первым: на вопрос «кто это» отвечают раньше, чем «что он присылал» (§55).
 *
 * Одна справка и ничего больше: действия над собеседником (звук, блокировка) живут
 * в шапке панели — они относятся к чату целиком, а не к вкладке, и должны быть под
 * рукой на любой из них.
 */
export function PeerProfileTab({ userId }: { userId: string }) {
  const t = useTranslations('Profile')
  const tc = useTranslations('Chats')
  const tRoles = useTranslations('Roles')
  const locale = useLocale()

  const user = useQuery({ queryKey: userKeys.detail(userId), queryFn: () => fetchUserById(userId) })
  const u = user.data
  const copyTitle = tc('copy')
  const copiedText = tc('copied')

  const isStudent = u ? ['STUDENT', 'STAROSTA'].includes(u.role) : false

  if (user.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden />
      </div>
    )
  }

  return (
    <div className="flex flex-col px-3 pb-3">
      {/* Роль и статус — обычные строки справки, а не отдельный блок над ней: имя, аватар
          и «в сети» показывает шапка панели, и повторять их здесь было нечем оправдать.
          Стоят выше остальных полей и вне ветки `access === 'full'` — они приходят всегда,
          и без них вкладка у закрытого профиля оказалась бы пустой. */}
      {u && (
        <div className="pt-1">
          <InfoRow
            icon={BadgeCheck}
            label={t('role')}
            copyTitle={copyTitle}
            copiedText={copiedText}
          >
            {tRoles(u.role)}
          </InfoRow>
          {u.headline && (
            <InfoRow
              icon={Quote}
              label={t('headline')}
              copyValue={u.headline}
              copyTitle={copyTitle}
              copiedText={copiedText}
            >
              {u.headline}
            </InfoRow>
          )}
        </div>
      )}

      {/* Что именно видно — решает сервер: скрытые почта и телефон приходят null. */}
      {u && u.access === 'full' && (
        <div className="border-t border-border pt-1">
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
  )
}
