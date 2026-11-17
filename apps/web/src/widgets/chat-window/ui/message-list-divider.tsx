'use client'

import { useTranslations } from 'next-intl'

/**
 * Плашка «Непрочитанные сообщения» перед первым непрочитанным (Telegram). Пилюлей, как
 * пометка дня, но на акцентной подложке — чтобы не читалась как ещё одна дата. Чат с
 * непрочитанным открывается так, что плашка стоит у верхнего края ленты (chat-window).
 */
export function UnreadDivider() {
  const t = useTranslations('Chats')
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-full bg-primary/10 px-3 py-0.5 text-xs font-medium text-primary">
        {t('tgBehavior.unreadDivider')}
      </span>
    </div>
  )
}
