'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bell, Check, Loader2, Settings, Trash2, X } from 'lucide-react'
import { acceptFriendRequest, removeFriendship } from '../../../entities/friendship'
import {
  NOTIFICATION_TYPE_SETTINGS,
  fetchNotificationSettings,
  fetchNotifications,
  fetchUnreadCount,
  notificationKeys,
  updateNotificationSettings,
  useNotificationMutations,
  type NotificationItem,
  type NotificationSettingsData,
} from '../../../entities/notification'
import { useRealtimeEvent } from '../../../shared/realtime'
import { ensureNotifyPermission, maybeNotify } from '../../../shared/lib/browser-notify'
import { cn } from '../../../shared/lib/utils'

// Маппинг ключа настройки → i18n-ключ подписи (Notifications namespace).
const SETTING_LABEL: Record<string, string> = {
  scheduleChangeEnabled: 'typeScheduleChange',
  appUpdateEnabled: 'typeAppUpdate',
  messageEnabled: 'typeMessage',
  postEnabled: 'typePost',
  eventEnabled: 'typeEvent',
  systemEnabled: 'typeSystem',
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-2 text-sm">
      <span className="text-foreground">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white transition-all',
            checked ? 'left-[1.125rem]' : 'left-0.5',
          )}
        />
      </button>
    </label>
  )
}

export function NotificationsBell() {
  const t = useTranslations('Notifications')
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const containerRef = useRef<HTMLDivElement>(null)

  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'list' | 'settings'>('list')

  const unread = useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: fetchUnreadCount,
  })

  const list = useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () => fetchNotifications(20),
    enabled: open && view === 'list',
  })

  const settings = useQuery({
    queryKey: notificationKeys.settings(),
    queryFn: fetchNotificationSettings,
    enabled: open && view === 'settings',
  })

  // Живое обновление: новое уведомление → обновляем счётчик и список, показываем тост,
  // а при неактивной вкладке — системное уведомление браузера (#8).
  useRealtimeEvent<{ notification: NotificationItem }>('notification:new', (payload) => {
    void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() })
    void queryClient.invalidateQueries({ queryKey: notificationKeys.list() })
    toast.info(payload.notification.title, { description: payload.notification.body })
    maybeNotify(payload.notification.title, payload.notification.body)
  })

  // Разрешение на системные уведомления запрашиваем по жесту — при первом открытии колокольчика.
  useEffect(() => {
    if (open) void ensureNotifyPermission()
  }, [open])

  const invalidateAll = (): void => {
    void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() })
    void queryClient.invalidateQueries({ queryKey: notificationKeys.list() })
  }

  // Оптимистичные read / read-all / delete (общий хук entities/notification, §5.5):
  // UI меняется мгновенно, сеть — в фоне.
  const { readMutation, readAllMutation, deleteMutation } = useNotificationMutations()
  const settingsMutation = useMutation({
    mutationFn: (patch: Partial<NotificationSettingsData>) => updateNotificationSettings(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(notificationKeys.settings(), data)
    },
    onError: () => toast.error(t('settingsError')),
  })
  // Заявка в друзья — принять/отклонить прямо из уведомления. Сервер сам гасит это уведомление
  // (clearRequestNotification); при отклонении отправителю ничего не приходит.
  const acceptFriendMutation = useMutation({
    mutationFn: (friendshipId: string) => acceptFriendRequest(friendshipId),
    onSuccess: invalidateAll,
    onError: () => toast.error(t('friendRequestError')),
  })
  const declineFriendMutation = useMutation({
    mutationFn: (friendshipId: string) => removeFriendship(friendshipId),
    onSuccess: invalidateAll,
    onError: () => toast.error(t('friendRequestError')),
  })

  // Закрытие по клику вне.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const count = unread.data ?? 0
  const badge = count > 99 ? '99+' : String(count)

  function onItemClick(n: NotificationItem): void {
    if (!n.isRead) readMutation.mutate(n.id)
    const url = typeof n.data?.url === 'string' ? n.data.url : null
    if (url) {
      setOpen(false)
      router.push(url)
    }
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleString(locale, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={t('title')}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
          setView('list')
        }}
        className="relative flex size-10 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-5" aria-hidden />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-[1.125rem] items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-bold text-primary-foreground">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-background sm:w-96">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">
              {view === 'list' ? t('title') : t('settings')}
            </span>
            <div className="flex items-center gap-1">
              {view === 'list' ? (
                <>
                  <button
                    type="button"
                    onClick={() => readAllMutation.mutate()}
                    disabled={readAllMutation.isPending || count === 0}
                    aria-label={t('markAllRead')}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    <Check className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('settings')}
                    aria-label={t('settings')}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Settings className="size-4" aria-hidden />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-primary hover:underline"
                >
                  {t('back')}
                </button>
              )}
            </div>
          </div>

          {view === 'list' ? (
            <div className="max-h-96 overflow-y-auto">
              {list.isLoading ? (
                <div className="flex justify-center py-8 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                </div>
              ) : (list.data?.length ?? 0) === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {list.data?.map((n) => {
                    // Заявка в друзья с кнопками принять/отклонить прямо в уведомлении.
                    const friendshipId =
                      n.data && n.data.kind === 'friend-request'
                        ? String(n.data.friendshipId ?? '')
                        : ''
                    const busy = acceptFriendMutation.isPending || declineFriendMutation.isPending
                    return (
                      <li
                        key={n.id}
                        className={cn(
                          'group flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/50',
                          !n.isRead && 'bg-primary/5',
                        )}
                      >
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => onItemClick(n)}
                            className="min-w-0 flex-1 cursor-pointer text-left"
                          >
                            <div className="flex items-center gap-2">
                              {!n.isRead && (
                                <span
                                  className="size-2 shrink-0 rounded-full bg-primary"
                                  aria-hidden
                                />
                              )}
                              <span className="truncate text-sm font-medium">{n.title}</span>
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {n.body}
                            </p>
                            <span className="mt-1 block text-[0.65rem] text-muted-foreground">
                              {formatTime(n.createdAt)}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteMutation.mutate(n.id)}
                            aria-label={t('delete')}
                            className="flex size-7 shrink-0 cursor-pointer items-center justify-center self-start rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </button>
                        </div>
                        {friendshipId && (
                          <div className="flex gap-2 pl-0">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => acceptFriendMutation.mutate(friendshipId)}
                              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              <Check className="size-3.5" aria-hidden />
                              {t('acceptRequest')}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => declineFriendMutation.mutate(friendshipId)}
                              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                              <X className="size-3.5" aria-hidden />
                              {t('declineRequest')}
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto px-4 py-2">
              {settings.isLoading || !settings.data ? (
                <div className="flex justify-center py-8 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                </div>
              ) : (
                <>
                  <p className="pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase">
                    {t('channels')}
                  </p>
                  <Toggle
                    label={t('channelEmail')}
                    checked={settings.data.emailEnabled}
                    disabled={settingsMutation.isPending}
                    onChange={(v) => settingsMutation.mutate({ emailEnabled: v })}
                  />
                  <p className="pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase">
                    {t('types')}
                  </p>
                  {NOTIFICATION_TYPE_SETTINGS.map((key) => (
                    <Toggle
                      key={key}
                      label={t(SETTING_LABEL[key] ?? key)}
                      checked={settings.data[key]}
                      disabled={settingsMutation.isPending || key === 'systemEnabled'}
                      onChange={(v) => settingsMutation.mutate({ [key]: v })}
                    />
                  ))}
                  <p className="py-2 text-[0.65rem] text-muted-foreground">{t('systemHint')}</p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
