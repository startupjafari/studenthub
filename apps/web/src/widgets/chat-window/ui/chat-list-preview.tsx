'use client'

import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  BarChart3,
  CircleDashed,
  CirclePlay,
  FileText,
  ImageIcon,
  ListChecks,
  MapPin,
  Mic,
  Music,
  Newspaper,
  Play,
  UserRound,
  Video,
  type LucideIcon,
} from 'lucide-react'
import {
  attachmentKind,
  fetchAttachmentLink,
  isViewable,
  mediaPreview,
  type AttachmentKind,
  type MessageAttachment,
} from '../../../entities/chat'
import { MediaImage } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { plainPreview } from '../lib/format'
import { parseProfileShare } from './shared-cards'
import { SYSTEM_KEY } from './message-item'

// Вид вложения в превью — значком и подписью, как в Telegram: по строке списка видно,
// снимок там, голосовое или архив, ещё до того как чат открыт.
const PREVIEW_ICON: Record<AttachmentKind, LucideIcon> = {
  voice: Mic,
  audio: Music,
  round: CirclePlay,
  photo: ImageIcon,
  video: Video,
  file: FileText,
}
export const PREVIEW_KEY: Record<AttachmentKind, string> = {
  voice: 'previewVoice',
  audio: 'previewMusic',
  round: 'tgMessage.previewRound',
  photo: 'previewPhoto',
  video: 'previewVideo',
  file: 'previewFile',
}

/**
 * Структурный тип, а не ChatMessage: тем же превью подписываются найденные сообщения, а они
 * приходят урезанными. Поля карточек необязательны по той же причине.
 */
export type PreviewMessage = {
  systemType?: string | null
  systemMeta?: { targetName?: string; title?: string } | null
  content?: string | null
  media?: readonly MessageAttachment[]
  sharedPost?: unknown
  sharedStory?: unknown
  sharedStoryReply?: boolean
  poll?: unknown
  location?: { title: string | null } | null
  contact?: { name: string } | null
  checklist?: { title: string } | null
  sender?: { firstName: string } | null
}

/**
 * Имя единственного файла или песни — им Telegram и подписывает такое сообщение в списке:
 * «Лекция 3.pdf», «Подкаст выпуск 4», а не безликое «Файл». У песни расширение снимается — у
 * Telegram там название трека. Несколько вложений или другой вид — null (остаётся «3 файла»).
 */
export function singleMediaName(media: readonly MessageAttachment[]): string | null {
  const only = media.length === 1 ? media[0] : undefined
  const name = only?.name?.trim()
  if (!only || !name) return null
  const kind = attachmentKind(only)
  if (kind === 'file') return name
  if (kind === 'audio') return name.replace(/\.[^.\s]{1,8}$/, '') || name
  return null
}

/** Снимок или ролик, которым можно подписать строку миниатюрой (Telegram-стиль). */
export function previewThumbOf(message: PreviewMessage | null): MessageAttachment | null {
  if (!message || message.systemType || message.poll || message.sharedPost) return null
  return (message.media ?? []).find(isViewable) ?? null
}

/**
 * Миниатюра медиа в строке списка, 20×20, как в Telegram.
 *
 * Сначала — LQIP-заглушка из того же ответа списка: на 20 пикселях она почти не отличается
 * от снимка, а запроса не стоит. За ссылкой ходим только у вложений без заглушки (старше
 * медиа-системы) — иначе список из сотни чатов с фото на конце стоил бы сотни запросов на
 * каждом открытии. Кэш ссылки общий с перепиской: ключ тот же, что у вложений сообщений.
 * Спойлер в списке остаётся спойлером — размытым.
 */
