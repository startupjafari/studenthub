'use client'

import { useSearchParams } from 'next/navigation'
import type { ContentOwner, ProfileArticle } from '../api/profile-content-api'

/**
 * Окно статьи поверх страницы. Отдельных страниц у статьи нет: читают, пишут и правят её в
 * окне, а его состояние живёт в адресе — `?article=<id>` (чтение), `?article=<id>&edit=1`
 * (правка), `?article=new[&as=company|university]` (новая). Ссылку можно переслать и открыть
 * в новой вкладке, «назад» закрывает окно.
 *
 * Адрес меняется нативным `history.pushState`/`replaceState`: Next синхронизирует их с
 * `useSearchParams` без запроса страницы к серверу — окно открывается сразу.
 */
export type ArticleWindowState =
  | { mode: 'read'; id: string }
  | { mode: 'edit'; id: string }
  | { mode: 'new'; as: ContentOwner['kind'] }

const PARAM = 'article'
const EDIT = 'edit'
const AS = 'as'
const NEW = 'new'

function parse(params: { get: (key: string) => string | null }): ArticleWindowState | null {
  const value = params.get(PARAM)
  if (!value) return null
  if (value === NEW) {
    const as = params.get(AS)
    return { mode: 'new', as: as === 'company' || as === 'university' ? as : 'user' }
  }
  return params.get(EDIT) ? { mode: 'edit', id: value } : { mode: 'read', id: value }
}

/** Адрес `pathname` с окном статьи; `search` — прочие параметры страницы, они сохраняются. */
export function articleWindowHref(
  pathname: string,
  state: ArticleWindowState | null,
  search = '',
): string {
  const params = new URLSearchParams(search)
  params.delete(PARAM)
  params.delete(EDIT)
  params.delete(AS)
  if (state) {
    params.set(PARAM, state.mode === 'new' ? NEW : state.id)
    if (state.mode === 'edit') params.set(EDIT, '1')
    if (state.mode === 'new' && state.as !== 'user') params.set(AS, state.as)
  }
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

/** Адрес текущей страницы с окном (без якоря раздела — он относится к прежней статье). */
function hereWith(state: ArticleWindowState | null): string {
  return articleWindowHref(window.location.pathname, state, window.location.search)
}

/**
 * Состояние истории без служебных полей Next: с ними `pushState`/`replaceState` идут мимо
 * роутера, и `useSearchParams` новый адрес не увидел бы. Свои поля (метки окон
 * `useBackClose`) сохраняются.
 */
function ownHistoryState(): Record<string, unknown> | null {
  const state = window.history.state as Record<string, unknown> | null
  if (!state) return null
  const own = Object.fromEntries(
    Object.entries(state).filter(([key]) => key !== '__NA' && !key.startsWith('__PRIVATE_')),
  )
  return Object.keys(own).length > 0 ? own : null
}

// Положило ли окно свою запись в историю. Тогда закрытие — шаг назад (снимает её), иначе
// окно открыли по ссылке, и закрытие заменяет адрес: «назад» из приложения не уводит.
let pushed = false

/** Открыть окно новой записью истории — «назад» его закроет. */
export function openArticleWindow(state: ArticleWindowState): void {
  pushed = true
  window.history.pushState(null, '', hereWith(state))
}

/** Сменить содержимое открытого окна на месте: чтение ↔ правка, другая статья. */
export function replaceArticleWindow(state: ArticleWindowState): void {
  window.history.replaceState(ownHistoryState(), '', hereWith(state))
}

export function closeArticleWindow(): void {
  if (pushed) {
    pushed = false
    window.history.back()
    return
  }
  window.history.replaceState(ownHistoryState(), '', hereWith(null))
}

/**
 * Окно статьи из адреса текущей страницы. `useSearchParams` требует границы Suspense —
 * вызывающий оборачивает компонент в неё.
 */
export function useArticleWindowState(): ArticleWindowState | null {
  const state = parse(useSearchParams())
  // Окно закрылось не крестиком (ушли по ссылке, «назад») — своей записи у него больше нет.
  if (!state) pushed = false
  return state
}

/** Страница владельца статьи: профиль автора или страница организации. */
export function articleOwnerHref(
  a: Pick<ProfileArticle, 'userId' | 'companyId' | 'universityPageId'>,
): string {
  if (a.companyId) return `/companies/${a.companyId}`
  if (a.universityPageId) return `/universities/${a.universityPageId}`
  return `/profile/${a.userId}`
}
