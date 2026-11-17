'use client'

import { createContext, useContext } from 'react'
import { useRouter } from 'next/navigation'
import { useBackClose } from '../../../shared/lib'

/**
 * Переход со страницы из правой колонки чата (§55): профиль участника из меню, ссылка в
 * сведениях. Колонка держит запись в истории (системная «назад» закрывает её, а не уводит
 * со страницы), и переход «как есть» через `router.push` откатывал бы адрес: Next переносит
 * метку колонки в новую запись, а снятие записи при закрытии колонки принимает её за свою
 * (память проекта «Modal + router.push»). Поэтому колонка подставляет свой переход —
 * «закрыть, дождаться снятия записи, перейти» (afterOverlayClose).
 */
const ColumnNavigateContext = createContext<((href: string) => void) | null>(null)

export const ColumnNavigateProvider = ColumnNavigateContext.Provider

/** Переход из колонки; вне колонки — обычный `router.push`. */
export function useColumnNavigate(): (href: string) => void {
  const router = useRouter()
  const navigate = useContext(ColumnNavigateContext)
  return navigate ?? ((href: string) => router.push(href))
}

/** Пока смонтирован — системная «назад» закрывает колонку (запись-пустышка в истории). */
export function ColumnBackClose({ onClose }: { onClose: () => void }): null {
  useBackClose(onClose)
  return null
}

/**
 * Ссылка внутри колонки, которую надо увести через закрытие колонки: внутренняя, обычный
 * клик левой кнопкой без модификаторов, без `target` и `download`. Остальное (новая вкладка,
 * внешний сайт, скачивание) браузер делает сам — история колонки тут ни при чём.
 */
export function interceptableHref(e: React.MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0) return null
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null
  const anchor = (e.target as Element | null)?.closest?.('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return null
  if (anchor.target && anchor.target !== '_self') return null
  if (anchor.hasAttribute('download')) return null
  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin) return null
  // Тот же адрес — переход ничего не меняет, колонку закрывать незачем.
  if (url.pathname === window.location.pathname && url.search === window.location.search) {
    return null
  }
  return `${url.pathname}${url.search}${url.hash}`
}
