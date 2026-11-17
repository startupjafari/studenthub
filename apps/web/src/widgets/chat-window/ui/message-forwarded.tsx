'use client'

import { useTranslations } from 'next-intl'
import { Forward } from 'lucide-react'
import type { MessageForwardOrigin } from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { identityAccent } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

/**
 * Заголовок «Переслано от» (Telegram): над содержимым пузыря, имя исходного автора — его
 * цветом и ссылкой на профиль (ProfileLink чтит приватность, §8). На своём пузыре — цветом
 * текста пузыря: цвет человека на синем нечитаем.
 */
export function MessageForwarded({
  origin,
  name,
  mine,
}: {
  origin: MessageForwardOrigin
  name: string | null
  mine: boolean
}) {
  const t = useTranslations('Chats')
  const accent = identityAccent(origin.senderId)
  return (
    <ProfileLink
      userId={origin.senderId}
      className={cn(
        'mb-0.5 flex min-w-0 items-center gap-1 text-[0.8125rem] leading-snug',
        mine ? 'text-primary-foreground/90' : accent.text,
      )}
    >
      <Forward className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        {t.rich('tgBubbles.forwardedFrom', {
          name: name ?? '',
          b: (chunks) => <span className="font-semibold">{chunks}</span>,
        })}
      </span>
    </ProfileLink>
  )
}
