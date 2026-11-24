'use client'

import { memo, useRef, type CSSProperties, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Check, ChevronDown } from 'lucide-react'
import {
  ChatPollView,
  formatViews,
  isVideoNote,
  isViewable,
  MessageAttachments,
  MessageChecklistView,
  MessageContactCard,
  MessageContent,
  MessageLocationCard,
  type ChatMessage,
} from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import {
  ChatSharedPost,
  ChatSharedProfile,
  ChatSharedStory,
  parseProfileShare,
} from './shared-cards'
import { identityAccent } from '../../../shared/lib'
import { ReactionsStrip } from './reactions-strip'
import { UnreadDivider } from './message-list-divider'
import { cn } from '../../../shared/lib/utils'
import { emojiOnlyCount } from '../lib/message-emoji'
import { MessageForwarded } from './message-forwarded'
import { MessageGroupAvatar } from './message-group-avatar'
import {
  META_SPACER_CLASS,
  MessageMeta,
  messageTime,
  metaSpacerStyle,
  type MessageMetaVariant,
} from './message-meta'
import { MessageReplyQuote } from './message-reply-quote'
import { MessageTail, mediaTailStyle } from './message-tail'
import { MessageWebPage } from './message-web-page'
import { centerOf, type FlightPoint } from '../lib/reaction-flight'

// Системные события группы (§20) → i18n-ключ. Текст строит клиент из actor/target/title.
// Ключ текста служебного сообщения по его типу — общий для пузыря и превью в списке чатов.
export const SYSTEM_KEY: Record<string, string> = {
  member_added: 'sysMemberAdded',
  member_removed: 'sysMemberRemoved',
  member_left: 'sysMemberLeft',
  member_joined: 'sysMemberJoined',
  member_banned: 'sysMemberBanned',
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
  /** Нажали на пилюлю даты — календарь переписки на этом дне ("YYYY-MM-DD"). */
  openCalendar: (ymd: string) => void
  openMenu: (m: ChatMessage, x: number, y: number) => void
  focus: (id: string) => void
  copy: (m: ChatMessage) => void
  forward: (m: ChatMessage) => void
  del: (m: ChatMessage) => void
  retry: (m: ChatMessage) => void
  /** Прервать загрузку вложений ещё не отправленного сообщения (крестик в оверлее). */
  cancelUpload: (m: ChatMessage) => void
  toggleSelect: (id: string) => void
  /** Ctrl/Cmd + клик по сообщению — вход в режим выделения прямо с него (§5 карты). */
  startSelect: (m: ChatMessage) => void
  /** Снимок лёг в буфер обмена (или не лёг) — сообщить об этом умеет только приложение. */
  copiedImage: (ok: boolean) => void
  /** `origin` — откуда вылетает поставленная реакция (lib/reaction-flight); нет — без полёта. */
  react: (id: string, emoji: string, origin?: FlightPoint) => void
  /** Кто отреагировал (правый клик по чипу реакции) — окно со списком, с вкладкой эмодзи. */
  showReactors?: (m: ChatMessage, emoji?: string) => void
  touchStart: (e: React.TouchEvent<HTMLDivElement>, m: ChatMessage) => void
  touchMove: (e: React.TouchEvent<HTMLDivElement>) => void
  touchEnd: (e: React.TouchEvent<HTMLDivElement>) => void
}

export type MessageItemProps = {
  m: ChatMessage
  mine: boolean
  /**
   * Группа или канал: у чужих сообщений аватар и имя автора. В личном чате их нет — собеседник
   * один и так в шапке, как в Telegram.
   */
  isGroup: boolean
  /** Первое сообщение серии одного автора (lib/message-run): у него имя автора. */
  firstOfRun: boolean
  /** Последнее сообщение серии: у него хвостик пузыря и аватар автора. */
  lastOfRun: boolean
  /** id первого сообщения серии — только у последнего: до него «прилипает» аватар. */
  runStartId?: string
  /** Первое сообщение календарного дня — перед ним идёт пометка даты. */
  showDay: boolean
  dayText: string | null
  // Первое сообщение в списке — без верхнего отступа серии.
  isFirstInList: boolean
  // Разделитель «Непрочитанные» перед этим сообщением.
  isUnreadDivider: boolean
  highlighted: boolean
  selecting: boolean
  selected: boolean
  menuActive: boolean
  readState: MessageReadState
  readCount: number
  /** Просмотры официального чата (как у постов канала Telegram); 0 и undefined не рисуются. */
  views?: number
  locale: string
  senderNameText: string
  // Бейдж роли отправителя (§21): «Преподаватель/Староста/Декан/Админ» или null (студенты — без бейджа).
  senderBadge: string | null
  replyToNameText: string | null
  forwardedFromNameText: string | null
  myId: string | undefined
  // Подсветка совпадений при активном in-chat поиске (§3); undefined — без подсветки.
  highlightTerm?: string
  /**
   * Быстрая реакция (своя, из настроек чатов — `GET /chats/settings`): её ставит кнопка у
   * пузыря при наведении, как и двойной клик по сообщению.
   */
  quickReaction: string
  actions: MessageActions
}

