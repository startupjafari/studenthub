'use client'

import { memo } from 'react'
import { useTranslations } from 'next-intl'
import {
  AlertCircle,
  Check,
  CheckCheck,
  ChevronDown,
  Forward,
  Loader2,
  Pin,
  Reply,
} from 'lucide-react'
import {
  ChatPollView,
  LinkPreviewCard,
  MessageAttachments,
  MessageContent,
  ReactionBar,
  SharedPostCard,
  type ChatMessage,
} from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { Avatar, AvatarFallback } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Системные события группы (§20) → i18n-ключ. Текст строит клиент из actor/target/title.
const SYSTEM_KEY: Record<string, string> = {
  member_added: 'sysMemberAdded',
  member_removed: 'sysMemberRemoved',
  member_left: 'sysMemberLeft',
  admin_granted: 'sysAdminGranted',
  admin_revoked: 'sysAdminRevoked',
  title_changed: 'sysTitleChanged',
  avatar_changed: 'sysAvatarChanged',
  message_pinned: 'sysMessagePinned',
  owner_changed: 'sysOwnerChanged',
}

// Статус доставки своего сообщения (#51). Вычисляется в родителе (единый источник
// readWatermark/onlineOthers/sendState) и передаётся примитивом — так мемоизация строки
// работает без прокидывания меняющегося состояния.
export type MessageReadState = 'pending' | 'failed' | 'read' | 'delivered' | 'sent'

// Стабильный набор действий над сообщением. Родитель собирает его один раз (через ref),
// поэтому идентичность не меняется между рендерами — обязательное условие, чтобы memo реально
// пропускал перерисовку невизуально-изменившихся пузырей (#57).
export type MessageActions = {
  reply: (m: ChatMessage) => void
  openMenu: (m: ChatMessage, x: number, y: number) => void
  focus: (id: string) => void
  copy: (m: ChatMessage) => void
  forward: (m: ChatMessage) => void
  del: (m: ChatMessage) => void
  retry: (m: ChatMessage) => void
  toggleSelect: (id: string) => void
  react: (id: string, emoji: string) => void
  touchStart: (e: React.TouchEvent<HTMLDivElement>, m: ChatMessage) => void
  touchMove: (e: React.TouchEvent<HTMLDivElement>) => void
  touchEnd: (e: React.TouchEvent<HTMLDivElement>) => void
}

export type MessageItemProps = {
  m: ChatMessage
  mine: boolean
  firstOfRun: boolean
  // Первое сообщение в списке — без верхнего отступа серии.
  isFirstInList: boolean
  // Разделитель дня перед сообщением.
  showDay: boolean
  dayText: string | null
  // Разделитель «Непрочитанные» перед этим сообщением.
  isUnreadDivider: boolean
  highlighted: boolean
  selecting: boolean
  selected: boolean
  menuActive: boolean
  readState: MessageReadState
  readCount: number
  locale: string
  senderNameText: string
  // Бейдж роли отправителя (§21): «Преподаватель/Староста/Декан/Админ» или null (студенты — без бейджа).
  senderBadge: string | null
  replyToNameText: string | null
  forwardedFromNameText: string | null
  myId: string | undefined
  // Подсветка совпадений при активном in-chat поиске (§3); undefined — без подсветки.
  highlightTerm?: string
  actions: MessageActions
}

