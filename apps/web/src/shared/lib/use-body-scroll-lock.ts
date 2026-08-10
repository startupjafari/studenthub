'use client'

import { useEffect } from 'react'

// Блокировка прокрутки фона, пока открыт overlay (модалка/шторка/лайтбокс).
// Reference-counting: вложенные overlay'и (напр. меню внутри group-info) не разблокируют
// фон преждевременно — снимаем блок только когда закрылся последний.
// Техника position:fixed + сохранение/восстановление scrollY надёжна на iOS Safari, где
// одного overflow:hidden недостаточно (страница всё равно «резинит»/скроллится под модалкой).

let lockCount = 0
let savedScrollY = 0

function apply(): void {
  savedScrollY = window.scrollY
  const { style } = document.body
  style.position = 'fixed'
  style.top = `-${savedScrollY}px`
  style.left = '0'
  style.right = '0'
  style.width = '100%'
  style.overflow = 'hidden'
}

function restore(): void {
  const { style } = document.body
  style.position = ''
  style.top = ''
  style.left = ''
  style.right = ''
  style.width = ''
  style.overflow = ''
  window.scrollTo(0, savedScrollY)
}

/** Блокирует прокрутку body, пока active=true и компонент смонтирован. */
export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) apply()
    lockCount += 1
    return () => {
      lockCount = Math.max(0, lockCount - 1)
      if (lockCount === 0) restore()
    }
  }, [active])
}
