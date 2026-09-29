'use client'

import { useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { fetchPost, postKeys } from '../../../entities/post'

const PostLightbox = dynamic(() => import('./post-lightbox').then((m) => m.PostLightbox), {
  ssr: false,
})

/**
 * Пост из адреса: `?post=<id>` открывает его в полном просмотре поверх страницы.
 *
 * Так работает карточка поста, пересланного в чат: она ведёт в профиль автора, и человек
 * видит сразу публикацию, которую ему прислали, а не сетку, где её надо искать. Закрытие
 * убирает параметр из адреса — «назад» не открывает пост заново, а обновление страницы
 * не возвращает окно, которое уже закрыли.
 *
 * Видимость решает сервер: недоступный зрителю пост отвечает NOT_FOUND — показываем «пост
 * недоступен» и просто остаёмся в профиле.
 *
 * `useSearchParams` требует границы Suspense — вызывающий оборачивает компонент в неё.
 */
export function PostFromUrl({ onOpen }: { onOpen?: () => void }) {
  const t = useTranslations('Feed')
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const postId = params.get('post')

  const post = useQuery({
    queryKey: postKeys.detail(postId ?? ''),
    queryFn: () => fetchPost(postId as string),
    enabled: postId !== null,
    retry: false,
  })

  const close = (): void => {
    const next = new URLSearchParams(params.toString())
    next.delete('post')
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  // Профиль под постом переключается на «Посты» — один раз на каждый открытый пост.
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  useEffect(() => {
    if (postId) onOpenRef.current?.()
  }, [postId])

  useEffect(() => {
    if (!post.isError) return
    toast.error(t('postUnavailableTitle'))
    close()
    // close читает актуальные params из рендера; повторять эффект на каждый рендер незачем.
  }, [post.isError])

  if (!postId || post.isError) return null
  if (!post.data) {
    // Пока пост грузится — затемнение с крутилкой на месте будущего окна: иначе клик по
    // карточке в чате выглядел бы как переход в профиль, а пост возникал бы неожиданно.
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
        <Loader2 className="size-8 animate-spin text-white/80" aria-hidden />
      </div>
    )
  }
  return <PostLightbox posts={[post.data]} index={0} onIndex={() => undefined} onClose={close} />
}
