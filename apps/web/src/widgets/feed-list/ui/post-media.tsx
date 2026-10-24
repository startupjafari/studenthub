'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImageOff, Loader2 } from 'lucide-react'
import {
  fetchPostMediaLink,
  inlineMediaLink,
  postKeys,
  type PostMedia,
} from '../../../entities/post'
import { VideoPlayer } from '../../../shared/ui'
import { pickSource, srcSetOf } from '../../../shared/lib'
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
  /** Ширина медиа в раскладке — по ней браузер выбирает копию из srcset. */
  sizes?: string
  className?: string
}

// Колонка ленты — до 42rem: на телефоне во всю ширину, на десктопе 672px.
const FEED_SIZES = '(max-width: 768px) 100vw, 672px'

// Медиа поста: ссылка и варианты (медиа-система) приходят в самой ленте — сервер подписывает
// их пачкой на страницу. Отдельный запрос по (postId, fileId) — только когда ссылки в выдаче
// нет или она истекла (лента пролежала в кэше дольше подписи); его ответ кэшируется на 10 мин.
// Раньше запрос шёл за каждой плиткой, и пролистанная лента упиралась в лимит запросов.
export function PostMediaView({
  postId,
  media,
  fit = 'cover',
  controls = false,
  decorative = false,
  sizes = FEED_SIZES,
  className,
}: Props) {
  const isVideo = media.mime.startsWith('video/')
  const [broken, setBroken] = useState(false)
  // Ссылка из выдачи не загрузилась (истекла между отрисовкой и ленивой загрузкой) —
  // берём свежую у ручки продления, и только если и та не помогла, медиа «битое».
  const [refresh, setRefresh] = useState(false)
  // Срок проверяется при получении выдачи, а не на каждой перерисовке: иначе показанная
  // картинка на истечении подписи сменилась бы спиннером.
  const fromFeed = useMemo(() => inlineMediaLink(media), [media])
  const inline = refresh ? null : fromFeed
  // Размытому фону хватает самой заглушки: 16 пикселей под blur-2xl неотличимы от размытого
  // снимка, а второй загрузки того же файла ради подложки нет вовсе.
  const backdropFromPlaceholder = decorative && !!media.placeholder
  const {
    data: fetched,
    isLoading,
    isError,
  } = useQuery({
    queryKey: postKeys.media(media.id),
    queryFn: () => fetchPostMediaLink(postId, media.id),
    enabled: !backdropFromPlaceholder && !inline,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
  const link = inline ?? fetched
  const fail = (): void => (inline ? setRefresh(true) : setBroken(true))

  // Сброс состояния «битое медиа» при смене элемента (в карусели инстанс переиспользуется).
  useEffect(() => {
    setBroken(false)
    setRefresh(false)
  }, [media.id])

  const objectFit = fit === 'cover' ? 'object-cover' : 'object-contain'

  if (backdropFromPlaceholder) {
    return (
      <img
        src={media.placeholder as string}
        alt=""
        aria-hidden
        draggable={false}
        className={cn('object-cover', className)}
      />
    )
  }

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

  // Заглушка фоном самого кадра: размеры с сервера дают элементу пропорции ещё до загрузки,
  // фон ложится ровно в будущий снимок, а пришедшие пиксели просто закрывают его собой.
  const lqip = media.placeholder
    ? { backgroundImage: `url("${media.placeholder}")`, backgroundSize: '100% 100%' }
    : undefined
  const sized = !!media.width && !!media.height

  if (isLoading) {
    if (!decorative && lqip && sized && !isVideo) {
      return (
        <img
          src={media.placeholder as string}
          alt=""
          aria-hidden
          width={media.width ?? undefined}
          height={media.height ?? undefined}
          className={cn(objectFit, 'blur-sm', className)}
        />
      )
    }
    return placeholder(decorative ? null : <Loader2 className="size-8 animate-spin" aria-hidden />)
  }
  if (isError || !link || broken)
    return placeholder(decorative ? null : <ImageOff className="size-10" aria-hidden />)

  if (isVideo) {
    const poster = pickSource(link.poster, 1280)?.url
    if (controls) {
      // Полный просмотр: свой плеер с HLS — качество под скорость сети, переключаемое вручную.
      // Плееру нужна вся область оправы: его рамка считается от размеров контейнера
      // (cqw/cqh), а классы картинки (`w-auto`) схлопнули бы её в ноль.
      return <VideoPlayer src={link.url} hls={link.hls} poster={poster} className="size-full" />
    }
    // Плитка ленты: постер медиа-системы вместо `<video>`, который ради первого кадра тянул
    // начало самого ролика. Постера нет — кадр, как раньше, даёт сам `<video>`.
    if (link.poster.length > 0) {
      return (
        <img
          src={poster}
          srcSet={srcSetOf(link.poster)}
          sizes={sizes}
          alt=""
          loading="lazy"
          decoding="async"
          width={media.width ?? undefined}
          height={media.height ?? undefined}
          style={lqip}
          onError={fail}
          className={cn(objectFit, className)}
        />
      )
    }
    return (
      <video
        src={link.url}
        muted
        playsInline
        preload="metadata"
        onError={fail}
        className={cn(objectFit, className)}
      />
    )
  }
  return (
    <img
      src={link.url}
      // Копия по ширине колонки; GIF — оригиналом, копия была бы первым кадром.
      srcSet={
        media.mime === 'image/gif'
          ? undefined
          : srcSetOf(link.sources, { url: link.url, width: media.width })
      }
      sizes={link.sources.length ? sizes : undefined}
      alt=""
      // Ленивая загрузка + async-декод: в многокартиночной ленте картинки вне вьюпорта
      // не тянутся заранее (экономия мобильного трафика, §7).
      loading="lazy"
      decoding="async"
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      style={lqip}
      onError={fail}
      className={cn(objectFit, className)}
    />
  )
}
