'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  BarChart3,
  Image as ImageIcon,
  Link2,
  Lock,
  MessageSquare,
  Pencil,
  Pin,
  Sticker,
  UserMinus,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  CHAT_PERMISSION_KEYS,
  DEFAULT_CHAT_PERMISSIONS,
  resolveChatPermissions,
  type ChatPermissionKey,
  type ChatPermissions,
} from '@studenthub/shared-schemas'
import {
  addChatMemberRequest,
  approveJoinRequest,
  chatKeys,
  declineJoinRequest,
  fetchJoinRequests,
  fetchRemovedMembers,
  groupKeys,
  updateChatJoinSettingsRequest,
  updateChatPermissionsRequest,
  type ChatGroupSettings,
  type ChatListItem,
} from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { Avatar, AvatarFallback, AvatarImage, Button } from '../../../shared/ui'
import { identityColor, identityInitials } from '../../../shared/lib'
import { useRealtimeEvent } from '../../../shared/realtime'
import { cn } from '../../../shared/lib/utils'
import { InfoCard, SwitchVisual } from './profile-info-card'
import { RowsSkeleton, TabEmpty, TabError } from './shared-media'

// Экраны управления группой как в Telegram (§8.3): «Разрешения», тип группы, заявки на
// вступление и «Удалённые». Живут внутри правой колонки, как остальные экраны управления
// (group-management.tsx): «назад» в шапке возвращает на главный экран.

const ICONS: Record<ChatPermissionKey, LucideIcon> = {
  sendMessages: MessageSquare,
  sendMedia: ImageIcon,
  sendStickers: Sticker,
  embedLinks: Link2,
  sendPolls: BarChart3,
  addMembers: UserPlus,
  pinMessages: Pin,
  changeInfo: Pencil,
}

/** Права, которые без «писать» не включаются (как в Telegram — строки гаснут). */
const SEND_DEPENDENT: ReadonlySet<ChatPermissionKey> = new Set([
  'sendMedia',
  'sendStickers',
  'embedLinks',
  'sendPolls',
])

/** Подпись под карточкой — пояснение, как у секций настроек Telegram. */
function CardHint({ children }: { children: React.ReactNode }) {
  return <p className="mx-3 mt-2 px-4 text-xs text-muted-foreground">{children}</p>
}

/** Права группы из кэша списка чатов: у старого сервера поля нет — умолчания. */
export function chatPermissionsOf(chat: ChatListItem): ChatPermissions {
  return chat.permissions ? resolveChatPermissions(chat.permissions) : DEFAULT_CHAT_PERMISSIONS
}

/** Сколько прав из восьми открыто — значение строки «Разрешения» на главном экране. */
export function allowedCount(chat: ChatListItem): number {
  const p = chatPermissionsOf(chat)
  return CHAT_PERMISSION_KEYS.filter((k) => p[k]).length
}

/**
 * Применить ответ сервера к кэшу списка чатов сразу — не дожидаясь `chat:activity`: экран
 * и композер должны увидеть новые права в тот же кадр.
 */
export function patchGroupSettings(
  qc: ReturnType<typeof useQueryClient>,
  settings: ChatGroupSettings,
): void {
  qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
    old?.map((c) =>
      c.id === settings.chatId
        ? {
            ...c,
            permissions: settings.permissions,
            joinByLink: settings.joinByLink,
            joinApproval: settings.joinApproval,
          }
        : c,
    ),
  )
}

function SwitchRow({
  icon: Icon,
  label,
  hint,
  checked,
  disabled,
  onToggle,
}: {
  icon?: LucideIcon
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className="flex w-full cursor-pointer items-center gap-4 px-4 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {Icon && <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem]">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <SwitchVisual checked={checked} />
    </button>
  )
}

