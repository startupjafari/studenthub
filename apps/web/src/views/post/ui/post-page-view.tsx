'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Newspaper } from 'lucide-react'
import { fetchPost, postKeys } from '../../../entities/post'
import { PostCard } from '../../../widgets/feed-list'
import { Button, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'

const PostLightbox = dynamic(
  () => import('../../../widgets/feed-list/ui/post-lightbox').then((m) => m.PostLightbox),
  { ssr: false },
)

/**
 * Постоянная страница одной публикации — то, на что указывает «Скопировать ссылку».
 *
 * До неё поделиться постом за пределами платформы было нечем: адреса у публикации
 * не существовало, и превью пересланного поста вело на профиль автора.
 *
 * Видимость решает сервер: невидимый зрителю пост отвечает NOT_FOUND, и мы показываем
 * «недоступна» — не раскрывая, существует он вообще или нет.
 */
export function PostPageView({ postId }: { postId: string }) {
  const t = useTranslations('Feed')
  const [lightbox, setLightbox] = useState<{ focusComment: boolean } | null>(null)

  const post = useQuery({
    queryKey: postKeys.detail(postId),
    queryFn: () => fetchPost(postId),
    // Недоступный пост повторными запросами доступным не станет.
    retry: false,
  })

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t('postTitle')} />

      <div className="mx-auto w-full max-w-2xl">
        {post.isPending ? (
          <Skeleton className="h-96 w-full rounded-2xl" />
        ) : post.isError || !post.data ? (
          <EmptyState
            icon={<Newspaper className="size-6" aria-hidden />}
            title={t('postUnavailableTitle')}
            description={t('postUnavailableText')}
            action={
              <Button asChild variant="outline">
                <Link href="/">{t('backToFeed')}</Link>
              </Button>
            }
          />
        ) : (
          <PostCard
            post={post.data}
            onOpenMedia={() => setLightbox({ focusComment: false })}
            onOpenComments={() => setLightbox({ focusComment: true })}
          />
        )}
      </div>

      {lightbox && post.data && (
        <PostLightbox
          posts={[post.data]}
          index={0}
          focusComment={lightbox.focusComment}
          onIndex={() => undefined}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
