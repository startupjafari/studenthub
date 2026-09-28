'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImageOff, Loader2 } from 'lucide-react'
import { fetchPostMediaUrl, postKeys, type PostMedia } from '../../../entities/post'
import { cn } from '../../../shared/lib/utils'

interface Props {
  postId: string
  media: PostMedia
  // cover — заполняет плитку (сетка), contain — вписывает целиком (лайтбокс).
  fit?: 'cover' | 'contain'
  // Управление у видео (в лайтбоксе — да, в плитке — нет).
  controls?: boolean
  /**
   * Фоновая размытая копия кадра (MediaFrame). Значков состояния не показывает: за
   * настоящим спиннером висел бы его же размытый двойник, и загрузка выглядела как
   * грязное пятно на фоне. Сообщать фону нечего — он `aria-hidden`.
   */
  decorative?: boolean
  className?: string
}

// Медиа поста: presigned-URL берётся лениво по (postId, fileId) и кэшируется на 10 мин.
export function PostMediaView({
  postId,
  media,
  fit = 'cover',
  controls = false,
  decorative = false,
  className,
}: Props) {
  const isVideo = media.mime.startsWith('video/')
  const [broken, setBroken] = useState(false)
  const {
    data: url,
    isLoading,
    isError,
  } = useQuery({
    queryKey: postKeys.media(media.id),
    queryFn: () => fetchPostMediaUrl(postId, media.id),
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })

  // Сброс состояния «битое медиа» при смене элемента (в карусели инстанс переиспользуется).
  useEffect(() => setBroken(false), [media.id])

  /**
   * Плейсхолдер занимает ВЕСЬ кадр, а не место будущей картинки.
   *
   * Размеры идут последними и перебивают пришедшие снаружи. Это не придирка к порядку:
   * оправа кадра (media-frame.tsx) передаёт сюда `w-auto max-w-full` — правило для
   * картинки, которая должна вписаться по своим пропорциям. У плейсхолдера пропорций
   * нет, и `w-auto` сжимал его по содержимому — на весь экран вставала полоска шириной
   * со спиннер, а «загрузка поста» выглядела сломанной вёрсткой.
   */
  const placeholder = (icon: ReactNode): ReactNode => (
    <div
      className={cn(
        className,
        'flex size-full min-h-full items-center justify-center bg-muted text-muted-foreground',
      )}
    >
      {icon}
    </div>
  )

  if (isLoading)
    return placeholder(decorative ? null : <Loader2 className="size-8 animate-spin" aria-hidden />)
  if (isError || !url || broken)
    return placeholder(decorative ? null : <ImageOff className="size-10" aria-hidden />)

  const objectFit = fit === 'cover' ? 'object-cover' : 'object-contain'
  if (isVideo) {
    return (
      <video
        src={url}
        controls={controls}
        muted={!controls}
        playsInline
        onError={() => setBroken(true)}
        className={cn(objectFit, className)}
      />
    )
  }
  return (
    <img
      src={url}
      alt=""
      // Ленивая загрузка + async-декод: в многокартиночной ленте картинки вне вьюпорта
      // не тянутся заранее (экономия мобильного трафика, §7).
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className={cn(objectFit, className)}
    />
  )
}
