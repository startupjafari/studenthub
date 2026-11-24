'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  BarChart3,
  Check,
  Image as ImageIcon,
  Link2,
  Loader2,
  Lock,
  MessageSquare,
  Pencil,
  Pin,
  RotateCcw,
  UserCheck,
  UserMinus,
  UserPlus,
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
  type JoinRequestRow,
  type RemovedMemberRow,
} from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { Button } from '../../../shared/ui'
import { useFreshIds } from '../../../shared/lib'
import { useRealtimeEvent } from '../../../shared/realtime'
import { cn } from '../../../shared/lib/utils'
import {
  CardHint,
  ManageEmpty,
  PERSON_ROW,
  PersonAvatar,
  PersonRowsSkeleton,
  Reveal,
  SectionTitle,
  SwitchRow,
} from './group-manage-kit'
import { InfoCard } from './profile-info-card'

// Экраны управления группой как в Telegram (§8.3): «Разрешения», тип группы, заявки на
// вступление и «Удалённые». Живут внутри правой колонки, как остальные экраны управления
// (group-management.tsx): «назад» в шапке возвращает на главный экран.

const ICONS: Record<ChatPermissionKey, LucideIcon> = {
  sendMessages: MessageSquare,
  sendMedia: ImageIcon,
  embedLinks: Link2,
  sendPolls: BarChart3,
  addMembers: UserPlus,
  pinMessages: Pin,
  changeInfo: Pencil,
}

/**
 * Права по смыслу, двумя секциями: что участник может отправлять — и что он может делать
 * с самой группой. Семь переключателей подряд одним столбцом читались как список без
 * начала и конца.
 */
const PERM_SECTIONS: { title: string; keys: readonly ChatPermissionKey[] }[] = [
  {
    title: 'tgGroups.permSectionMessages',
    keys: ['sendMessages', 'sendMedia', 'embedLinks', 'sendPolls'],
  },
  { title: 'tgGroups.permSectionMembers', keys: ['addMembers', 'pinMessages', 'changeInfo'] },
]

/** Права, которые без «писать» не включаются (как в Telegram — строки гаснут). */
const SEND_DEPENDENT: ReadonlySet<ChatPermissionKey> = new Set([
  'sendMedia',
  'embedLinks',
  'sendPolls',
])

const errorCode = (e: unknown): string => (e as { code?: string }).code ?? 'INTERNAL_ERROR'

/** Права группы из кэша списка чатов: у старого сервера поля нет — умолчания. */
export function chatPermissionsOf(chat: ChatListItem): ChatPermissions {
  return chat.permissions ? resolveChatPermissions(chat.permissions) : DEFAULT_CHAT_PERMISSIONS
}

/** Сколько прав из семи открыто — значение строки «Разрешения» на главном экране. */
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

/** Поправить поля группы в кэше списка чатов — для оптимистичного отклика и отката. */
function patchChat(
  qc: ReturnType<typeof useQueryClient>,
  chatId: string,
  patch: Partial<ChatListItem>,
): void {
  qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
    old?.map((c) => (c.id === chatId ? { ...c, ...patch } : c)),
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
      patchChat(qc, chat.id, { permissions: ctx?.before ?? null })
      toast.error(tErr(errorCode(e)))
    },
  })

  // Какое право сейчас сохраняется — у его переключателя крутится индикатор. Остальные
  // строки не гаснут (раньше на время запроса бледнел весь список — экран мигал на каждом
  // нажатии): нажатие на них просто ждёт ответа, запросы не наслаиваются друг на друга.
  const savingKey = save.isPending
    ? (Object.keys(save.variables ?? {})[0] as ChatPermissionKey | undefined)
    : undefined
  const sendOff = !current.sendMessages

  return (
    <>
      {PERM_SECTIONS.map((section, i) => (
        <section key={section.title} aria-labelledby={`perm-section-${i}`}>
          <SectionTitle className={i === 0 ? 'mt-3' : undefined}>
            <span id={`perm-section-${i}`}>{t(section.title)}</span>
          </SectionTitle>
          <InfoCard>
            {section.keys.map((key) => (
              <SwitchRow
                key={key}
                icon={ICONS[key]}
                label={t(`tgGroups.perm.${key}`)}
                checked={current[key]}
                busy={savingKey === key}
                disabled={SEND_DEPENDENT.has(key) && sendOff}
                onToggle={() => {
                  if (!save.isPending) save.mutate({ [key]: !current[key] })
                }}
              />
            ))}
          </InfoCard>
          {/* Почему погасли медиа, ссылки и опросы — одной подписью под секцией, а
              не одной и той же строкой под каждым из трёх переключателей. */}
          {i === 0 && (
            <Reveal open={sendOff}>
              <CardHint>{t('tgGroups.permNeedsSend')}</CardHint>
            </Reveal>
          )}
        </section>
      ))}
      <CardHint>{t('tgGroups.permissionsHint')}</CardHint>
    </>
  )
}