/** «Разрешения»: что могут рядовые участники. Каждое переключение сохраняется сразу. */
export function PermissionsScreen({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const current = chatPermissionsOf(chat)

  const save = useMutation({
    mutationFn: (patch: Partial<ChatPermissions>) => updateChatPermissionsRequest(chat.id, patch),
    // Оптимистично: переключатель откликается сразу, ошибка вернёт прежнее значение.
    onMutate: (patch) => {
      const before = chat.permissions ?? null
      patchGroupSettings(qc, {
        chatId: chat.id,
        permissions: resolveChatPermissions({ ...current, ...patch }),
        joinByLink: chat.joinByLink ?? true,
        joinApproval: chat.joinApproval ?? false,
      })
      return { before }
    },
    onSuccess: (settings) => patchGroupSettings(qc, settings),
    onError: (e: unknown, _patch, ctx) => {
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
        old?.map((c) => (c.id === chat.id ? { ...c, permissions: ctx?.before ?? null } : c)),
      )
      toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
    },
  })

  const sendOff = !current.sendMessages
  return (
    <>
      <p className="mx-3 mt-3 px-4 text-xs font-medium text-primary">
        {t('tgGroups.permissionsWhat')}
      </p>
      <InfoCard className="mt-1">
        {CHAT_PERMISSION_KEYS.map((key) => {
          const dependent = SEND_DEPENDENT.has(key)
          return (
            <SwitchRow
              key={key}
              icon={ICONS[key]}
              label={t(`tgGroups.perm.${key}`)}
              hint={dependent && sendOff ? t('tgGroups.permNeedsSend') : undefined}
              checked={current[key]}
              disabled={save.isPending || (dependent && sendOff)}
              onToggle={() => save.mutate({ [key]: !current[key] })}
            />
          )
        })}
      </InfoCard>
      <CardHint>{t('tgGroups.permissionsHint')}</CardHint>
    </>
  )
}

/**
 * Тип группы: «по ссылке» или «закрытая», и одобрение заявок. Публичных групп с поиском по
 * платформе нет — подпись объясняет, почему (§8.3).
 */
