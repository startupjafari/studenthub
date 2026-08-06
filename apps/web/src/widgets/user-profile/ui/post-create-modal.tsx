'use client'

import { useTranslations } from 'next-intl'
import { CreatePostForm } from '../../../features/create-post'
import { ContentModal } from './content-modal'

// Модалка создания поста из меню «+» в профиле: оборачивает CreatePostForm (bare, без Card).
export function PostCreateModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Profile')
  return (
    <ContentModal title={t('addPost')} onClose={onClose} size="xl">
      <CreatePostForm bare onCreated={onClose} />
    </ContentModal>
  )
}
