'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { MessageReaction } from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { Avatar, AvatarFallback, AvatarImage, Modal, SegmentedTabs } from '../../../shared/ui'
import { groupReactions, reactorName } from './reactions-strip'

const ALL = 'all'

interface Reactor {
  user: MessageReaction['user']
  emojis: string[]
}

/**
 * Кто отреагировал на сообщение (Telegram: «N реакций» в меню сообщения, правый клик по
 * чипу). Список целиком приходит в самом сообщении — отдельного запроса не нужно, а живые
 * реакции из `message:reaction` обновляют окно на месте, потому что оно читает сообщение
 * из ленты, а не свой снимок.
 *
 * Вкладки по эмодзи — когда видов больше одного: «Все» с человеком и всеми его реакциями,
 * и по вкладке на эмодзи. Строка ведёт в профиль, как имя автора в пузыре.
 */
export function ReactionsListModal({
  reactions,
  myId,
  initialEmoji,
  onClose,
}: {
  reactions: readonly MessageReaction[]
  myId: string | undefined
  initialEmoji?: string | null
  onClose: () => void
}) {
  const t = useTranslations('Chats')
  const groups = useMemo(() => groupReactions(reactions, myId), [reactions, myId])
  const [tab, setTab] = useState<string>(
    initialEmoji && groups.some((g) => g.emoji === initialEmoji) ? initialEmoji : ALL,
  )
  // Реакцию сняли, пока окно открыто, — вкладки больше нет, показываем всех.
  const active = tab === ALL || groups.some((g) => g.emoji === tab) ? tab : ALL

  const rows = useMemo<Reactor[]>(() => {
    const byUser = new Map<string, Reactor>()
    for (const r of reactions) {
      if (active !== ALL && r.emoji !== active) continue
      const row = byUser.get(r.userId) ?? { user: r.user, emojis: [] }
      row.emojis.push(r.emoji)
      byUser.set(r.userId, row)
    }
    return [...byUser.values()]
  }, [reactions, active])

  return (
    <Modal
      onClose={onClose}
      title={t('tgBehavior.reactorsTitle', { count: reactions.length })}
      size="md"
      bodyClassName="flex min-h-0 flex-col p-0"
    >
      {groups.length > 1 && (
        <div className="border-b border-border px-3 py-2">
          <SegmentedTabs
            compact
            collapsible={false}
            aria-label={t('tgBehavior.reactorsFilter')}
            value={active}
            onChange={setTab}
            items={[
              { value: ALL, label: t('tgBehavior.reactorsAll'), count: reactions.length },
              ...groups.map((g) => ({ value: g.emoji, label: g.emoji, count: g.count })),
            ]}
          />
        </div>
      )}
      <ul className="flex max-h-[min(60vh,28rem)] flex-col overflow-y-auto p-2">
        {rows.map((row) => (
          <li key={row.user.id}>
            <ProfileLink
              userId={row.user.id}
              onClick={onClose}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40"
            >
              <Avatar className="size-9">
                {row.user.avatarUrl && <AvatarImage src={row.user.avatarUrl} alt="" />}
                <AvatarFallback>
                  {(row.user.lastName[0] ?? '') + (row.user.firstName[0] ?? '')}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {reactorName(row.user)}
              </span>
              <span className="shrink-0 text-lg leading-none" aria-hidden>
                {row.emojis.join('')}
              </span>
              <span className="sr-only">{row.emojis.join(' ')}</span>
            </ProfileLink>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
