'use client'

import { useEffect } from 'react'

/** Страховка на случай, если `transitionend` не придёт: вкладка ушла в фон, стиль сменился. */
const CLOSE_FALLBACK_MS = 450

/**
 * Плавное закрытие группы <details>. Без разметки — только поведение.
 *
 * Открытие плавное и так: браузер показывает содержимое, и шторка (.sh-acc__body)
 * раскрывается переходом `grid-template-rows`. С закрытием так не выходит: снятие `open`
 * прячет содержимое в тот же кадр, и переходу просто нечего показывать. Поэтому клик по
 * заголовку открытого вопроса перехватывается: сначала шторка схлопывается (`.is-closing`),
 * и только когда переход закончился, снимается `open`.
 *
 * Общее имя `name` на время работы скрипта снимается, и эксклюзивность держит он сам.
 * Иначе браузер закрывал бы предыдущий вопрос мгновенно — ровно тот рывок, от которого
 * здесь и уходим. В разметке имя остаётся: без JavaScript аккордеон работает нативно.
 */
export function AccordionMotion({ group }: { group: string }) {
  useEffect(() => {
    const items = Array.from(
      document.querySelectorAll<HTMLDetailsElement>(`details[data-acc="${group}"]`),
    )
    if (items.length === 0) return

    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const pending = new Map<HTMLDetailsElement, () => void>()

    const finish = (item: HTMLDetailsElement) => {
      pending.get(item)?.()
      pending.delete(item)
    }

    const close = (item: HTMLDetailsElement) => {
      if (!item.open || pending.has(item)) return
      if (calm) {
        item.open = false
        return
      }

      const body = item.querySelector<HTMLElement>('.sh-acc__body')
      let timer = 0
      const onEnd = (e: TransitionEvent) => {
        if (e.target === body && e.propertyName === 'grid-template-rows') done()
      }
      const cleanup = () => {
        window.clearTimeout(timer)
        body?.removeEventListener('transitionend', onEnd)
        item.classList.remove('is-closing')
      }
      const done = () => {
        cleanup()
        pending.delete(item)
        item.open = false
      }

      body?.addEventListener('transitionend', onEnd)
      timer = window.setTimeout(done, CLOSE_FALLBACK_MS)
      pending.set(item, cleanup)
      item.classList.add('is-closing')
    }

    const onClick = (e: MouseEvent) => {
      const summary = (e.target as Element).closest('summary')
      const item = summary?.parentElement
      if (!(item instanceof HTMLDetailsElement) || !items.includes(item)) return
      e.preventDefault()

      if (pending.has(item)) {
        // Передумали посреди закрытия: шторка разворачивается обратно с того же места.
        finish(item)
      } else if (item.open) {
        close(item)
      } else {
        item.open = true
      }
    }

    // Эксклюзивность — по событию `toggle`, а не только по клику: вопрос открывают ещё
    // поиском по странице (Ctrl+F) и переходом по якорю.
    const onToggle = (e: Event) => {
      const item = e.target as HTMLDetailsElement
      if (!item.open) return
      items.forEach((other) => other !== item && close(other))
    }

    const names = items.map((item) => item.getAttribute('name'))
    items.forEach((item) => {
      item.removeAttribute('name')
      item.addEventListener('click', onClick)
      item.addEventListener('toggle', onToggle)
    })

    return () => {
      items.forEach((item, index) => {
        finish(item)
        item.removeEventListener('click', onClick)
        item.removeEventListener('toggle', onToggle)
        const name = names[index]
        if (name) item.setAttribute('name', name)
      })
    }
  }, [group])

  return null
}
