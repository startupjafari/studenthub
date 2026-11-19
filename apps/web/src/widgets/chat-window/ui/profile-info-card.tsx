'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  AtSign,
  Ban,
  Bell,
  BellOff,
  Briefcase,
  Check,
  Copy,
  Clock,
  GraduationCap,
  Globe,
  Info,
  Link2,
  Loader2,
  LogOut,
  Mail,
  Phone,
  Quote,
  RotateCcw,
  Send,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { websiteHref } from '@studenthub/shared-schemas'
import {
  chatKeys,
  deleteChatRequest,
  fetchChatInviteCode,
  MessageContent,
  type ChatListItem,
} from '../../../entities/chat'
import { fetchUserById, userKeys } from '../../../entities/user'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Button,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Блок сведений под шапкой профиля (Telegram-стиль): карточка строк «значение крупно,
// подпись мелко под ним», нажатие на строку копирует значение. Ниже — уведомления
// переключателем и опасные действия отдельной карточкой.

/**
 * Длина описания, после которой оно сворачивается до четырёх строк: порог «заведомо длиннее
 * четырёх строк узкой колонки», чтобы «Ещё» не появлялось там, где разворачивать нечего.
 */
const DESCRIPTION_CLAMP = 220

/** Карточка-остров колонки: ровно та же поверхность у сведений, действий и управления. */
export function InfoCard({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mx-3 overflow-hidden rounded-xl bg-card py-1 ring-1 ring-foreground/10',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * Строка сведений. Есть `copyValue` — вся строка кнопка «скопировать» (как в Telegram:
 * нажал на телефон — он в буфере). Без него — просто текст (описание со ссылками внутри).
 */
function InfoRow({
  icon: Icon,
  label,
  children,
  copyValue,
}: {
  icon: LucideIcon
  label: string
  children: React.ReactNode
  copyValue?: string | null
}) {
  const t = useTranslations('Chats')
  const body = (
    <>
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] leading-snug break-words">{children}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{label}</span>
      </span>
    </>
  )
  if (!copyValue) return <div className="flex items-start gap-4 px-4 py-2.5">{body}</div>
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(copyValue)
        toast.success(t('copied'))
      }}
      title={t('copy')}
      className="flex w-full cursor-pointer items-start gap-4 px-4 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
    >
      {body}
    </button>
  )
}

/** Заглушка строк сведений, пока профиль едет. */
function InfoSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="flex items-start gap-4 px-4 py-2.5">
          <Skeleton className="size-5 shrink-0 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Сведения о собеседнике личного чата. Что видно — решает сервер (скрытое приходит null). */
