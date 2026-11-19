'use client'

import { useEffect, useState, type Ref } from 'react'
import dynamic from 'next/dynamic'
import type { FeedPost } from '../../../entities/post'
import { MosaicGrid, MosaicTile, Skeleton } from '../../../shared/ui'
import { PostTile } from './post-tile'

// Лайтбокс (портал, галерея, видео, свайпы, мутации) грузится только при открытии поста —
// он не нужен для рендера самой ленты/сетки и раньше тянулся в First Load JS главной/постов.
const PostLightbox = dynamic(() => import('./post-lightbox').then((m) => m.PostLightbox), {
  ssr: false,
})

// Сетка постов (Instagram-стиль): ровные квадратные плитки, клик
// открывает лайтбокс со всеми действиями. `pending` — скелетоны в хвосте на местах
// следующей страницы: подгруженные посты встают точно на них. `pendingRef` вешается на
// ПЕРВЫЙ скелетон — маячок подгрузки: под хвостом он оказался бы на экраны ниже, и
// читатель смотрел бы на скелетоны, а страница так и не запрашивалась.
export function PostGrid({
  posts,
  pending = 0,
  pendingRef,
  freshIds,
}: {
  posts: FeedPost[]
  pending?: number
  pendingRef?: Ref<HTMLDivElement>
  /** Только что пришедшие посты — их плитки въезжают с подсветкой (`sh-live-in`). */
  freshIds?: ReadonlySet<string>
}) {
  // Открытый пост — по id: живая лента убирает удалённые посты, и номер съехал бы на соседа.
  const [openId, setOpenId] = useState<string | null>(null)
  const open = openId === null ? -1 : posts.findIndex((p) => p.id === openId)
  // Открытый пост пропал из списка (удалён) — окно закрыто насовсем, а не до его возвращения.
  useEffect(() => {
    if (openId !== null && open < 0) setOpenId(null)
  }, [openId, open])

  return (
    <>
      <MosaicGrid>
        {posts.map((post) => (
          <PostTile
            key={post.id}
            post={post}
            className={freshIds?.has(post.id) ? 'sh-live-in' : undefined}
            onOpen={() => setOpenId(post.id)}
          />
        ))}
        {Array.from({ length: pending }, (_, j) => (
          <MosaicTile key={`pending-${j}`} ref={j === 0 ? pendingRef : undefined} aria-hidden>
            <Skeleton className="size-full rounded-none" />
          </MosaicTile>
        ))}
      </MosaicGrid>

      {/* Открытый пост удалили — окно закрывается вместе с ним. */}
      {open >= 0 && (
        <PostLightbox
          posts={posts}
          index={open}
          focusComment={false}
          onIndex={(i) => setOpenId(posts[i]?.id ?? null)}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  )
}