const TYPE_OPTIONS: { value: boolean; icon: LucideIcon; title: string; hint: string }[] = [
  {
    value: true,
    icon: Link2,
    title: 'tgGroups.typeByLink',
    hint: 'tgGroups.typeByLinkHint',
  },
  {
    value: false,
    icon: Lock,
    title: 'tgGroups.typeClosed',
    hint: 'tgGroups.typeClosedHint',
  },
]

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
    // Оптимистично, как «Разрешения»: карточка выбирается и блок одобрения раскрывается в
    // момент нажатия, а не после ответа сервера. Ошибка возвращает прежнее и говорит тостом.
    onMutate: (patch) => {
      const before = { joinByLink: chat.joinByLink, joinApproval: chat.joinApproval }
      patchChat(qc, chat.id, patch)
      return { before }
    },
    onSuccess: (settings) => {
      patchGroupSettings(qc, settings)
      toast.success(t('tgGroups.settingsSaved'))
    },
    onError: (e: unknown, _patch, ctx) => {
      if (ctx) patchChat(qc, chat.id, ctx.before)
      toast.error(tErr(errorCode(e)))
    },
  })
  const savingType = save.isPending && save.variables?.joinByLink !== undefined
  const savingApproval = save.isPending && save.variables?.joinApproval !== undefined

  const select = (value: boolean): void => {
    if (value !== byLink && !save.isPending) save.mutate({ joinByLink: value })
  }

  return (
    <>
      <SectionTitle className="mt-3">{t('tgGroups.groupType')}</SectionTitle>
      {/* Радиогруппа по WAI-ARIA: в табе один фокус (выбранная карточка), стрелки
          переводят выбор — как у системных радиокнопок. */}
      <div
        role="radiogroup"
        aria-label={t('tgGroups.groupType')}
        className="mx-3 flex flex-col gap-2"
        onKeyDown={(e) => {
          const step =
            e.key === 'ArrowDown' || e.key === 'ArrowRight'
              ? 1
              : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
                ? -1
                : 0
          if (!step) return
          e.preventDefault()
          const at = TYPE_OPTIONS.findIndex((o) => o.value === byLink)
          const next = (at + step + TYPE_OPTIONS.length) % TYPE_OPTIONS.length
          e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
          select(TYPE_OPTIONS[next]!.value)
        }}
      >
        {TYPE_OPTIONS.map((o) => (
          <TypeOption
            key={String(o.value)}
            icon={o.icon}
            title={t(o.title)}
            hint={t(o.hint)}
            selected={byLink === o.value}
            busy={savingType && byLink === o.value}
            onSelect={() => select(o.value)}
          />
        ))}
      </div>
      <CardHint>{t('tgGroups.typeWhy')}</CardHint>
      {/* Одобрение заявок имеет смысл только у группы по ссылке: у закрытой вступают лишь
          через администратора. Блок не исчезает рывком, а сворачивается. */}
      <Reveal open={byLink}>
        <InfoCard className="mt-5">
          <SwitchRow
            icon={UserCheck}
            label={t('tgGroups.joinApproval')}
            checked={approval}
            busy={savingApproval}
            onToggle={() => {
              if (!save.isPending) save.mutate({ joinApproval: !approval })
            }}
          />
        </InfoCard>
        <CardHint>{t('tgGroups.joinApprovalHint')}</CardHint>
      </Reveal>
    </>
  )
}

/**
 * Карточка-вариант радиогруппы: значок, название, пояснение и отметка справа. Выбранная —
 * с кольцом акцента и залитым значком; отметка проявляется масштабом. Нажатие чуть
 * сжимает карточку (кроме уменьшенного движения) — физический отклик, как у iOS.
 */