export function PeerInfoRows({ userId }: { userId: string }) {
  const t = useTranslations('Profile')
  const tc = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  const tRoles = useTranslations('Roles')
  const user = useQuery({ queryKey: userKeys.detail(userId), queryFn: () => fetchUserById(userId) })
  const u = user.data

  if (user.isLoading) return <InfoSkeleton />
  if (!u) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground">
        <span className="min-w-0 flex-1">{tc('tgRight.infoLoadError')}</span>
        <button
          type="button"
          onClick={() => void user.refetch()}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-primary outline-none hover:bg-primary/10 focus-visible:ring-4 focus-visible:ring-ring/20"
        >
          <RotateCcw className="size-4" aria-hidden />
          {tCommon('retry')}
        </button>
      </div>
    )
  }

  const full = u.access === 'full'
  const isStudent = u.role === Role.STUDENT || u.role === Role.STAROSTA
  // Ссылка на профиль — наш аналог «имени пользователя» Telegram: по ней человека находят
  // и пересылают. Имя входа (username) сервер чужим не отдаёт намеренно.
  const profileUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/profile/${u.id}` : `/profile/${u.id}`
  const profileLabel = profileUrl.replace(/^https?:\/\//, '')
  // Учёба/работа одной строкой: роль и уточнение через точку, а не четыре строки по слову.
  const occupation = [
    tRoles(u.role),
    ...(isStudent
      ? [u.course != null ? `${u.course} ${t('courseShort')}` : null, u.specialty]
      : [u.position ?? u.jobTitle, u.department]),
  ]
    .filter(Boolean)
    .join(' · ')
  const site = full && u.website ? websiteHref(u.website) : null

  return (
    <>
      {full && u.phone && (
        <InfoRow icon={Phone} label={t('phone')} copyValue={u.phone}>
          {u.phone}
        </InfoRow>
      )}
      {full && u.email && (
        <InfoRow icon={Mail} label={t('email')} copyValue={u.email}>
          {u.email}
        </InfoRow>
      )}
      <InfoRow icon={AtSign} label={tc('tgRight.profileLink')} copyValue={profileUrl}>
        <span className="text-primary">{profileLabel}</span>
      </InfoRow>
      {u.headline && (
        <InfoRow icon={Quote} label={t('headline')} copyValue={u.headline}>
          {u.headline}
        </InfoRow>
      )}
      {full && u.bio && (
        <InfoRow icon={Info} label={t('bio')} copyValue={u.bio}>
          <span className="whitespace-pre-line">{u.bio}</span>
        </InfoRow>
      )}
      <InfoRow
        icon={isStudent ? GraduationCap : Briefcase}
        label={t('role')}
        copyValue={occupation}
      >
        {occupation}
      </InfoRow>
      {full && u.telegram && (
        <InfoRow icon={Send} label={t('telegram')} copyValue={u.telegram}>
          {u.telegram}
        </InfoRow>
      )}
      {full && u.website && (
        <InfoRow icon={Globe} label={t('website')}>
          {site ? (
            <a
              href={site}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-primary hover:underline"
            >
              {u.website}
            </a>
          ) : (
            u.website
          )}
        </InfoRow>
      )}
    </>
  )
}

/** Описание группы и ссылка-приглашение (её сервер выдаёт только админам). */
/** Сколько кнопка показывает «Скопировано», прежде чем вернуться к «Скопировать». */
const COPIED_MS = 2000

/**
 * Ссылка-приглашение — как в веб-приложениях (Slack, Discord, Notion): ссылка одной строкой
 * в поле только для чтения и кнопка «Скопировать» рядом, которая на пару секунд становится
 * «Скопировано ✓». Раньше это была длинная синяя ссылка в три строки, и что по ней нажать,
 * чтобы скопировать, догадаться было нельзя.
 */
function InviteLinkRow({ url }: { url: string }) {
  const t = useTranslations('Chats')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(id)
  }, [copied])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success(t('tgRight.inviteCopied'))
    } catch {
      // Буфер недоступен (нет разрешения, небезопасный контекст) — ссылку видно в поле,
      // её можно выделить и скопировать руками.
      toast.error(t('tgStickers.linkCopyFailed'))
    }
  }

  return (
    <div className="flex items-start gap-4 px-4 py-2.5">
      <Link2 className="mt-2 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url.replace(/^https?:\/\//, '')}
            aria-label={t('tgRight.inviteLink')}
            onFocus={(e) => e.currentTarget.select()}
            className="h-9 min-w-0 flex-1 truncate rounded-lg border border-input bg-muted/40 px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          <Button
            type="button"
            size="sm"
            variant={copied ? 'secondary' : 'default'}
            onClick={() => void copy()}
            className="shrink-0"
          >
            {copied ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
            {copied ? t('tgRight.inviteCopiedShort') : t('tgRight.inviteCopy')}
          </Button>
        </div>
        <span className="mt-1 block text-xs text-muted-foreground">{t('tgRight.inviteLink')}</span>
      </div>
    </div>
  )
}

export function GroupInfoRows({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  // Описание развёрнуто целиком. Сбрасывать при смене чата не нужно: панель монтируется
  // заново на каждый чат (key={chat.id} у вызывающего).
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  // «Закрытая» группа (§8.3, joinByLink: false) ссылкой не пополняется — показывать нечего.
  const canInvite = chat.type === 'GROUP' && chat.isAdmin && chat.joinByLink !== false
  const invite = useQuery({
    queryKey: chatKeys.invite(chat.id),
    queryFn: () => fetchChatInviteCode(chat.id),
    enabled: canInvite,
    staleTime: 5 * 60 * 1000,
  })
  const inviteUrl =
    invite.data && typeof window !== 'undefined'
      ? `${window.location.origin}/join-chat/${chat.id}?k=${encodeURIComponent(invite.data)}`
      : null

  return (
    <>
      {/* Описание — тем же markdown-компонентом, что сообщения: ссылки и переносы работают
          как везде в чате, сырой HTML он не пускает. Длинное свёрнуто до четырёх строк. */}
      {chat.description && (
        <div className="flex items-start gap-4 px-4 py-2.5">
          <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className={cn('text-[0.9375rem]', !descriptionOpen && 'line-clamp-4')}>
              <MessageContent content={chat.description} />
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t('tgRight.description')}</span>
              {chat.description.length > DESCRIPTION_CLAMP && (
                <button
                  type="button"
                  aria-expanded={descriptionOpen}
                  onClick={() => setDescriptionOpen((v) => !v)}
                  className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  {descriptionOpen ? t('descriptionLess') : t('descriptionMore')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {canInvite &&
        (inviteUrl ? (
          <InviteLinkRow url={inviteUrl} />
        ) : invite.isError ? (
          <div className="flex items-start gap-4 px-4 py-2.5">
            <Link2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">
              {t('tgRight.infoLoadError')}{' '}
              <button
                type="button"
                onClick={() => void invite.refetch()}
                className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {tCommon('retry')}
              </button>
            </span>
          </div>
        ) : (
          <InfoSkeleton />
        ))}
    </>
  )
}

// §17: варианты «заглушить на время».
const MUTE_DURATIONS: { key: string; mode: number | 'forever' }[] = [
  { key: 'mute1h', mode: 60 },
  { key: 'mute4h', mode: 240 },
  { key: 'mute8h', mode: 480 },
  { key: 'mute1d', mode: 1440 },
  { key: 'mute3d', mode: 4320 },
  { key: 'muteForever', mode: 'forever' },
]

/**
 * Переключатель настройки — `role="switch"`, а не стилизованный чекбокс: скринридер
 * должен читать «включено/выключено», а не «отмечено» (идиома из DESIGN_SYSTEM §9).
 * Сам не фокусируется и кликов не ловит: им управляет строка целиком.
 *
 * Бегунок едет, а дорожка перекрашивается одной длительностью (`--motion-control`) —
 * движение и цвет читаются как одно действие. `busy` — значение ещё сохраняется: в бегунке
 * появляется крошечный индикатор (смысловой, при уменьшенном движении он остаётся).
 */
export function SwitchVisual({ checked, busy = false }: { checked: boolean; busy?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-(--motion-control)',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 flex size-5 items-center justify-center rounded-full bg-background shadow-sm transition-transform duration-(--motion-control) motion-reduce:transition-none',
          checked && 'translate-x-5',
        )}
      >
        {/* Проявление — на обёртке: у самого значка `animation` занят вращением. */}
        {busy && (
          <span className="flex duration-(--motion-micro) animate-in fade-in-0">
            <Loader2
              className={cn(
                'size-3 animate-spin',
                checked ? 'text-primary' : 'text-muted-foreground',
              )}
            />
          </span>
        )}
      </span>
    </span>
  )
}

/**
 * Уведомления (как в Telegram): вся строка — переключатель, нажатие включает и выключает
 * звук сразу. Заглушить на срок или «только важные» — кнопкой-часами справа, меню.
 */
export function NotificationsRow({
  chat,
  onMute,
  onUnmute,
}: {
  chat: ChatListItem
  onMute: (mode: number | 'forever', importantOnly?: boolean) => void
  onUnmute: () => void
}) {
  const t = useTranslations('Chats')
  // Режим выбирается до срока: галочка применяется к любому выбранному сроку заглушения.
  const [importantOnly, setImportantOnly] = useState(chat.mutedImportantOnly)
  const on = !chat.muted
  const state = on
    ? t('tgRight.notificationsOn')
    : chat.mutedImportantOnly
      ? t('muteImportantOnly')
      : t('tgRight.notificationsOff')
  return (
    <div className="flex items-center pr-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => (on ? onMute('forever', false) : onUnmute())}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 py-2.5 pl-4 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
      >
        {on ? (
          <Bell className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <BellOff className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem]">{t('notificationsRow')}</span>
          <span className="block truncate text-xs text-muted-foreground">{state}</span>
        </span>
        <SwitchVisual checked={on} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('tgRight.muteFor')}
            title={t('tgRight.muteFor')}
            className="ml-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/20"
          >
            <Clock className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* §17: «только важные» — не отдельный срок, а модификатор к выбранному: чат
              заглушён, но ответы мне и упоминания меня всё равно уведомляют. */}
          <DropdownMenuCheckboxItem
            checked={importantOnly}
            onCheckedChange={(v) => setImportantOnly(v === true)}
            onSelect={(e) => e.preventDefault()}
          >
            {t('muteImportantOnly')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {MUTE_DURATIONS.map((d) => (
            <DropdownMenuItem key={d.key} onClick={() => onMute(d.mode, importantOnly)}>
              {t(d.key)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

const ACTION_ROW =
  'flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left text-[0.9375rem] outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60'

/**
 * Опасные действия над чатом — отдельной карточкой в самом низу сведений, красным:
 * заблокировать собеседника, покинуть группу. Не прячутся в меню — их ищут глазами.
 */
export function ChatActionsCard({
  chat,
  peerBlocked,
  onToggleBlock,
  onLeft,
}: {
  chat: ChatListItem
  peerBlocked: boolean
  /** Задан — это личный чат с собеседником, и его можно (раз)блокировать. */
  onToggleBlock?: () => void
  onLeft: () => void
}) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  // Покинуть можно только пользовательскую группу. Создатель её не покидает, а удаляет
  // (экран управления и меню шапки), официальные чаты не покидаются.
  const canLeave = chat.type === 'GROUP' && !chat.isOwner

  // Выход — DELETE /chats/:id, а не исключение самого себя: исключать может только админ, и у
  // него в ленте вместо «вышел» появлялось «исключил».
  const leave = useMutation({
    mutationFn: () => deleteChatRequest(chat.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      void qc.invalidateQueries({ queryKey: chatKeys.unread() })
      onLeft()
    },
    onError: (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  if (!onToggleBlock && !canLeave) return null
  return (
    <InfoCard className="mt-3">
      {onToggleBlock && (
        <button
          type="button"
          onClick={onToggleBlock}
          className={cn(ACTION_ROW, !peerBlocked && 'text-destructive')}
        >
          {peerBlocked ? (
            <UserCheck className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <Ban className="size-5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">
            {peerBlocked ? t('unblockUser') : t('blockUser')}
          </span>
        </button>
      )}
      {canLeave && (
        <button
          type="button"
          disabled={leave.isPending}
          onClick={() => {
            void confirm({ title: t('tgRight.leaveConfirm'), destructive: true }).then((ok) => {
              if (ok) leave.mutate()
            })
          }}
          className={cn(ACTION_ROW, 'text-destructive')}
        >
          {leave.isPending ? (
            <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <LogOut className="size-5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{t('tgRight.leaveGroup')}</span>
        </button>
      )}
    </InfoCard>
  )
}
