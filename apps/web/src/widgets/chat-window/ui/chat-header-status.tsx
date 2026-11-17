'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { cn } from '../../../shared/lib/utils'
import { othersOnlineCount, usePresence, type PresenceStore } from '../lib/presence-store'

/**
 * Подпись под названием чата (Telegram: «в сети», «был(а) недавно», «12 участников,
 * 3 в сети», «печатает…»).
 *
 * Отдельным компонентом ради перерисовок: присутствие и время «был(а) N мин назад»
 * меняются сами по себе, и пусть от этого перерисовывается одна строка, а не окно чата
 * вместе с лентой (F-F12).
 */
export function ChatHeaderStatus({
  kind,
  actionLabel,
  peerOnline,
  peerLastSeenAt,
  memberCount,
  store,
  myId,
}: {
  kind: 'private' | 'group' | 'saved'
  /** «печатает…», «записывает голосовое…» — важнее любого статуса. */
  actionLabel: string | null
  peerOnline: boolean
  /** Когда собеседник ушёл из сети (§49); null — сервер не знает. */
  peerLastSeenAt: string | null
  memberCount: number
  store: PresenceStore
  myId?: string
}) {
  if (actionLabel) return <ChatActionStatus label={actionLabel} />
  if (kind === 'saved') return null
  if (kind === 'private') return <PeerStatus online={peerOnline} lastSeenAt={peerLastSeenAt} />
  return <GroupStatus memberCount={memberCount} store={store} myId={myId} />
}

/**
 * Действие собеседника с бегущими точками. Многоточие в конце перевода заменяется
 * анимированным: две точки рядом читались бы как опечатка.
 */
function ChatActionStatus({ label }: { label: string }) {
  const text = label.replace(/(…|\.\.\.)\s*$/, '')
  return (
    <span className="flex min-w-0 items-baseline text-primary" aria-live="polite">
      <span className="truncate">{text}</span>
      <TypingDots />
    </span>
  )
}

/**
 * Три точки, загорающиеся по очереди. Декоративные: смысл уже сказан текстом, поэтому
 * скрыты от чтения с экрана, а при `prefers-reduced-motion` стоят неподвижно.
 */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span
      className={cn('ml-0.5 inline-flex shrink-0 items-end gap-0.5 pb-1', className)}
      aria-hidden
    >
      {['delay-0', 'delay-150', 'delay-300'].map((delay) => (
        <span
          key={delay}
          className={cn(
            'size-1 rounded-full bg-current',
            'animate-in fade-in-0 repeat-infinite direction-alternate duration-(--motion-large) ease-in-out motion-reduce:animate-none',
            delay,
          )}
        />
      ))}
    </span>
  )
}

/** Как часто пересчитывать «был(а) N мин назад», пока подпись на экране. */
const LAST_SEEN_TICK_MS = 30_000

function PeerStatus({ online, lastSeenAt }: { online: boolean; lastSeenAt: string | null }) {
  const t = useTranslations('Chats')
  // Время — по часам браузера, как у сообщений в ленте (listTime), а не по поясу вуза.
  const locale = useLocale()
  const [now, setNow] = useState(() => Date.now())
  // Собеседник вышел из сети у нас на глазах: сервер пришлёт новое время ухода только со
  // следующим списком участников, а «был(а) только что» правда уже сейчас.
  // Состояние подправляется прямо в рендере (а не эффектом): иначе один кадр показывал бы
  // старое «был(а) вчера» у человека, который вышел секунду назад.
  const [seenLocally, setSeenLocally] = useState<{ online: boolean; at: number | null }>({
    online,
    at: null,
  })
  if (seenLocally.online !== online) setSeenLocally({ online, at: online ? null : Date.now() })

  useEffect(() => {
    if (online) return
    const id = window.setInterval(() => setNow(Date.now()), LAST_SEEN_TICK_MS)
    return () => window.clearInterval(id)
  }, [online])

  if (online) return <span className="truncate text-primary">{t('online')}</span>

  const seenMs = Math.max(seenLocally.at ?? 0, lastSeenAt ? new Date(lastSeenAt).getTime() : 0)
  let text: string
  if (!seenMs) {
    text = t('tgHeader.lastSeenRecently')
  } else {
    const min = Math.floor((now - seenMs) / 60_000)
    const seen = new Date(seenMs)
    const time = seen.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    if (min < 1) text = t('lastSeenNow')
    else if (min < 60) text = t('lastSeenMin', { count: min })
    else if (isSameDay(seen, new Date(now))) text = t('tgHeader.lastSeenToday', { time })
    else if (isSameDay(seen, new Date(now - 86_400_000)))
      text = t('tgHeader.lastSeenYesterday', { time })
    else
      text = t('tgHeader.lastSeenDate', {
        date: seen.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: '2-digit' }),
      })
  }
  return <span className="truncate">{text}</span>
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** «12 участников, 3 в сети» — себя в «в сети» не считаем, как Telegram. */
function GroupStatus({
  memberCount,
  store,
  myId,
}: {
  memberCount: number
  store: PresenceStore
  myId?: string
}) {
  const t = useTranslations('Chats')
  const online = usePresence(store, (m) => othersOnlineCount(m, myId))
  const members = t('groupMembersCount', { count: memberCount })
  return (
    <span className="truncate">
      {online > 0 ? t('tgHeader.groupStatus', { members, online }) : members}
    </span>
  )
}
