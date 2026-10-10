'use client'

import { useEffect } from 'react'

// Блокировка прокрутки фона, пока открыт overlay (модалка/шторка/лайтбокс).
// Reference-counting: вложенные overlay'и (напр. меню внутри group-info) не разблокируют
// фон преждевременно — снимаем блок только когда закрылся последний.
// Техника position:fixed + сохранение/восстановление scrollY надёжна на iOS Safari, где
// одного overflow:hidden недостаточно (страница всё равно «резинит»/скроллится под модалкой).

let lockCount = 0
let savedScrollY = 0
let selectionCount = 0

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

// Запрет выделения на всей странице. Считается отдельно от прокрутки: нужен не всякому
// оверлею (см. параметр lockSelection ниже).
function applySelection(): void {
  const { style } = document.body
  style.userSelect = 'none'
  // Safari до 18 не знает нестафиксованного свойства — без вендорного там выделение остаётся.
  style.webkitUserSelect = 'none'
}

function restoreSelection(): void {
  const { style } = document.body
  style.userSelect = ''
  style.webkitUserSelect = ''
}

/**
 * Блокирует прокрутку body, пока active=true и компонент смонтирован.
 *
 * `lockSelection` вдобавок запрещает выделение текста на всей странице.
 *
 * Зачем отдельный флаг, а не всегда. `select-none` на самом оверлее от этого не спасает,
 * а ровно его и вызывает: браузер, пропустив невыделяемый верхний слой, начинает выделять
 * то, что ПОД ним. Протаскиваешь мышью по открытому просмотрщику — и в фоне синим
 * подсвечивается вся страница: сайдбар, вкладки, кнопки. Фон в этот момент не кликается и
 * не виден, выделять там нечего.
 *
 * Поэтому флаг поднимают перетаскиваемые оверлеи — просмотрщик, лайтбокс, редактор
 * изображения, контекстные меню. Оверлеям с читаемым текстом (статья профиля) выделение
 * оставляем: оттуда копируют.
 */
export function useBodyScrollLock(active = true, lockSelection = false): void {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) apply()
    lockCount += 1
    if (lockSelection) {
      if (selectionCount === 0) applySelection()
      selectionCount += 1
    }
    return () => {
      lockCount = Math.max(0, lockCount - 1)
      if (lockCount === 0) restore()
      if (lockSelection) {
        selectionCount = Math.max(0, selectionCount - 1)
        if (selectionCount === 0) restoreSelection()
      }
    }
  }, [active, lockSelection])
}
