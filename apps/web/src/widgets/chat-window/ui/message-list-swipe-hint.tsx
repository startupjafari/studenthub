'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Reply } from 'lucide-react'

/**
 * Значок «Ответить», который проступает справа от сообщения, пока его тянут пальцем влево
 * (Telegram). Управляется императивно из обработчика касания: жест идёт каждый кадр, и
 * состояние React на каждый сдвиг перерисовывало бы всё окно чата.
 */
export interface SwipeReplyHintHandle {
  /** `shift` — текущий сдвиг пузыря (отрицательный), `threshold` — порог ответа. */
  update: (bubble: HTMLElement, shift: number, threshold: number) => void
  hide: () => void
}

const SIZE = 32
const GAP = 12

export const MessageListSwipeHint = forwardRef<SwipeReplyHintHandle>(
  function MessageListSwipeHint(_props, ref) {
    const el = useRef<HTMLDivElement>(null)
    // Порталом в body: `fixed` внутри предка с transform (анимация входа чата) считался бы
    // от предка, а не от экрана.
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    useImperativeHandle(ref, () => ({
      update(bubble, shift, threshold) {
        const node = el.current
        if (!node) return
        const pulled = Math.max(0, -shift)
        if (pulled === 0) {
          node.style.opacity = '0'
          return
        }
        const r = bubble.getBoundingClientRect()
        // Значок идёт следом за пузырём и останавливается у его прежнего правого края —
        // в освободившемся месте, по центру пузыря по высоте.
        const left = Math.max(r.right + GAP / 2, r.right + pulled - SIZE)
        const top = r.top + r.height / 2 - SIZE / 2
        const progress = Math.min(1, pulled / threshold)
        node.style.transform = `translate(${left}px, ${top}px) scale(${0.6 + 0.4 * progress})`
        node.style.opacity = String(progress)
        node.dataset.reached = pulled >= threshold ? 'true' : 'false'
      },
      hide() {
        const node = el.current
        if (!node) return
        node.style.opacity = '0'
        node.dataset.reached = 'false'
      },
    }))

    if (!mounted) return null
    return createPortal(
      <div
        ref={el}
        aria-hidden
        data-reached="false"
        className="pointer-events-none fixed top-0 left-0 z-50 flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground opacity-0 shadow-sm transition-[background-color,color] data-[reached=true]:bg-primary data-[reached=true]:text-primary-foreground"
      >
        <Reply className="size-4" />
      </div>,
      document.body,
    )
  },
)
