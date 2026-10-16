'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { FeedPost } from '../../../entities/post'
import { MosaicGrid } from '../../../shared/ui'
import { PostTile } from './post-tile'

// Лайтбокс (портал, галерея, видео, свайпы, мутации) грузится только при открытии поста —
// он не нужен для рендера самой ленты/сетки и раньше тянулся в First Load JS главной/постов.
const PostLightbox = dynamic(() => import('./post-lightbox').then((m) => m.PostLightbox), {
  ssr: false,
})

// Сетка постов (Instagram-стиль): мозаика из квадратных, высоких и широких плиток, клик
// открывает лайтбокс со всеми действиями.
export function PostGrid({ posts }: { posts: FeedPost[] }) {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <>
      <MosaicGrid>
        {posts.map((post, i) => (
          <PostTile key={post.id} post={post} index={i} onOpen={() => setOpen(i)} />
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