export function GroupTypeScreen({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const byLink = chat.joinByLink !== false
  const approval = chat.joinApproval === true

  const save = useMutation({
    mutationFn: (patch: { joinByLink?: boolean; joinApproval?: boolean }) =>
      updateChatJoinSettingsRequest(chat.id, patch),
    onSuccess: (settings) => {
      patchGroupSettings(qc, settings)
      toast.success(t('tgGroups.settingsSaved'))
    },
    onError: (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const option = (value: boolean, label: string, hint: string): React.ReactNode => (
    <button
      type="button"
      role="radio"
      aria-checked={byLink === value}
      disabled={save.isPending}
      onClick={() => byLink !== value && save.mutate({ joinByLink: value })}
      className="flex w-full cursor-pointer items-start gap-4 px-4 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:cursor-not-allowed"
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2',
          byLink === value ? 'border-primary' : 'border-muted-foreground/40',
        )}
      >
        {byLink === value && <span className="size-2.5 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem]">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  )

  return (
    <>
      <p className="mx-3 mt-3 px-4 text-xs font-medium text-primary">{t('tgGroups.groupType')}</p>
      <InfoCard className="mt-1">
        <div role="radiogroup" aria-label={t('tgGroups.groupType')}>
          {option(true, t('tgGroups.typeByLink'), t('tgGroups.typeByLinkHint'))}
          {option(false, t('tgGroups.typeClosed'), t('tgGroups.typeClosedHint'))}
        </div>
      </InfoCard>
      <CardHint>{t('tgGroups.typeWhy')}</CardHint>
      {byLink && (
        <>
          <InfoCard className="mt-3">
            <SwitchRow
              icon={Lock}
              label={t('tgGroups.joinApproval')}
              checked={approval}
              disabled={save.isPending}
              onToggle={() => save.mutate({ joinApproval: !approval })}
            />
          </InfoCard>
          <CardHint>{t('tgGroups.joinApprovalHint')}</CardHint>
        </>
      )}
    </>
  )
}

function PersonAvatar({ id, name, url }: { id: string; name: string; url: string | null }) {
  return (
    <Avatar className="size-11">
      {url && <AvatarImage src={url} alt={name} />}
      <AvatarFallback className={cn('text-white', identityColor(id))}>
        {identityInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

/** Сколько заявок ждёт — значение строки на главном экране (запрос общий с экраном заявок). */
export function useJoinRequests(chat: ChatListItem, enabled: boolean) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: groupKeys.joinRequests(chat.id),
    queryFn: () => fetchJoinRequests(chat.id),
    enabled,
  })
  // Новая заявка или решение другого админа — список перечитывается сам.
  useRealtimeEvent<{ chatId: string }>('chat:join-requests', ({ chatId }) => {
    if (chatId === chat.id) void qc.invalidateQueries({ queryKey: groupKeys.joinRequests(chatId) })
  })
  return query
}

/** Заявки на вступление: принять или отклонить, свежие сверху. */
export function JoinRequestsScreen({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const format = useFormatter()
  const qc = useQueryClient()
  const requests = useJoinRequests(chat, true)

  const decide = useMutation({
    mutationFn: ({ userId, accept }: { userId: string; accept: boolean; name: string }) =>
      accept ? approveJoinRequest(chat.id, userId) : declineJoinRequest(chat.id, userId),
    onSuccess: (_d, { accept, name }) => {
      void qc.invalidateQueries({ queryKey: groupKeys.joinRequests(chat.id) })
      if (accept) {
        void qc.invalidateQueries({ queryKey: chatKeys.members(chat.id) })
        void qc.invalidateQueries({ queryKey: chatKeys.list() })
      }
      toast.success(accept ? t('tgGroups.approved', { name }) : t('tgGroups.declined'))
    },
    onError: (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  if (requests.isLoading) return <RowsSkeleton rows={4} />
  if (requests.isError && !requests.data) {
    return <TabError onRetry={() => void requests.refetch()} />
  }
  const list = requests.data ?? []
  if (list.length === 0) {
    return (
      <TabEmpty
        icon={<UserPlus className="size-6" aria-hidden />}
        title={t('tgGroups.joinRequestsEmpty')}
      />
    )
  }
  return (
    <ul className="mt-2 py-1">
      {list.map((r) => {
        const name = `${r.lastName} ${r.firstName}`.trim()
        return (
          <li key={r.id} className="flex items-center gap-3 px-4 py-2">
            <ProfileLink userId={r.id} className="flex min-w-0 flex-1 items-center gap-3">
              <PersonAvatar id={r.id} name={name} url={r.avatarUrl} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t('tgGroups.requestedAt', {
                    date: format.relativeTime(new Date(r.requestedAt)),
                  })}
                </span>
              </span>
            </ProfileLink>
            <div className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ userId: r.id, accept: true, name })}
              >
                {t('tgGroups.approve')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ userId: r.id, accept: false, name })}
              >
                {t('tgGroups.decline')}
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * «Удалённые»: исключённые админом. Отдельно от заблокированных (те — на экране
 * «Заблокированные»): исключённый может вернуться по ссылке, и его можно вернуть отсюда.
 */
export function RemovedScreen({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const format = useFormatter()
  const qc = useQueryClient()
  const removed = useQuery({
    queryKey: groupKeys.removed(chat.id),
    queryFn: () => fetchRemovedMembers(chat.id),
  })
  const readd = useMutation({
    mutationFn: ({ userId }: { userId: string; name: string }) =>
      addChatMemberRequest(chat.id, userId),
    onSuccess: (_d, { name }) => {
      void qc.invalidateQueries({ queryKey: groupKeys.removed(chat.id) })
      void qc.invalidateQueries({ queryKey: chatKeys.members(chat.id) })
      toast.success(t('tgGroups.readded', { name }))
    },
    onError: (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  return (
    <>
      <CardHint>{t('tgGroups.removedHint')}</CardHint>
      {removed.isLoading ? (
        <RowsSkeleton rows={4} />
      ) : removed.isError && !removed.data ? (
        <TabError onRetry={() => void removed.refetch()} />
      ) : (removed.data ?? []).length === 0 ? (
        <TabEmpty
          icon={<UserMinus className="size-6" aria-hidden />}
          title={t('tgGroups.removedEmpty')}
        />
      ) : (
        <ul className="mt-2 py-1">
          {(removed.data ?? []).map((r) => {
            const name = `${r.lastName} ${r.firstName}`.trim()
            const by = r.removedBy
              ? `${r.removedBy.lastName} ${r.removedBy.firstName}`.trim()
              : null
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                <ProfileLink userId={r.id} className="flex min-w-0 flex-1 items-center gap-3">
                  <PersonAvatar id={r.id} name={name} url={r.avatarUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[
                        by ? t('tgGroups.removedBy', { name: by }) : null,
                        format.relativeTime(new Date(r.removedAt)),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </ProfileLink>
                <Button
                  size="sm"
                  variant="outline"
                  icon
                  disabled={readd.isPending}
                  onClick={() => readd.mutate({ userId: r.id, name })}
                  aria-label={`${t('tgGroups.readd')}: ${name}`}
                  title={t('tgGroups.readd')}
                >
                  <Users aria-hidden />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