// Скругления пузыря, как в Telegram: большой радиус снаружи серии (у Telegram 15 px), малый —
// на стыке соседних сообщений одного автора (6 px), прямой угол — там, где растёт хвостик.
const R_BIG = 'var(--radius-xl)'
const R_SMALL = 'var(--radius-sm)'

type Corners = { tl: string; tr: string; br: string; bl: string }

function bubbleCorners(mine: boolean, first: boolean, last: boolean, tail: boolean): Corners {
  const top = first ? R_BIG : R_SMALL
  const bottom = last ? (tail ? '0' : R_SMALL) : R_SMALL
  return mine
    ? { tl: R_BIG, tr: top, br: bottom, bl: R_BIG }
    : { tl: top, tr: R_BIG, br: R_BIG, bl: bottom }
}

const radius = (c: Corners): string => `${c.tl} ${c.tr} ${c.br} ${c.bl}`

/**
 * Плашка пометки дня и служебного сообщения — одна, как в Telegram: светлый полужирный текст
 * на полупрозрачной подложке тона обоев (обои переписки — оттенок primary, см. ChatWallpaper).
 * Скругление не «full»: длинное служебное сообщение переносится, и у двухстрочной таблетки
 * края съедали бы буквы.
 */
export const SERVICE_PILL_CLASS =
  'rounded-[0.9375rem] bg-primary/60 px-2 py-0.5 text-sm leading-tight font-medium text-primary-foreground'

// Крупные эмодзи без пузыря (Telegram): один — крупнее всего, три — мельче.
const BIG_EMOJI_SIZE = ['', 'text-[5rem]', 'text-[4rem]', 'text-[3.5rem]'] as const

