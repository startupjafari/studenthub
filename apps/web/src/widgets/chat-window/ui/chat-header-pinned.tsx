'use client'

import { useState, type MouseEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { List as ListIcon, PinOff, X } from 'lucide-react'
import {
  attachmentKind,
  mediaPreview,
  type AttachmentKind,
  type ChatMessage,
} from '../../../entities/chat'
import { plainPreview } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { Modal, RowContextMenu, useConfirm } from '../../../shared/ui'
import { ChatHeaderIconButton } from './chat-header-button'

const PREVIEW_KEY: Record<AttachmentKind, string> = {
  voice: 'previewVoice',
  photo: 'previewPhoto',
  video: 'previewVideo',
  file: 'previewFile',
}

/** Видимая высота шкалы — ровно строка «заголовок + текст» полосы. */
const TRACK_PX = 36
const TRACK_GAP_PX = 2
/** Сколько делений помещается в окно шкалы целиком; дальше оно едет за текущим. */
const TRACK_VISIBLE = 4

/**
 * Полоса закреплённых сообщений под шапкой (Telegram: HeaderPinnedMessage).
 *
 * Как в Telegram:
 * - слева шкала, по делению на каждое закрепление; текущее — сплошным акцентом, шкала
 *   длиннее четырёх делений едет за ним и гаснет к краям;
 * - заголовок «Закреплённое сообщение #N» (номер от самого старого), ниже — первая строка;
 * - нажатие ведёт к показанному сообщению, а полоса тут же показывает следующее, более
 *   старое; Shift+нажатие — шаг назад. После самого старого — снова самое новое;
 * - справа — список всех закреплений (если их больше одного).
 *
 * Своё: крестик прячет полосу до следующего изменения набора закреплений (это подсказка,
 * а не само закрепление), снять закреп — из меню полосы (правый клик) или из списка.
 * Состояние живёт здесь: компонент монтируется заново на каждый чат (`key` переписки),
 * так что номер и «спрятано» другого чата сюда не протекают.
 */
export function ChatHeaderPinned({
  pinned,
  senderName,
  onJump,
  onUnpin,
}: {
  /** Закреплённые чата, от недавно закреплённых к давним — так их отдаёт сервер. */
  pinned: readonly ChatMessage[]
  senderName: (m: ChatMessage) => string
  /** Довести ленту до сообщения и подсветить его. */
  onJump: (messageId: string) => void
  /** Снять закрепление (подтверждение уже получено). */
  onUnpin: (messageId: string) => void
}) {
  const t = useTranslations('Chats')
  const confirm = useConfirm()
  const [index, setIndex] = useState(0)
  // Куда ехал текст при последней смене: вперёд (к старым) — снизу, назад — сверху.
  const [dir, setDir] = useState<1 | -1>(1)
  const [hiddenKey, setHiddenKey] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [listOpen, setListOpen] = useState(false)

  const count = pinned.length
  // Набор, а не «самое новое»: по одному краю «закрепили новое» не отличить от «сняли
  // старое», а подсказка нужна снова в обоих случаях.
  const key = pinned.map((p) => p.id).join(',')
  const idx = count > 0 ? index % count : 0
  const cur = pinned[idx]

  function askUnpin(messageId: string): void {
    // Закрепление общее: снимая его, человек меняет полосу всем участникам.
    void confirm({ title: t('unpinConfirm'), confirmLabel: t('unpin'), destructive: true }).then(
      (ok) => {
        if (ok) onUnpin(messageId)
      },
    )
  }

  function onClick(e: MouseEvent): void {
    if (count === 0) return
    if (e.shiftKey && count > 1) {
      const target = (idx - 2 + count * 2) % count
      const msg = pinned[target]
      if (!msg) return
      onJump(msg.id)
      setIndex((target + 1) % count)
      setDir(-1)
      return
    }
    if (!cur) return
    onJump(cur.id)
    if (count > 1) {
      setIndex((idx + 1) % count)
      setDir(1)
    }
  }

  const bar =
    cur && hiddenKey !== key ? (
      <div
        className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background pr-1 duration-(--motion-page) animate-in fade-in-0 slide-in-from-top-1"
        onContextMenu={(e) => {
          e.preventDefault()
          const box = e.currentTarget.getBoundingClientRect()
          // Клавиша меню на клавиатуре приходит с нулевыми координатами — тогда у полосы.
          const keyboard = e.clientX === 0 && e.clientY === 0
          setMenu({
            x: keyboard ? box.left + 24 : e.clientX,
            y: keyboard ? box.bottom : e.clientY,
          })
        }}
      >
        <button
          type="button"
          onClick={onClick}
          aria-label={t('tgHeader.pinnedGoTo', { text: pinnedSummary(cur, t) })}
          className="flex h-full min-w-0 flex-1 items-center gap-2 pl-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
        >
          <PinnedTrack count={count} index={idx} />
          <PinnedThumb message={cur} />
          {/* key — смена сообщения проигрывает въезд строки, как в Telegram. */}
          <span
            key={cur.id}
            className={cn(
              'flex min-w-0 flex-1 flex-col leading-tight duration-(--motion-page) animate-in fade-in-0',
              dir === 1 ? 'slide-in-from-bottom-2' : 'slide-in-from-top-2',
            )}
          >
            <span className="truncate text-sm font-medium text-primary">
              {count > 1 ? t('tgHeader.pinnedNumbered', { n: count - idx }) : t('pinnedMessage')}
            </span>
            <span className="truncate text-sm text-foreground/90">{pinnedSummary(cur, t)}</span>
          </span>
        </button>
        {count > 1 && (
          <ChatHeaderIconButton
            aria-label={t('pinnedMessages')}
            title={t('pinnedMessages')}
            onClick={() => setListOpen(true)}
          >
            <ListIcon aria-hidden />
          </ChatHeaderIconButton>
        )}
        <ChatHeaderIconButton
          aria-label={t('pinnedHide')}
          title={t('pinnedHide')}
          onClick={() => setHiddenKey(key)}
        >
          <X aria-hidden />
        </ChatHeaderIconButton>
      </div>
    ) : null

  return (
    <>
      {bar}
      {menu && cur && (
        <RowContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={t('pinnedMessage')}
          onClose={() => setMenu(null)}
          items={[
            ...(count > 1
              ? [
                  {
                    key: 'pinned-all',
                    icon: ListIcon,
                    label: t('pinnedMessages'),
                    onClick: () => setListOpen(true),
                  },
                ]
              : []),
            {
              key: 'unpin',
              icon: PinOff,
              label: t('unpin'),
              onClick: () => askUnpin(cur.id),
              danger: true,
            },
          ]}
        />
      )}
      {listOpen && count > 0 && (
        <PinnedListModal
          pinned={pinned}
          senderName={senderName}
          onClose={() => setListOpen(false)}
          onPick={(i, id) => {
            setListOpen(false)
            setIndex(i)
            setDir(i >= idx ? 1 : -1)
            onJump(id)
          }}
          onUnpin={askUnpin}
        />
      )}
    </>
  )
}

/**
 * Шкала закреплений. Деления равной высоты с зазором 2 px; до четырёх — делят 36 px между
 * собой, больше — фиксированной высоты, и окно шкалы едет за текущим. Новое закрепление —
 * нижнее деление: шкала читается как лента, где свежее внизу.
 */
function PinnedTrack({ count, index }: { count: number; index: number }) {
  if (count <= 1) {
    return <span className="h-9 w-0.5 shrink-0 rounded-full bg-primary" aria-hidden />
  }
  const fits = count <= TRACK_VISIBLE
  const seg = fits
    ? (TRACK_PX - TRACK_GAP_PX * (count - 1)) / count
    : (TRACK_PX - TRACK_GAP_PX * (TRACK_VISIBLE - 1)) / TRACK_VISIBLE
  const total = seg * count + TRACK_GAP_PX * (count - 1)
  const pos = count - 1 - index
  const markTop = pos * (seg + TRACK_GAP_PX)
  const offset = Math.min(Math.max(markTop + seg / 2 - TRACK_PX / 2, 0), total - TRACK_PX)
  return (
    <span
      className={cn(
        'relative h-9 w-0.5 shrink-0 overflow-hidden',
        !fits &&
          '[mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]',
      )}
      aria-hidden
    >
      <span
        className="absolute inset-x-0 top-0 transition-transform duration-(--motion-panel) motion-reduce:transition-none"
        style={{ height: total, transform: `translateY(${-offset}px)` }}
      >
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className="absolute inset-x-0 rounded-full bg-primary/25"
            style={{ top: i * (seg + TRACK_GAP_PX), height: seg }}
          />
        ))}
        <span
          className="absolute inset-x-0 top-0 rounded-full bg-primary transition-transform duration-(--motion-panel) motion-reduce:transition-none"
          style={{ height: seg, transform: `translateY(${markTop}px)` }}
        />
      </span>
    </span>
  )
}

