'use client'

import { useLayoutEffect, useRef } from 'react'
import type { ChatMessage } from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import { identityColor } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

/** Атрибут прокручиваемой ленты сообщений: по нему аватар находит её без чтения стилей. */
export const MESSAGE_SCROLLER_ATTR = 'data-message-scroller'

function scrollParentOf(el: HTMLElement): HTMLElement | null {
  // Обычный случай — лента чата помечена атрибутом. Обход предков с getComputedStyle
  // пересчитывал стили на каждом смонтированном аватаре: при подгрузке страницы истории
  // это десятки принудительных пересчётов подряд.
  const marked = el.closest<HTMLElement>(`[${MESSAGE_SCROLLER_ATTR}]`)
  if (marked) return marked
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

// Общая очередь замеров всех аватаров: сначала все читают геометрию, затем все пишут стили —
// одна раскладка на пачку вместо одной на аватар.
type Measure = () => () => void
const queued = new Set<Measure>()
let commitQueued = false
let frameQueued = 0

function flushMeasures(): void {
  commitQueued = false
  if (frameQueued) cancelAnimationFrame(frameQueued)
  frameQueued = 0
  const jobs = [...queued]
  queued.clear()
  const writes = jobs.map((measure) => measure())
  for (const write of writes) write()
}

function scheduleMeasure(measure: Measure, when: 'commit' | 'frame'): void {
  queued.add(measure)
  if (when === 'commit') {
    if (!commitQueued) {
      commitQueued = true
      queueMicrotask(flushMeasures)
    }
  } else if (!frameQueued && !commitQueued) {
    frameQueued = requestAnimationFrame(flushMeasures)
  }
}

function cancelMeasure(measure: Measure): void {
  queued.delete(measure)
}

/**
 * Аватар автора серии в группе (Telegram): стоит у нижнего сообщения серии и «прилипает» к
 * низу ленты, пока серия длиннее экрана, — листая длинный монолог, всё время видно, чей он.
 *
 * Лента — окно строк (MessageWindow): каждое сообщение — отдельный элемент, обернуть серию
 * общим контейнером нельзя. Поэтому у последнего сообщения стоит прозрачная колонка, которая
 * тянется вверх до первого сообщения серии, а аватар внутри неё — `position: sticky`.
 * Высоту колонки и отступ от низа (над плавающей панелью ввода) пишем прямо в стиль, без
 * перерисовки React. Первое сообщение серии за краем окна — значит, оно далеко выше экрана,
 * и колонка просто тянется вверх с запасом.
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
    // Чтение геометрии отдельно от записи стилей: аватаров в окне десятки, и пересчитывались
    // они все разом (смонтировалась страница истории, сменилась высота ленты). Чередование
    // «прочитал — записал» у каждого заставляло браузер раскладывать ленту заново на каждом.
    const measure = (): (() => void) => {
      // Низ ленты прикрыт плавающей панелью ввода: лента держит под ней отступ снизу.
      const inset = parseFloat(getComputedStyle(scroller).paddingBottom) || 0
      let top: number | null = null
      if (runStartId) {
        const first = document.getElementById(`msg-${runStartId}`)
        top = first
          ? first.getBoundingClientRect().top - slot.getBoundingClientRect().top
          : -scroller.scrollHeight
      }
      return () => {
        stick.style.bottom = `${inset}px`
        if (top !== null) column.style.top = `${Math.min(0, top)}px`
      }
    }
    // Первый замер — до отрисовки (микрозадача после коммита), вместе со всеми аватарами,
    // смонтированными этим же коммитом.
    scheduleMeasure(measure, 'commit')
    // Пересчёт — только по изменению размеров: догрузились снимки, пришло сообщение, окно
    // ленты добавило или выгрузило строки (меняется высота содержимого), сменилась высота
    // панели ввода. Прокрутка расстояние между аватаром и первым сообщением серии не меняет —
    // оба едут вместе, — а обработчик прокрутки у каждого аватара читал раскладку на кадре.
    const ro = new ResizeObserver(() => scheduleMeasure(measure, 'frame'))
    ro.observe(scroller)
    if (scroller.firstElementChild) ro.observe(scroller.firstElementChild)
    return () => {
      cancelMeasure(measure)
      ro.disconnect()
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
