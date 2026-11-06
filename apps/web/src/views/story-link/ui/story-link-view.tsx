'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CircleDashed } from 'lucide-react'
import { fetchStory, storyKeys } from '../../../entities/story'
import { STORIES_ENABLED } from '../../../shared/config'
import { PageLoader, StatusScreen } from '../../../shared/ui'
import { StoryViewer } from '../../../widgets/stories-rail'

/**
 * Сторис по ссылке (`/stories/:id`): из «Скопировать ссылку» и из карточки в чате. Доступ
 * решает сервер — аудитория, блокировки, срок жизни; здесь только два исхода: открыть
 * в обычном окне просмотра или сказать, что сторис недоступна. Закрытие ведёт в ленту.
 */
export function StoryLinkView({ id }: { id: string }) {
  const t = useTranslations('Stories')
  const tCommon = useTranslations('Common')
  const router = useRouter()
  const story = useQuery({
    queryKey: storyKeys.detail(id),
    queryFn: () => fetchStory(id),
    enabled: STORIES_ENABLED,
    retry: false,
  })

  if (STORIES_ENABLED && story.isPending) return <PageLoader label={tCommon('loading')} />
  if (!STORIES_ENABLED || story.isError || !story.data) {
    return (
      <StatusScreen
        icon={CircleDashed}
        title={t('unavailableTitle')}
        description={t('unavailableDesc')}
        showHome
      />
    )
  }

  const card = story.data
  return (
    <StoryViewer
      rings={[{ author: card.author, stories: [card], hasUnseen: !card.seen }]}
      startIndex={0}
      onClose={() => router.push('/')}
    />
  )
}
