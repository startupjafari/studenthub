import { getTranslations } from 'next-intl/server'
import { CreatePostForm } from '../../../features/create-post'
import { FeedList } from '../../../widgets/feed-list'
import { PageHeader } from '../../../shared/ui'

// Экран ленты (создание поста + список) — для ролей вне студенческой главной (админ вуза и т.п.).
export async function FeedView() {
  const t = await getTranslations('Nav')
  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title={t('posts')} />
      <CreatePostForm />
      <FeedList />
    </div>
  )
}