// Единый корневой узел на сообщение (день-пилюля + разделитель + строка) — обязательно для
// окна ленты (MessageWindow): каждый ребёнок списка = одна строка окна.
function MessageItemInner({
  m,
  mine,
  isGroup,
  firstOfRun,
  lastOfRun,
  runStartId,
  showDay,
  dayText,
  isFirstInList,
  isUnreadDivider,
  highlighted,
  selecting,
  selected,
  menuActive,
  readState,
  readCount,
  views,
  locale,
  senderNameText,
  senderBadge,
  replyToNameText,
  forwardedFromNameText,
  myId,
  highlightTerm,
  quickReaction,
  actions,
}: MessageItemProps) {
  const t = useTranslations('Chats')
  // Были ли реакции, когда строка появилась в ленте: тогда первые чипы стоят без анимации.
  const hadReactionsAtMount = useRef(m.reactions.length > 0).current

  const systemText = m.systemType
    ? t(SYSTEM_KEY[m.systemType] ?? 'sysEvent', {
        actor: senderNameText,
        target: m.systemMeta?.targetName ?? '',
        title: m.systemMeta?.title ?? '',
      })
    : null
  // Пересланный профиль приходит текстом «Имя + ссылка» — узнаём и рисуем карточкой.
  const storyCard = !!m.sharedStory || !!m.sharedStoryReply
  const profileShare = m.sharedPost || m.poll || storyCard ? null : parseProfileShare(m.content)

  // ── Из чего состоит пузырь — от этого зависят форма, отступы и место времени ──
  const special = !!(m.poll || m.location || m.contact || m.checklist || profileShare)
  const hasText = !special && !!m.content
  const hasPreview = !!m.linkPreview && !profileShare
  const showName = !mine && isGroup && firstOfRun
  const hasHeader = showName || !!m.forwardedFrom || !!m.replyTo
  const hasReactions = m.reactions.length > 0
  // Сообщение из 1–3 эмодзи — крупно и без пузыря (Telegram).
  const bigEmoji =
    hasText &&
    m.media.length === 0 &&
    !hasPreview &&
    !m.sharedPost &&
    !storyCard &&
    !m.forwardedFrom
      ? emojiOnlyCount(m.content)
      : 0
  // Кружок (видеосообщение) без подписи и карточек — круг без пузыря, как в Telegram.
  const roundOnly =
    m.media.length === 1 &&
    !!m.media[0] &&
    isVideoNote(m.media[0]) &&
    !hasText &&
    !special &&
    !hasPreview &&
    !m.sharedPost &&
    !storyCard
  // Крупные эмодзи и кружок живут без пузыря: подложка у них — только под временем.
  const bare = bigEmoji > 0 || roundOnly
  // Снимки и видео без файлов — от края до края пузыря, как в Telegram.
  const mediaOnly = m.media.length > 0 && m.media.every(isViewable)
  const hasBelowMedia = hasText || special || !!m.sharedPost || storyCard || hasPreview
  // Снимок — последнее в пузыре (ни подписи, ни реакций под ним): время лежит плашкой на кадре.
  const mediaLast = mediaOnly && !hasBelowMedia && !hasReactions
  // А если над ним нет и шапки — пузыря нет вовсе, только сам кадр.
  const mediaBare = mediaLast && !hasHeader
  // Хвостик — у пузыря с краем снизу. Кадр в нижнем углу его не носит: синий хвостик,
  // торчащий из фотографии, читался бы как ошибка вёрстки.
  const tail = lastOfRun && !bare && !mediaLast
  const corners = bubbleCorners(mine, firstOfRun, lastOfRun, tail)
  // Снимок совсем без пузыря — другое дело: хвостик у него есть, но не цветной фигурой, а
  // маской самого кадра (mediaTailStyle) — угол фотографии вытягивается в хвостик.
  const mediaTail = lastOfRun && mediaBare

  // Где время: в последней строке текста, плашкой на кадре, капсулой под крупными эмодзи
  // или отдельной строкой (под карточкой, превью ссылки, рядом с реакциями).
  const metaVariant: MessageMetaVariant = bare
    ? 'float'
    : mediaLast
      ? 'media'
      : hasText && !hasPreview && !hasReactions
        ? 'text'
        : 'flow'
  const editedLabel = m.editedAt ? t('tgBubbles.edited') : null
  const meta = (variant: MessageMetaVariant): ReactNode => (
    <MessageMeta
      createdAt={m.createdAt}
      edited={!!m.editedAt}
      pinned={!!m.pinnedAt}
      mine={mine}
      readState={readState}
      readCount={readCount}
      locale={locale}
      variant={variant}
      onRetry={() => actions.retry(m)}
      views={views}
    />
  )
  const spacerStyle: CSSProperties | undefined =
    metaVariant === 'text'
      ? metaSpacerStyle({
          time: messageTime(m.createdAt, locale),
          editedLabel,
          pinned: !!m.pinnedAt,
          mine,
          readState,
          readCount,
          viewsLabel: views ? formatViews(views, locale) : null,
        })
      : undefined

  // Шапка пузыря: имя автора цветом человека, «Переслано от», цитата ответа. У крупных
  // эмодзи пузыря нет — шапка встаёт над ними отдельной плашкой, и цвета там
  // «чужого» пузыря: светлое на светлом было бы нечитаемо.
  const headerMine = mine && !bare
  const header = hasHeader && (
    <div
      className={cn(
        'min-w-0',
        // Шапка не раздвигает пузырь шире снимка: ширину задаёт кадр (см. mediaOnly ниже).
        mediaOnly && '[contain:inline-size]',
        bare && 'mb-1 max-w-64 rounded-xl bg-card/90 px-2 py-1 shadow-xs',
      )}
    >
      {showName && (
        <p className="mb-0.5 flex min-w-0 items-center gap-1.5 text-sm leading-tight">
          <ProfileLink
            userId={m.senderId}
            className={cn(
              'truncate font-semibold hover:underline',
              identityAccent(m.senderId).text,
            )}
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
      {m.forwardedFrom && (
        <MessageForwarded origin={m.forwardedFrom} name={forwardedFromNameText} mine={headerMine} />
      )}
      {m.replyTo && (
        <MessageReplyQuote
          replyTo={m.replyTo}
          quote={m.replyQuote}
          name={replyToNameText}
          mine={headerMine}
          onOpen={actions.focus}
        />
      )}
    </div>
  )

  const attachments = m.media.length > 0 && (
    <MessageAttachments
      media={m.media}
      mine={mine}
      // Отменять есть что только у своего, ещё не доехавшего сообщения.
      // Упавшее отменять нечего — там повтор.
      onCancel={
        readState !== 'failed' && m.id.startsWith('tmp:') && m.media.some((a) => a.uploading)
          ? () => actions.cancelUpload(m)
          : undefined
      }
      // Пузырь знает, что отправка упала, — вложения обязаны узнать тоже.
      // Без этого они навсегда оставались со спиннером на «0 / 312.8 МБ».
      sendFailed={mine && readState === 'failed'}
      onRetry={() => actions.retry(m)}
      viewerMeta={{
        senderName: senderNameText,
        senderAvatarUrl: m.sender.avatarUrl,
        createdAt: m.createdAt,
        mine,
        caption: m.content,
      }}
      viewerActions={{
        onGoTo: () => actions.focus(m.id),
        onCopy: () => actions.copy(m),
        onCopiedImage: (ok) => actions.copiedImage(ok),
        onForward: () => actions.forward(m),
        onDelete: () => actions.del(m),
      }}
      // Просмотрщик листает все фото и видео чата, а не только вложения этого сообщения.
      messageId={m.id}
      mediaRail={{ chatId: m.chatId, myId, actions }}
    />
  )

  let body: ReactNode
  if (bigEmoji > 0) {
    body = (
      <>
        {header}
        {/* Без markdown: эмодзи и есть всё сообщение. Отступ снизу — под капсулу времени. */}
        <p className={cn('pb-5 leading-none tracking-tight select-text', BIG_EMOJI_SIZE[bigEmoji])}>
          {m.content.replace(/\s+/g, '')}
        </p>
      </>
    )
  } else if (roundOnly) {
    // Кружок: шапка (имя, ответ, «переслано») — плашкой над кругом, сам круг без пузыря.
    body = (
      <>
        {header}
        {attachments}
      </>
    )
  } else {
    body = (
      <>
        {header}
        {/* Медиа/вложения сверху, подпись — всегда снизу (как в Telegram). Снимки и видео
            выходят на края пузыря: их углы повторяют углы пузыря, а там, где к ним
            примыкает шапка или подпись, — прямые. */}
        {attachments &&
          (mediaOnly && !mediaBare ? (
            <div
              className={cn(
                '-mx-2 overflow-hidden [&_.rounded-lg]:rounded-none [&>div]:mt-0',
                hasHeader ? 'mt-1' : '-mt-1.25',
                hasBelowMedia ? 'mb-1' : hasReactions ? 'mb-0.5' : '-mb-1.5',
              )}
              style={{
                borderRadius: radius({
                  tl: hasHeader ? '0' : corners.tl,
                  tr: hasHeader ? '0' : corners.tr,
                  br: hasBelowMedia || hasReactions ? '0' : corners.br,
                  bl: hasBelowMedia || hasReactions ? '0' : corners.bl,
                }),
              }}
            >
              {attachments}
            </div>
          ) : mediaBare ? (
            <div
              className="overflow-hidden [&_.rounded-lg]:rounded-none [&>div]:mt-0"
              style={mediaTail ? mediaTailStyle(mine, corners) : { borderRadius: radius(corners) }}
            >
              {attachments}
            </div>
          ) : (
            attachments
          ))}
        {m.sharedPost && (
          <div className={cn(m.media.length > 0 && 'mt-1')}>
            <ChatSharedPost post={m.sharedPost} mine={mine} />
          </div>
        )}
        {storyCard && (
          <div className={cn(m.media.length > 0 && 'mt-1')}>
            <ChatSharedStory story={m.sharedStory} reply={!!m.sharedStoryReply} mine={mine} />
          </div>
        )}
        {m.poll ? (
          <ChatPollView poll={m.poll} mine={mine} viewerId={myId} />
        ) : m.location ? (
          <MessageLocationCard
            location={m.location}
            mine={mine}
            messageId={m.id}
            chatId={m.chatId}
          />
        ) : m.contact ? (
          <MessageContactCard contact={m.contact} mine={mine} />
        ) : m.checklist ? (
          <MessageChecklistView
            checklist={m.checklist}
            mine={mine}
            chatId={m.chatId}
            viewerId={myId}
          />
        ) : profileShare ? (
          // Пересланный профиль — карточкой вместо сырого «Имя + ссылка».
          <div className={cn(m.media.length > 0 && 'mt-1')}>
            <ChatSharedProfile userId={profileShare.userId} name={profileShare.name} mine={mine} />
          </div>
        ) : (
          hasText && (
            // select-text точечно снимает select-none со строки: он там ради тач-жестов
            // (свайп-ответ, long-press), а выделять нужно именно текст — из него делается
            // цитата при ответе. Распорка в конце последнего абзаца держит место под время.
            <div
              className={cn(
                'select-text',
                metaVariant === 'text' && META_SPACER_CLASS,
                ((m.media.length > 0 && !mediaOnly) || m.sharedPost || storyCard) && 'mt-1',
              )}
              style={spacerStyle}
            >
              <MessageContent content={m.content} highlight={highlightTerm} />
            </div>
          )
        )}
        {/* Превью ссылки у пересланного профиля не нужно: карточка уже и есть превью. */}
        {hasPreview && m.linkPreview && (
          <div className={cn(mediaOnly && '[contain:inline-size]')}>
            <MessageWebPage preview={m.linkPreview} mine={mine} />
          </div>
        )}
      </>
    )
  }

  return (
    <div>
      {/* Пометка дня идёт в потоке ленты, а прилипший заголовок вверху подхватывает её,
          когда она уезжает под верх (chat-window) — так дата видна и на месте, и всегда. */}
      {showDay && dayText && (
        <div className="my-3 flex justify-center">
          {/* Нажатие на дату — календарь переписки на этом дне, как в Telegram. */}
          <button
            type="button"
            onClick={() => {
              const d = new Date(m.createdAt)
              actions.openCalendar(
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
              )
            }}
            aria-label={t('openCalendar', { date: dayText })}
            className={cn(
              SERVICE_PILL_CLASS,
              'transition-colors hover:bg-primary/70 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
            )}
          >
            {dayText}
          </button>
        </div>
      )}
      {isUnreadDivider && <UnreadDivider />}
      {m.systemType ? (
        // Служебное сообщение (Telegram): капсула по центру ленты, без автора и времени.
        <div className="my-2 flex justify-center px-4">
          <span
            className={cn(
              SERVICE_PILL_CLASS,
              'max-w-[min(85%,28rem)] text-center [overflow-wrap:anywhere]',
            )}
          >
            {systemText}
          </span>
        </div>
      ) : (
        <div
          id={`msg-${m.id}`}
          className={cn(
            // -mx-4/px-4 — фон подсветки на всю ширину чата; select-none + touch-action:pan-y — для тач-жестов.
            'group relative -mx-4 flex touch-pan-y items-center gap-1.5 px-4 py-0.5 transition-colors duration-(--motion-control) select-none',
            // Интервалы Telegram: внутри серии пузыри почти касаются, между сериями — заметный
            // зазор (на телефоне плотнее).
            !isFirstInList && (firstOfRun ? 'mt-0.75 sm:mt-1.5' : 'sm:mt-0.5'),
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
          onClick={
            selecting
              ? undefined
              : (e) => {
                  if (!e.ctrlKey && !e.metaKey) return
                  // Ctrl/Cmd по ссылке или кнопке внутри пузыря — это «открыть в новой
                  // вкладке» и скачивание вложения; забирать их себе нельзя.
                  if ((e.target as HTMLElement).closest('a,button')) return
                  e.preventDefault()
                  actions.startSelect(m)
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
            isGroup &&
            (lastOfRun ? (
              // Аватар — у нижнего сообщения серии и прилипает к низу ленты (Telegram).
              <MessageGroupAvatar sender={m.sender} runStartId={runStartId} />
            ) : (
              // Спейсер сохраняет место аватара — пузыри серии остаются выровненными.
              <span className="w-8 shrink-0" aria-hidden />
            ))}
          <div
            data-bubble
            className={cn(
              'relative max-w-[min(30rem,85%)] min-w-0 text-sm',
              // Текст сообщения — 16 px со строкой 21 px, как в Telegram. Сам стиль разметки
              // (MD_CLASS) общий с обсуждениями и поддержкой, поэтому размер задаёт пузырь.
              '[&_.message-md]:text-base [&_.message-md]:leading-[1.3125]',
              !bare &&
                !mediaBare &&
                cn(
                  // Чужой пузырь — белый лист над обоями с тенью в пиксель, как в Telegram:
                  // серый на голубых обоях терялся. Тень здесь — по исключению «элемент поверх
                  // изображения» (DESIGN_SYSTEM §5.2): кольцу на узоре обоев не на чем держаться.
                  'px-2 pt-1.25 pb-1.5 shadow-xs',
                  // В тёмной теме card почти сливается с обоями — там пузырь на ступень светлее,
                  // как #212121 на почти чёрном фоне у Telegram.
                  mine
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-card-foreground dark:bg-muted',
                ),
              // Подпись и шапка не раздвигают пузырь шире снимка — ширину задаёт кадр.
              mediaOnly && 'w-min',
              mediaOnly && !mediaBare && 'min-w-[min(15rem,100%)]',
              bare && 'flex flex-col items-start',
              bare && mine && 'items-end',
            )}
            style={bare ? undefined : { borderRadius: radius(corners) }}
          >
            {tail && <MessageTail mine={mine} />}
            {/* Быстрая реакция при наведении: один клик — «огонь», повторный снимает её.
                У своих — слева, у чужих — справа. Раньше здесь была кнопка «Ответить», но
                ответ и так висит на свайпе и в контекстном меню, а поставить реакцию мышью
                было больше некуда, кроме как через то же меню. Остальные эмодзи — там же
                (CHAT_REACTION_EMOJIS), сбоку у низа пузыря стоит первый из них по частоте. */}
            <button
              type="button"
              aria-label={t('quickReaction', { emoji: quickReaction })}
              title={t('quickReaction', { emoji: quickReaction })}
              onClick={(e) => actions.react(m.id, quickReaction, centerOf(e.currentTarget))}
              // Снаружи пузыря, вровень с его низом: внахлёст на верхнем углу кнопка закрывала
              // имя отправителя. Сбоку у низа она не заслоняет ни текст, ни время с галочками.
              className={cn(
                'absolute bottom-0 z-10 flex size-6 items-center justify-center rounded-full border border-border bg-background text-xs leading-none opacity-0 shadow-sm transition-[opacity,transform] hover:scale-110 focus-visible:opacity-100 active:scale-95 group-hover:opacity-100',
                mine ? 'right-full mr-1.5' : 'left-full ml-1.5',
                // Хвостик торчит из пузыря на 8px — кнопка встаёт за ним, а не на нём.
                tail && (mine ? 'mr-3.5' : 'ml-3.5'),
              )}
            >
              <span aria-hidden>{quickReaction}</span>
            </button>
            {/* Шеврон меню (как в Telegram) — над быстрой реакцией, одной колонкой у низа
                пузыря. Раньше он стоял по центру всей строки: у высокого снимка две кнопки
                висели в пустоте на разной высоте, у короткого — перекрывали друг друга. */}
            <button
              type="button"
              aria-label={t('messageActions')}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                actions.openMenu(m, r.left, r.bottom)
              }}
              className={cn(
                'absolute bottom-7 z-10 flex size-6 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100',
                mine ? 'right-full mr-1.5' : 'left-full ml-1.5',
                tail && (mine ? 'mr-3.5' : 'ml-3.5'),
              )}
            >
              <ChevronDown className="size-4" aria-hidden />
            </button>
            {bare ? (
              <div className="relative">
                {body}
                {meta('float')}
              </div>
            ) : (
              body
            )}
            {metaVariant === 'media' && meta('media')}
            {metaVariant === 'text' && meta('text')}
            {/* Реакции — строкой под содержимым, время — в той же строке справа (Telegram).
                Много реакций переносятся, время остаётся в последней строке. */}
            {hasReactions ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <ReactionsStrip
                  reactions={m.reactions}
                  myId={myId}
                  ownBubble={mine && !bare}
                  animateFromStart={!hadReactionsAtMount}
                  onToggle={(emoji, origin) => actions.react(m.id, emoji, origin)}
                  onShowReactors={
                    actions.showReactors ? (emoji) => actions.showReactors?.(m, emoji) : undefined
                  }
                />
                {metaVariant === 'flow' && meta('flow')}
              </div>
            ) : (
              metaVariant === 'flow' && (
                <div className="mt-0.5 flex justify-end">{meta('flow')}</div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Мемоизация: пропущенные пузыри не перерисовываются при новом сообщении / вводе в composer.
// `m` сохраняет ссылочную идентичность, пока сообщение не изменилось (react-query патчит список
// через map с сохранением ссылок), поэтому шэллоу-сравнения достаточно; `actions` стабилен.
export const MessageItem = memo(MessageItemInner)