/**
 * Миниатюра снимка или видео, как в Telegram. Берём заглушку медиа-системы: она приходит
 * вместе с сообщением, а за настоящей копией пришлось бы ходить отдельным запросом ради
 * квадрата в 36 px.
 */
function PinnedThumb({ message }: { message: ChatMessage }) {
  const media = message.media.find((a) => {
    const kind = attachmentKind(a)
    return (kind === 'photo' || kind === 'video') && !!a.placeholder
  })
  if (!media?.placeholder) return null
  return (
    <span className="relative size-9 shrink-0 overflow-hidden rounded-md bg-muted" aria-hidden>
      <img
        src={media.placeholder}
        alt=""
        draggable={false}
        className={cn('size-full object-cover', media.spoiler && 'blur-sm')}
      />
    </span>
  )
}

function PinnedListModal({
  pinned,
  senderName,
  onClose,
  onPick,
  onUnpin,
}: {
  pinned: readonly ChatMessage[]
  senderName: (m: ChatMessage) => string
  onClose: () => void
  onPick: (index: number, messageId: string) => void
  onUnpin: (messageId: string) => void
}) {
  const t = useTranslations('Chats')
  const locale = useLocale()
  return (
    <Modal
      onClose={onClose}
      title={t('tgHeader.pinnedListTitle', { count: pinned.length })}
      size="md"
      bodyClassName="p-0"
    >
      <ul className="flex max-h-[min(70vh,32rem)] flex-col overflow-y-auto p-2">
        {pinned.map((m, i) => (
          <li key={m.id} className="flex items-start gap-2 rounded-xl px-2 py-2 hover:bg-muted/40">
            <button
              type="button"
              onClick={() => onPick(i, m.id)}
              className="flex min-w-0 flex-1 flex-col items-start rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="text-xs font-semibold text-primary">{senderName(m)}</span>
              <span className="line-clamp-2 text-sm text-foreground/90">{pinnedSummary(m, t)}</span>
              <span className="mt-0.5 text-xs text-muted-foreground">
                {new Date(m.createdAt).toLocaleString(locale, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </button>
            <ChatHeaderIconButton
              aria-label={t('unpin')}
              title={t('unpin')}
              onClick={() => onUnpin(m.id)}
              className="size-9 hover:bg-destructive/10 hover:text-destructive lg:size-9 [&_svg]:size-4"
            >
              <PinOff aria-hidden />
            </ChatHeaderIconButton>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

/**
 * Одна строка о закреплённом — текст без разметки, а у сообщения без текста — что в нём
 * (как подпись в списке чатов): «Фото», «Опрос: …», «Геопозиция».
 */
function pinnedSummary(m: ChatMessage, t: ReturnType<typeof useTranslations<'Chats'>>): string {
  const text = plainPreview(m.content ?? '')
  if (m.poll) return t('previewPoll', { question: text })
  if (text) return text
  if (m.location) return m.location.title || t('previewLocation')
  if (m.contact) return t('previewContact', { name: m.contact.name })
  if (m.checklist) return t('previewChecklist', { title: m.checklist.title })
  if (m.sticker) return [m.sticker.emoji, t('previewSticker')].filter(Boolean).join(' ')
  if (m.sharedPost) return t('previewPost')
  if (m.sharedStory) return t('previewStory')
  const media = mediaPreview(m.media)
  if (media) return t(PREVIEW_KEY[media.kind], { n: media.count })
  return t('attachment')
}
