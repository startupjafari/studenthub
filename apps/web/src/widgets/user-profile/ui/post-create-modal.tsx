'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { PostComposerModal } from '../../../features/create-post'
import { fetchUniversityPage, universityKeys } from '../../../entities/university'
import { useContentOwner } from '../lib/content-owner'

// Окно создания поста из меню «+» в профиле — то же окно редактора, что в ленте.
// На странице университета пост уходит от имени вуза (asUniversity), и в шапке редактора —
// вуз, а не тот, кто нажал кнопку. Витрина вуза уже в кэше: её грузит сама страница.
export function PostCreateModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Profile')
  const owner = useContentOwner('')
  const asUniversity = owner.kind === 'university'
  const page = useQuery({
    queryKey: universityKeys.page(owner.id),
    queryFn: () => fetchUniversityPage(owner.id),
    enabled: asUniversity,
  })
  return (
    <PostComposerModal
      title={t('addPost')}
      onClose={onClose}
      asUniversity={asUniversity}
      author={page.data ? { name: page.data.name, avatarUrl: page.data.logoUrl } : undefined}
    />
  )
}
