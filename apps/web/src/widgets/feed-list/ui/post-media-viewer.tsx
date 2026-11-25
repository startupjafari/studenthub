'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from 'next-intl'
import {
  fetchPostMediaLink,
  inlineMediaLink,
  postKeys,
  type FeedPost,
} from '../../../entities/post'
import { MediaViewer } from '../../../shared/ui'
import { relativeTime } from '../../../shared/lib'

/**
 * Полноэкранный просмотр вложений поста — общий просмотрщик в духе Telegram (щипок, колесо,
 * двойной тап, перетаскивание увеличенного снимка, свайп поперёк — листание, вдоль —
 * закрытие). Открывается поверх окна поста с того кадра, по которому нажали, и садится
 * обратно в него же (`getOrigin`): номер кадра общий с каруселью окна.
 *
 * Ссылка — из самой выдачи (подписана пачкой); истекла — у ручки продления, как в ленте.
 */
export function PostMediaViewer({
  post,
  index,
  onIndexChange,
  onClose,
  getOrigin,
}: {
  post: FeedPost
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  getOrigin?: (index: number) => HTMLElement | null
}) {
  const locale = useLocale()
  const cur = post.media[index]
  const inline = useMemo(() => (cur ? inlineMediaLink(cur) : null), [cur])
  const fetched = useQuery({
    queryKey: postKeys.media(cur?.id ?? ''),
    queryFn: () => fetchPostMediaLink(post.id, cur?.id ?? ''),
    enabled: !!cur && !inline,
    staleTime: 10 * 60 * 1000,
  })
  const link = inline ?? fetched.data
  const author = post.author

  return (
    <MediaViewer
      items={post.media.map((m) => ({ mime: m.mime }))}
      index={index}
      itemKey={cur?.id}
      src={link?.url}
      media={
        cur && {
          placeholder: cur.placeholder,
          width: cur.width,
          height: cur.height,
          sources: link?.sources,
          poster: link?.poster,
          hls: link?.hls,
        }
      }
      onIndexChange={onIndexChange}
      onClose={onClose}
      getOrigin={getOrigin}
      downloadUrl={link?.url}
      downloadKey={cur ? `post-media:${cur.id}` : undefined}
      topLeft={
        <div className="flex min-w-0 flex-col leading-tight text-white">
          <span className="truncate text-sm font-semibold">
            {author.lastName} {author.firstName}
          </span>
          <span className="truncate text-xs text-white/70">
            {relativeTime(post.publishedAt ?? post.createdAt, locale)}
            {post.media.length > 1 && ` · ${index + 1}/${post.media.length}`}
          </span>
        </div>
      }
    />
  )
}
