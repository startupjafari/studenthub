'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useArticleWindowState } from '../../../entities/profile-content'

// Читалка и редактор — отдельными чанками: странице, где статью не открывали, они не нужны.
const ArticleReader = dynamic(() => import('./article-reader').then((m) => m.ArticleReader), {
  ssr: false,
})
const ArticleEditorWindow = dynamic(
  () => import('./article-editor').then((m) => m.ArticleEditorWindow),
  { ssr: false },
)

/**
 * Окно статьи из адреса страницы (`?article=…`, см. `useArticleWindowState`): чтение,
 * правка или новая статья поверх профиля или страницы организации.
 *
 * Редактор не перемонтируется, когда новая статья после первого сохранения получает id в
 * адресе: элемент на том же месте, ключа нет. Чтение и редактор — разные компоненты, и
 * переход между ними окно открывает заново.
 */
export function ArticleWindowHost() {
  // `useSearchParams` требует границы Suspense.
  return (
    <Suspense fallback={null}>
      <ArticleWindowFromUrl />
    </Suspense>
  )
}

function ArticleWindowFromUrl() {
  const state = useArticleWindowState()
  if (!state) return null
  if (state.mode === 'read') return <ArticleReader articleId={state.id} />
  return <ArticleEditorWindow state={state} />
}
