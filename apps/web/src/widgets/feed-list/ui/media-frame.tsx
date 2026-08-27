'use client'

import type { ReactNode } from 'react'
import { PostMediaView } from './post-media'
import type { PostMedia } from '../../../entities/post'
import { cn } from '../../../shared/lib/utils'

/**
 * Оправа для одиночного вложения: сама картинка по центру, а поля по бокам заполнены
 * её же размытой копией — как во «ВКонтакте».
 *
 * Вертикальное фото в колонке шириной 42rem оставляет по краям пустоту почти в треть
 * ширины. Пустой прямоугольник читается как дырка в вёрстке, а размытая копия смыкает
 * карточку и подсказывает цвет самого снимка.
 *
 * Фон помечен `aria-hidden`: для скринридера это та же картинка второй раз.
 */
export function MediaFrame({
  postId,
  media,
  className,
  imageClassName,
  controls = false,
  children,
}: {
  postId: string
  media: PostMedia
  className?: string
  imageClassName?: string
  /** Элементы управления у видео (в полном просмотре — да, в ленте — нет). */
  controls?: boolean
  /** Накладки поверх кадра: стрелки карусели, счётчик, точки. */
  children?: ReactNode
}) {
  // У видео размытой подложки нет: это был бы второй проигрыватель того же файла —
  // лишняя загрузка и декодирование ради фона.
  const isVideo = media.mime.startsWith('video/')

  return (
    <div className={cn('relative flex items-center justify-center overflow-hidden', className)}>
      {!isVideo && (
        <div aria-hidden className="absolute inset-0">
          <PostMediaView
            postId={postId}
            media={media}
            fit="cover"
            // scale-110 прячет светлую кромку, которую blur размазывает по краям.
            className="size-full scale-110 blur-2xl brightness-75 saturate-150"
          />
        </div>
      )}
      <PostMediaView
        postId={postId}
        media={media}
        fit="contain"
        controls={controls}
        className={cn('relative w-auto max-w-full', imageClassName)}
      />
      {children}
    </div>
  )
}
