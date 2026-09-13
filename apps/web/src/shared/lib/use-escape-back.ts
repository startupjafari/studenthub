'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/**
 * Esc возвращает на предыдущий экран.
 *
 * Ожидание «Esc = назад» человек приносит из десктопных программ, и на вложенных экранах
 * (карточка вакансии, настройки, вкладка раздела) искать кнопку «назад» глазами не нужно.
 *
 * Esc — клавиша перегруженная, поэтому право на неё уступается по очереди:
 *   1) открытый слой (диалог, меню, поповер, просмотр медиа) — Esc закрывает его;
 *   2) фокус в поле ввода — Esc выводит из поля, но со страницы не уводит;
 *   3) всё остальное — переход назад.
 *
 * Договорённость для слоёв: обработал Esc — вызови `preventDefault()`. Порядок слушателей
 * тут не помощник: этот хук подписывается при старте приложения, то есть РАНЬШЕ любой
 * панели, и без договорённости панель закрывалась бы, а страница тем же нажатием уезжала
 * назад. Поэтому решение о переходе откладывается на макрозадачу — к ней все остальные
 * слушатели уже отработали и успели пометить событие.
 *
 * Радиксовые слои `preventDefault` не зовут, поэтому у них есть второй признак — узел в
 * DOM (`role="dialog"`, обёртка поппера). Его снимаем СИНХРОННО, до размонтирования:
 * в макрозадаче закрытая панель со страницы уже исчезнет.
 */

/** Признаки открытого слоя: role диалога (radix, свои модалки), попперы radix, свой маркер. */
const OVERLAY_SELECTOR =
  '[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper],[data-overlay]'

function isEditable(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA'
}

export function useEscapeBack(): void {
  const router = useRouter()
  const pathname = usePathname()
  // Был ли хоть один переход внутри приложения. Без этого Esc на странице, открытой прямой
  // ссылкой, уводил бы из приложения совсем — в поисковую выдачу или пустую вкладку.
  const navigated = useRef(false)
  const entry = useRef(pathname)

  useEffect(() => {
    if (pathname !== entry.current) navigated.current = true
  }, [pathname])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // Esc с модификатором — не наш случай: это сочетание, а не отмена.
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      // Снимок до того, как слой успеет размонтироваться.
      const hadOverlay = document.querySelector(OVERLAY_SELECTOR) !== null

      const active = document.activeElement
      if (isEditable(active)) {
        active.blur()
        return
      }

      setTimeout(() => {
        // Слой был открыт или кто-то уже обработал нажатие — страница остаётся на месте.
        if (hadOverlay || event.defaultPrevented) return
        if (!navigated.current || window.history.length <= 1) return
        router.back()
      }, 0)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router])
}