export function PreviewThumb({
  att,
  large = false,
  className,
}: {
  att: MessageAttachment
  /** Плитка сетки (поиск по медиа), а не значок в строке: ссылку грузим всегда, копию по ширине. */
  large?: boolean
  className?: string
}) {
  const needLink = large || !att.placeholder
  const link = useQuery({
    queryKey: ['chat-attachment', att.id],
    queryFn: () => fetchAttachmentLink(att.id),
    enabled: needLink,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
  const data = needLink ? link.data : undefined
  const isVideo = att.mime.startsWith('video/')
  const variants = (isVideo ? data?.poster : data?.sources) ?? []
  // Оригинал — запасной кандидат srcset; у видео оригинал — ролик, картинкой он не станет.
  const src = isVideo ? variants[variants.length - 1]?.url : data?.url
  return (
    <span
      className={cn(
        'relative inline-flex size-5 shrink-0 overflow-hidden rounded-[0.25rem] bg-muted align-[-0.3rem]',
        className,
        // Кружок и в списке — кружком, как в Telegram.
        att.videoNote && 'rounded-full',
      )}
      aria-hidden
    >
      <MediaImage
        src={src}
        media={{
          placeholder: att.placeholder,
          sources: variants,
          width: isVideo ? null : att.width,
        }}
        alt=""
        sizes={large ? '(max-width: 640px) 33vw, 120px' : '20px'}
        className={cn('size-full', att.spoiler && (large ? 'blur-xl' : 'blur-[2px]'))}
      />
      {isVideo && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
          <Play className={cn('fill-current', large ? 'size-6' : 'size-2.5')} />
        </span>
      )}
    </span>
  )
}

function PreviewWithIcon({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <>
      {/* `-mt-px`: оптический центр значка на пол-пикселя выше базовой линии строки. */}
      <Icon className="-mt-px mr-1 inline size-3.5 shrink-0 align-text-bottom" aria-hidden />
      {children}
    </>
  )
}

/**
 * Превью последнего сообщения: подпись, а у вложения без текста — ещё и значок вида.
 *
 * Подпись к вложению вытесняет название вида: у снимка с текстом в списке стоит сам текст, а
 * не слово «Фото», — он содержательнее. С миниатюрой (`withThumb`) значок не нужен вовсе: вид
 * снимка уже виден на ней.
 *
 * Сообщения, которые в окне чата рисуются карточкой, и в списке называются по-человечески:
 * пересланный профиль — «Профиль: Имя», репост — «Публикация», опрос — «Опрос: вопрос»,
 * служебное событие — его текстом. Разметка из текста снимается.
 */
export function MessagePreview({
  message,
  withThumb = false,
}: {
  message: PreviewMessage | null
  withThumb?: boolean
}) {
  const t = useTranslations('Chats')
  if (!message) return null
  if (message.systemType) {
    return (
      <>
        {t(SYSTEM_KEY[message.systemType] ?? 'systemEvent', {
          actor: message.sender?.firstName ?? '',
          target: message.systemMeta?.targetName ?? '',
          title: message.systemMeta?.title ?? '',
        })}
      </>
    )
  }
  const story = !!message.sharedStory || !!message.sharedStoryReply
  const profile =
    message.sharedPost || message.poll || story ? null : parseProfileShare(message.content ?? null)
  if (profile) {
    return (
      <PreviewWithIcon icon={UserRound}>
        {t('previewProfile', { name: profile.name })}
      </PreviewWithIcon>
    )
  }
  if (message.poll) {
    return (
      <PreviewWithIcon icon={BarChart3}>
        {t('previewPoll', { question: plainPreview(message.content ?? '') })}
      </PreviewWithIcon>
    )
  }
  // Особые сообщения: текста у них нет, превью строится по содержимому.
  if (message.location) {
    return (
      <PreviewWithIcon icon={MapPin}>
        {message.location.title || t('previewLocation')}
      </PreviewWithIcon>
    )
  }
  if (message.contact) {
    return (
      <PreviewWithIcon icon={UserRound}>
        {t('previewContact', { name: message.contact.name })}
      </PreviewWithIcon>
    )
  }
  if (message.checklist) {
    return (
      <PreviewWithIcon icon={ListChecks}>
        {t('previewChecklist', { title: message.checklist.title })}
      </PreviewWithIcon>
    )
  }
  if (message.sharedPost) {
    const comment = plainPreview(message.content ?? '')
    return <PreviewWithIcon icon={Newspaper}>{comment || t('previewPost')}</PreviewWithIcon>
  }
  if (story) {
    const comment = plainPreview(message.content ?? '')
    return (
      <PreviewWithIcon icon={CircleDashed}>
        {comment || t(message.sharedStoryReply ? 'previewStoryReply' : 'previewStory')}
      </PreviewWithIcon>
    )
  }
  const text = plainPreview(message.content ?? '')
  const media = mediaPreview(message.media ?? [])
  const thumb = withThumb ? previewThumbOf(message) : null
  if (thumb) {
    return (
      <>
        <PreviewThumb att={thumb} className="mr-1.5" />
        {text || (media ? t(PREVIEW_KEY[media.kind], { n: media.count }) : null)}
      </>
    )
  }
  if (text) return <>{text}</>
  if (!media) return null
  return (
    <PreviewWithIcon icon={PREVIEW_ICON[media.kind]}>
      {singleMediaName(message.media ?? []) ?? t(PREVIEW_KEY[media.kind], { n: media.count })}
    </PreviewWithIcon>
  )
}