// Единый корневой узел на сообщение (день-пилюля + разделитель + строка) — обязательно для
// виртуализации (virtua): каждый ребёнок списка = один измеряемый элемент.
function MessageItemInner({
  m,
  mine,
  firstOfRun,
  isFirstInList,
  showDay,
  dayText,
  isUnreadDivider,
  highlighted,
  selecting,
  selected,
  menuActive,
  readState,
  readCount,
  locale,
  senderNameText,
  senderBadge,
  replyToNameText,
  forwardedFromNameText,
  myId,
  highlightTerm,
  actions,
}: MessageItemProps) {
  const t = useTranslations('Chats')

  const systemText = m.systemType
    ? t(SYSTEM_KEY[m.systemType] ?? 'sysEvent', {
        actor: senderNameText,
        target: m.systemMeta?.targetName ?? '',
        title: m.systemMeta?.title ?? '',
      })
    : null

  return (
    <div>
      {showDay && dayText && (
        <div className="my-2 flex justify-center">
          <span className="rounded-full bg-muted/90 px-3 py-0.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
            {dayText}
          </span>
        </div>
      )}
      {isUnreadDivider && (
        <div className="my-2 flex items-center gap-2 px-1">
          <span className="h-px flex-1 bg-primary/40" aria-hidden />
          <span className="text-xs font-medium text-primary">{t('unreadMessages')}</span>
          <span className="h-px flex-1 bg-primary/40" aria-hidden />
        </div>
      )}
      {m.systemType ? (
        <div className="my-1.5 flex justify-center px-4">
          <span className="max-w-[85%] rounded-full bg-muted/70 px-3 py-1 text-center text-xs text-muted-foreground">
            {systemText}
          </span>
        </div>
      ) : (
        <div
          id={`msg-${m.id}`}
          className={cn(
            // -mx-4/px-4 — фон подсветки на всю ширину чата; select-none + touch-action:pan-y — для тач-жестов.
            'group relative -mx-4 flex touch-pan-y items-center gap-1.5 px-4 py-0.5 transition-colors duration-700 ease-in-out select-none',
            !isFirstInList && (firstOfRun ? 'mt-2' : 'mt-0.5'),
            mine && 'flex-row-reverse',
            (highlighted || (selecting && selected)) && 'bg-primary/10',
            !selecting && menuActive && 'bg-primary/5',
            selecting && 'cursor-pointer',
          )}
          onContextMenu={
            selecting
              ? undefined
              : (e) => {
                  e.preventDefault()
                  actions.openMenu(m, e.clientX, e.clientY)
                }
          }
          onTouchStart={selecting ? undefined : (e) => actions.touchStart(e, m)}
          onTouchMove={selecting ? undefined : actions.touchMove}
          onTouchEnd={selecting ? undefined : actions.touchEnd}
        >
          {selecting && (
            <>
              {/* Оверлей ловит тап по всей строке → переключение выбора. */}
              <button
                type="button"
                aria-label={t('select')}
                onClick={() => actions.toggleSelect(m.id)}
                className="absolute inset-0 z-20"
              />
              <span
                className={cn(
                  'z-10 flex size-5 shrink-0 items-center justify-center rounded-full border',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/40',
                )}
              >
                {selected && <Check className="size-3.5" aria-hidden />}
              </span>
            </>
          )}
          {!mine &&
            (firstOfRun ? (
              <ProfileLink userId={m.senderId} className="shrink-0 self-end">
                <Avatar className="size-7">
                  <AvatarFallback>
                    {(m.sender.lastName[0] ?? '') + (m.sender.firstName[0] ?? '')}
                  </AvatarFallback>
                </Avatar>
              </ProfileLink>
            ) : (
              // Спейсер сохраняет место аватара — пузыри серии остаются выровненными.
              <span className="size-7 shrink-0" aria-hidden />
            ))}
          <div
            data-bubble
            className={cn(
              'relative max-w-[75%] rounded-2xl px-3 py-2 text-sm',
              mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
            )}
          >
            {/* Быстрая кнопка «Ответить» при наведении. У своих — слева, у чужих — справа. */}
            <button
              type="button"
              aria-label={t('reply')}
              onClick={() => actions.reply(m)}
              className={cn(
                'absolute -top-2 z-10 flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100',
                mine ? '-left-2' : '-right-2',
              )}
            >
              <Reply className="size-3.5" aria-hidden />
            </button>
            {!mine && firstOfRun && (
              <p className="mb-0.5 flex items-center gap-1.5 text-xs">
                <ProfileLink
                  userId={m.senderId}
                  className="truncate font-medium opacity-70 hover:underline"
                >
                  {senderNameText}
                </ProfileLink>
                {senderBadge && (
                  <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[0.6rem] font-medium text-primary">
                    {senderBadge}
                  </span>
                )}
              </p>
            )}
            {m.replyTo && (
              <button
                type="button"
                onClick={() => m.replyTo && actions.focus(m.replyTo.id)}
                className={cn(
                  'mb-1 block w-full rounded-md border-l-2 py-0.5 pl-2 text-left text-xs transition-colors',
                  mine
                    ? 'border-primary-foreground/50 opacity-80 hover:bg-primary-foreground/10'
                    : 'border-primary/50 opacity-75 hover:bg-primary/10',
                )}
              >
                <span className="font-medium">{replyToNameText}</span>
                <p className="line-clamp-2">{m.replyTo.content || t('attachment')}</p>
              </button>
            )}
            {m.forwardedFrom && (
              // §8: «Переслано от @User» → переход к профилю исходного автора (ProfileLink чтит приватность).
              <ProfileLink
                userId={m.forwardedFrom.senderId}
                className="mb-0.5 flex items-center gap-1 text-xs italic opacity-70 hover:underline"
              >
                <Forward className="size-3" aria-hidden />
                {t('forwardedFrom', { name: forwardedFromNameText ?? '' })}
              </ProfileLink>
            )}
            {/* Медиа/вложения сверху, подпись — всегда снизу (как в Telegram). */}
            {m.media.length > 0 && (
              <MessageAttachments
                media={m.media}
                mine={mine}
                viewerMeta={{
                  senderName: senderNameText,
                  createdAt: m.createdAt,
                  mine,
                  caption: m.content,
                }}
                viewerActions={{
                  onGoTo: () => actions.focus(m.id),
                  onCopy: () => actions.copy(m),
                  onForward: () => actions.forward(m),
                  onDelete: () => actions.del(m),
                }}
              />
            )}
            {m.sharedPost && (
              <div className={cn(m.media.length > 0 && 'mt-1')}>
                <SharedPostCard post={m.sharedPost} />
              </div>
            )}
            {m.poll ? (
              <ChatPollView poll={m.poll} mine={mine} viewerId={myId} />
            ) : (
              m.content && (
                <div className={cn((m.media.length > 0 || m.sharedPost) && 'mt-1')}>
                  <MessageContent content={m.content} highlight={highlightTerm} />
                </div>
              )
            )}
            {m.linkPreview && <LinkPreviewCard preview={m.linkPreview} mine={mine} />}
            <span
              className={cn(
                'mt-0.5 flex items-center gap-1 text-[0.65rem]',
                mine ? 'justify-end' : 'justify-start',
              )}
            >
              {m.pinnedAt && <Pin className="size-2.5 opacity-60" aria-hidden />}
              <span className="opacity-60">
                {new Date(m.createdAt).toLocaleTimeString(locale, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {m.editedAt && ` · ${t('edited')}`}
              </span>
              {mine && readState === 'pending' && (
                <Loader2 className="size-3 animate-spin opacity-60" aria-label={t('sending')} />
              )}
              {mine && readState === 'failed' && (
                <button
                  type="button"
                  onClick={() => actions.retry(m)}
                  aria-label={t('sendFailedRetry')}
                  title={t('sendFailedRetry')}
                >
                  <AlertCircle className="size-3.5 text-destructive" aria-hidden />
                </button>
              )}
              {mine && readState === 'read' && (
                <span
                  className="flex items-center gap-0.5"
                  title={readCount > 0 ? t('readByCount', { count: readCount }) : undefined}
                >
                  <CheckCheck className="size-3.5 text-sky-300" aria-hidden />
                  {readCount > 0 && (
                    <span className="text-[10px] leading-none opacity-70">{readCount}</span>
                  )}
                </span>
              )}
              {mine && readState === 'delivered' && (
                <CheckCheck className="size-3.5 opacity-60" aria-hidden />
              )}
              {mine && readState === 'sent' && (
                <Check className="size-3.5 opacity-60" aria-hidden />
              )}
            </span>
            <ReactionBar
              reactions={m.reactions}
              myId={myId}
              ownBubble={mine}
              onToggle={(emoji) => actions.react(m.id, emoji)}
            />
          </div>
          {/* Кнопка-шеврон открывает контекстное меню (как в Telegram) */}
          <button
            type="button"
            aria-label={t('messageActions')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              actions.openMenu(m, r.left, r.bottom)
            }}
            className="flex size-6 shrink-0 items-center justify-center self-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          >
            <ChevronDown className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}

// Мемоизация: пропущенные пузыри не перерисовываются при новом сообщении / вводе в composer.
// `m` сохраняет ссылочную идентичность, пока сообщение не изменилось (react-query патчит список
// через map с сохранением ссылок), поэтому шэллоу-сравнения достаточно; `actions` стабилен.
export const MessageItem = memo(MessageItemInner)
