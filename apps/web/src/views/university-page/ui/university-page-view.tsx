'use client'

import { UniversityProfile } from '../../../widgets/user-profile'
import { ArticleWindowHost } from '../../../widgets/article-window'

// Страница университета: своим — витрина вуза и его объявления, компаниям с допуском — с кем
// они работают. Остальным сервер отвечает 404 — экран показывает «недоступна». Статьи вуза
// открываются окном поверх страницы (`?article=`).
export function UniversityPageView({ universityId }: { universityId: string }) {
  return (
    <>
      <UniversityProfile universityId={universityId} />
      <ArticleWindowHost />
    </>
  )
}
