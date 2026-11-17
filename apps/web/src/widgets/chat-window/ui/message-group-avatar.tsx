'use client'

import { useLayoutEffect, useRef } from 'react'
import type { ChatMessage } from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import { identityColor } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

/**
 * Аватар автора серии в группе (Telegram): стоит у нижнего сообщения серии и «прилипает» к
 * низу ленты, пока серия длиннее экрана, — листая длинный монолог, всё время видно, чей он.
 *
 * Лента виртуализирована (virtua): каждое сообщение — отдельный элемент, обернуть серию
 * общим контейнером нельзя. Поэтому у последнего сообщения стоит прозрачная колонка, которая
 * тянется вверх до первого сообщения серии, а аватар внутри неё — `position: sticky`.
 * Высоту колонки и отступ от низа (над плавающей панелью ввода) пишем прямо в стиль, без
 * перерисовки React. Первое сообщение серии выгружено виртуализацией — значит, оно далеко
 * выше экрана, и колонка просто тянется вверх с запасом.
 */
export function MessageGroupAvatar({
  sender,
  runStartId,
}: {
  sender: ChatMessage['sender']
  /** id первого сообщения серии; нет — серия из одного сообщения. */
  runStartId: string | undefined
}) {
  const slotRef = useRef<HTMLSpanElement>(null)
  const columnRef = useRef<HTMLSpanElement>(null)
  const stickRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const slot = slotRef.current
    const column = columnRef.current
    const stick = stickRef.current
    if (!slot || !column || !stick) return
    const scroller = scrollParentOf(slot)
    if (!scroller) return
    let frame = 0
    const update = (): void => {
      frame = 0
      // Низ ленты прикрыт плавающей панелью ввода: лента держит под ней отступ снизу.
      const inset = parseFloat(getComputedStyle(scroller).paddingBottom) || 0
      stick.style.bottom = `${inset}px`
      if (!runStartId) return
      const first = document.getElementById(`msg-${runStartId}`)
      const top = first
        ? first.getBoundingClientRect().top - slot.getBoundingClientRect().top
        : -scroller.scrollHeight
      column.style.top = `${Math.min(0, top)}px`
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    // Серия меняет высоту (догрузились снимки, пришло сообщение, сменилась высота панели
    // ввода) — пересчёт по изменению размеров; при прокрутке первое сообщение серии может
    // появиться или выгрузиться — пересчёт по прокрутке.
    const ro = new ResizeObserver(schedule)
    ro.observe(scroller)
    if (scroller.firstElementChild) ro.observe(scroller.firstElementChild)
    scroller.addEventListener('scroll', schedule, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      ro.disconnect()
      scroller.removeEventListener('scroll', schedule)
    }
  }, [runStartId])

  return (
    <span ref={slotRef} className="relative w-8 shrink-0 self-stretch">
      <span
        ref={columnRef}
        className="pointer-events-none absolute inset-x-0 top-0 bottom-0 flex flex-col justify-end"
      >
        <span ref={stickRef} className="pointer-events-auto sticky bottom-0">
          <ProfileLink userId={sender.id} className="block rounded-full">
            <Avatar className="size-8">
              {sender.avatarUrl && <AvatarImage src={sender.avatarUrl} alt="" />}
              <AvatarFallback
                className={cn('text-xs font-medium text-white', identityColor(sender.id))}
              >
                {(sender.lastName[0] ?? '') + (sender.firstName[0] ?? '')}
              </AvatarFallback>
            </Avatar>
          </ProfileLink>
        </span>
      </span>
    </span>
  )
}
