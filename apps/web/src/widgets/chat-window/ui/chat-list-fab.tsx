'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MessageSquarePlus, Pencil, Users, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../shared/ui'
import { useMediaQuery } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

/**
 * Плавающая кнопка «Новое сообщение» в углу списка чатов — как в Telegram Web.
 *
 * Нажатие раскрывает меню: «Новое сообщение» (поиск человека тем же полем, где ищут чаты —
 * отдельного окна выбора собеседника у нас нет) и «Новая группа». Карандаш на время меню
 * превращается в крестик.
 *
 * На ПК кнопка выезжает снизу, только пока курсор над колонкой (или фокус внутри неё): в
 * покое список чист, а под рукой кнопка ровно тогда, когда человек в списке. На тач-экране
 * наводить нечем — там она видна всегда и стоит над нижней навигацией.
 *
 * Выезд — декоративное движение: токен `--motion-panel`, без перехода при reduced-motion.
 */
export function ChatListFab({
  hidden,
  peek,
  embedded,
  onNewMessage,
  onNewGroup,
}: {
  /** Поиск или архив на экране — кнопке там делать нечего. */
  hidden: boolean
  /** Курсор над колонкой или фокус внутри неё — на ПК кнопка выезжает только тогда. */
  peek: boolean
  /** Список в сайдбаре ПК: нижней навигации нет, кнопка у самого края. */
  embedded: boolean
  onNewMessage: () => void
  onNewGroup: () => void
}) {
  const t = useTranslations('Chats')
  const [open, setOpen] = useState(false)
  // Выбранное действие запускаем, когда меню уже закрылось: иначе Radix вернул бы фокус на
  // кнопку и увёл его из поля поиска, которое «Новое сообщение» только что открыло.
  const pendingRef = useRef<(() => void) | null>(null)
  // Есть ли чем наводить: на тач-экране «по наведению» не наступит никогда.
  const hover = useMediaQuery('(hover: hover) and (pointer: fine)')
  const revealed = open || (!hidden && (!hover || peek))
  return (
    <div
      className={cn(
        'pointer-events-none absolute right-4 z-20 transition-[translate,opacity] duration-(--motion-panel) motion-reduce:transition-none',
        embedded ? 'bottom-4' : 'bottom-[calc(5rem+env(safe-area-inset-bottom))]',
        revealed ? 'opacity-100' : 'translate-y-24 opacity-0',
      )}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={open ? t('tgList.fabClose') : t('tgList.fabNew')}
            tabIndex={revealed ? 0 : -1}
            className={cn(
              'pointer-events-auto relative flex size-14 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 active:scale-95',
              !revealed && 'pointer-events-none',
            )}
          >
            <Pencil
              className={cn(
                'absolute size-6 transition-[rotate,scale,opacity] duration-(--motion-control) motion-reduce:transition-none',
                open ? 'rotate-90 scale-50 opacity-0' : 'opacity-100',
              )}
              aria-hidden
            />
            <X
              className={cn(
                'absolute size-6 transition-[rotate,scale,opacity] duration-(--motion-control) motion-reduce:transition-none',
                open ? 'opacity-100' : '-rotate-90 scale-50 opacity-0',
              )}
              aria-hidden
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-56"
          onCloseAutoFocus={(e) => {
            const run = pendingRef.current
            if (!run) return
            pendingRef.current = null
            e.preventDefault()
            run()
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              pendingRef.current = onNewMessage
            }}
          >
            <MessageSquarePlus aria-hidden />
            {t('tgList.newMessage')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              pendingRef.current = onNewGroup
            }}
          >
            <Users aria-hidden />
            {t('newGroup')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
