'use client'

import { useTranslations } from 'next-intl'
import { CreatePostForm } from '../../../features/create-post'
import { ContentModal } from './content-modal'
import { useContentOwner } from '../lib/content-owner'

// Модалка создания поста из меню «+» в профиле: оборачивает CreatePostForm (bare, без Card).
// На странице университета пост уходит от имени вуза (asUniversity).
export function PostCreateModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Profile')
  const owner = useContentOwner('')
  return (
    <ContentModal title={t('addPost')} onClose={onClose} size="xl">
      <CreatePostForm bare onCreated={onClose} asUniversity={owner.kind === 'university'} />
    </ContentModal>
  )
}
