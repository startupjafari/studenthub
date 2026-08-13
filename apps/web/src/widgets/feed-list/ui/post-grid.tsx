'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { FeedPost } from '../../../entities/post'
import { PostTile } from './post-tile'

// Лайтбокс (портал, галерея, видео, свайпы, мутации) грузится только при открытии поста —
// он не нужен для рендера самой ленты/сетки и раньше тянулся в First Load JS главной/постов.
const PostLightbox = dynamic(() => import('./post-lightbox').then((m) => m.PostLightbox), {
  ssr: false,
})

// Сетка постов (Instagram-стиль): квадратные плитки 3-в-ряд, клик открывает лайтбокс.
export function PostGrid({ posts }: { posts: FeedPost[] }) {
  const [open, setOpen] = useState<{ index: number; focusComment: boolean } | null>(null)

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post, i) => (
          <PostTile
            key={post.id}
            post={post}
            onOpen={() => setOpen({ index: i, focusComment: false })}
            onOpenComment={() => setOpen({ index: i, focusComment: true })}
          />
        ))}
      </div>

      {open !== null && (
        <PostLightbox
          posts={posts}
          index={open.index}
          focusComment={open.focusComment}
          onIndex={(i) => setOpen({ index: i, focusComment: false })}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}
