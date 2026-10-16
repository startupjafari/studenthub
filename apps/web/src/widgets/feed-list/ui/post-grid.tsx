'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { FeedPost } from '../../../entities/post'
import { MosaicGrid, MosaicTile, Skeleton } from '../../../shared/ui'
import { PostTile } from './post-tile'

// Лайтбокс (портал, галерея, видео, свайпы, мутации) грузится только при открытии поста —
// он не нужен для рендера самой ленты/сетки и раньше тянулся в First Load JS главной/постов.
const PostLightbox = dynamic(() => import('./post-lightbox').then((m) => m.PostLightbox), {
  ssr: false,
})

// Сетка постов (Instagram-стиль): мозаика из квадратных, высоких и широких плиток, клик
// открывает лайтбокс со всеми действиями. `pending` — скелетоны в хвосте на местах
// следующей страницы: подгруженные посты встают точно на них.
export function PostGrid({ posts, pending = 0 }: { posts: FeedPost[]; pending?: number }) {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <>
      <MosaicGrid>
        {posts.map((post, i) => (
          <PostTile key={post.id} post={post} index={i} onOpen={() => setOpen(i)} />
        ))}
        {Array.from({ length: pending }, (_, j) => (
          <MosaicTile key={`pending-${j}`} index={posts.length + j} aria-hidden>
            <Skeleton className="size-full rounded-none" />
          </MosaicTile>
        ))}
      </MosaicGrid>

      {open !== null && (
        <PostLightbox
          posts={posts}
          index={open}
          focusComment={false}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}