function TypeOption({
  icon: Icon,
  title,
  hint,
  selected,
  busy,
  onSelect,
}: {
  icon: LucideIcon
  title: string
  hint: string
  selected: boolean
  busy: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-busy={busy || undefined}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={cn(
        'flex w-full cursor-pointer items-start gap-3 rounded-xl p-3.5 text-left transition-[background-color,box-shadow,scale] duration-(--motion-control) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] motion-reduce:active:scale-100',
        selected
          ? 'bg-primary/5 ring-2 ring-primary'
          : 'bg-card ring-1 ring-foreground/10 hover:bg-muted/40',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full transition-colors duration-(--motion-control)',
          selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="block text-[0.9375rem] font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-(--motion-control)',
          selected ? 'border-primary bg-primary' : 'border-muted-foreground/40',
        )}
      >
        {busy ? (
          <Loader2 className="size-3 animate-spin text-primary-foreground" />
        ) : (
          <Check
            strokeWidth={3}
            className={cn(
              'size-3 text-primary-foreground transition-[opacity,scale] duration-(--motion-control) motion-reduce:transition-none',
              selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
            )}
          />
        )}
      </span>
    </button>
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

/**
 * Какие строки списка сейчас в работе: id → что именно делаем. Нужен, чтобы крутилка была
 * на нажатой кнопке нажатой строки, а не гасли кнопки всего списка разом.
 */
function usePendingRows<V>() {
  const [pending, setPending] = useState<ReadonlyMap<string, V>>(() => new Map())
  return {
    pending,
    start: (id: string, value: V) => setPending((m) => new Map(m).set(id, value)),
    finish: (id: string) =>
      setPending((m) => {
        const next = new Map(m)
        next.delete(id)
        return next
      }),
  }
}

/** Заявки на вступление: принять или отклонить, свежие сверху. */
export function JoinRequestsScreen({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')
  const format = useFormatter()
  const qc = useQueryClient()
  const requests = useJoinRequests(chat, true)
  // Новая заявка, пришедшая по сокету, въезжает и коротко подсвечивается.
  const fresh = useFreshIds(useMemo(() => requests.data?.map((r) => r.id), [requests.data]))
  const rows = usePendingRows<boolean>()

  const decide = useMutation({
    mutationFn: ({ userId, accept }: { userId: string; accept: boolean; name: string }) =>
      accept ? approveJoinRequest(chat.id, userId) : declineJoinRequest(chat.id, userId),
    onMutate: ({ userId, accept }) => rows.start(userId, accept),
    onSuccess: (_d, { userId, accept, name }) => {
      // Решённая заявка уходит из списка сразу, не дожидаясь перечитывания.
      qc.setQueryData<JoinRequestRow[]>(groupKeys.joinRequests(chat.id), (old) =>
        old?.filter((r) => r.id !== userId),
      )
      void qc.invalidateQueries({ queryKey: groupKeys.joinRequests(chat.id) })
      if (accept) {
        void qc.invalidateQueries({ queryKey: chatKeys.members(chat.id) })
        void qc.invalidateQueries({ queryKey: chatKeys.list() })
      }
      toast.success(accept ? t('tgGroups.approved', { name }) : t('tgGroups.declined'))
    },
    onError: (e: unknown) => toast.error(tErr(errorCode(e))),
    onSettled: (_d, _e, { userId }) => rows.finish(userId),
  })

  if (requests.isLoading) return <PersonRowsSkeleton rows={4} />
  if (requests.isError && !requests.data) {
    return (
      <ManageEmpty
        icon={UserPlus}
        title={t('sharedLoadError')}
        action={
          <Button variant="outline" size="sm" onClick={() => void requests.refetch()}>
            <RotateCcw aria-hidden />
            {tCommon('retry')}
          </Button>
        }
      />
    )
  }
  const list = requests.data ?? []
  if (list.length === 0) {
    return (
      <ManageEmpty
        icon={UserPlus}
        title={t('tgGroups.joinRequestsEmpty')}
        hint={t('tgGroups.joinRequestsEmptyHint')}
      />
    )
  }
  return (
    <>
      <SectionTitle flush className="mt-3">
        {t('tgGroups.requestsCount', { count: list.length })}
      </SectionTitle>
      <ul>
        {list.map((r) => {
          const name = `${r.lastName} ${r.firstName}`.trim()
          const deciding = rows.pending.get(r.id)
          return (
            <li key={r.id} className={cn('px-4 py-2', PERSON_ROW, fresh.has(r.id) && 'sh-live-in')}>
              <ProfileLink userId={r.id} className="flex min-w-0 items-center gap-3">
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
              {/* Кнопки — второй строкой под именем (как в Telegram): в узкой колонке две
                  кнопки справа сжимали имя до двух букв. */}
              <div className="mt-2 flex gap-2 pl-14">
                <Button
                  size="sm"
                  className="flex-1"
                  loading={deciding === true}
                  disabled={deciding !== undefined}
                  onClick={() => decide.mutate({ userId: r.id, accept: true, name })}
                >
                  {t('tgGroups.approve')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  loading={deciding === false}
                  disabled={deciding !== undefined}
                  onClick={() => decide.mutate({ userId: r.id, accept: false, name })}
                >
                  {t('tgGroups.decline')}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/**
 * «Удалённые»: исключённые админом. Отдельно от заблокированных (те — на экране
 * «Заблокированные»): исключённый может вернуться по ссылке, и его можно вернуть отсюда.
 */
export function RemovedScreen({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')
  const format = useFormatter()
  const qc = useQueryClient()
  const removed = useQuery({
    queryKey: groupKeys.removed(chat.id),
    queryFn: () => fetchRemovedMembers(chat.id),
  })
  const fresh = useFreshIds(useMemo(() => removed.data?.map((r) => r.id), [removed.data]))
  const rows = usePendingRows<true>()
  const readd = useMutation({
    mutationFn: ({ userId }: { userId: string; name: string }) =>
      addChatMemberRequest(chat.id, userId),
    onMutate: ({ userId }) => rows.start(userId, true),
    onSuccess: (_d, { userId, name }) => {
      qc.setQueryData<RemovedMemberRow[]>(groupKeys.removed(chat.id), (old) =>
        old?.filter((r) => r.id !== userId),
      )
      void qc.invalidateQueries({ queryKey: groupKeys.removed(chat.id) })
      void qc.invalidateQueries({ queryKey: chatKeys.members(chat.id) })
      toast.success(t('tgGroups.readded', { name }))
    },
    onError: (e: unknown) => toast.error(tErr(errorCode(e))),
    onSettled: (_d, _e, { userId }) => rows.finish(userId),
  })

  if (removed.isLoading) return <PersonRowsSkeleton rows={4} />
  if (removed.isError && !removed.data) {
    return (
      <ManageEmpty
        icon={UserMinus}
        title={t('sharedLoadError')}
        action={
          <Button variant="outline" size="sm" onClick={() => void removed.refetch()}>
            <RotateCcw aria-hidden />
            {tCommon('retry')}
          </Button>
        }
      />
    )
  }
  const list = removed.data ?? []
  // Пусто — пояснение уходит в само пустое состояние: подпись сверху и пустота под ней
  // повторяли бы одно и то же.
  if (list.length === 0) {
    return (
      <ManageEmpty
        icon={UserMinus}
        title={t('tgGroups.removedEmpty')}
        hint={t('tgGroups.removedHint')}
      />
    )
  }
  return (
    <>
      <SectionTitle flush className="mt-3">
        {t('tgGroups.removedCount', { count: list.length })}
      </SectionTitle>
      <ul>
        {list.map((r) => {
          const name = `${r.lastName} ${r.firstName}`.trim()
          const by = r.removedBy ? `${r.removedBy.lastName} ${r.removedBy.firstName}`.trim() : null
          return (
            <li
              key={r.id}
              className={cn(
                'flex items-center gap-2 py-1.5 pr-2 pl-4',
                PERSON_ROW,
                fresh.has(r.id) && 'sh-live-in',
              )}
            >
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
                variant="ghost"
                icon
                loading={rows.pending.has(r.id)}
                onClick={() => readd.mutate({ userId: r.id, name })}
                aria-label={`${t('tgGroups.readd')}: ${name}`}
                title={t('tgGroups.readd')}
                className="text-primary"
              >
                <UserPlus aria-hidden />
              </Button>
            </li>
          )
        })}
      </ul>
      <CardHint flush>{t('tgGroups.removedHint')}</CardHint>
    </>
  )
}
