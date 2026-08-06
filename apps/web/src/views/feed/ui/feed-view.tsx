import { getTranslations } from 'next-intl/server'
import { CreatePostForm } from '../../../features/create-post'
import { FeedList } from '../../../widgets/feed-list'

// Экран ленты (создание поста + список) — для ролей вне студенческой главной (админ вуза и т.п.).
export async function FeedView() {
  const t = await getTranslations('Nav')
  return (
    <div className="flex w-full flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('posts')}</h1>
      <CreatePostForm />
      <FeedList />
    </div>
  )
}
