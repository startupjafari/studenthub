'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ArrowLeft, ChevronLeft, Pencil, UserPlus, X } from 'lucide-react'
import { chatKeys, fetchChatMembers, type ChatListItem } from '../../../entities/chat'
import { fetchUserById, userKeys } from '../../../entities/user'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { isOfficialChat } from '../lib/format'
import { ChatMembersList, lastSeenText } from './chat-members-list'
import { EditGroupDialog } from './edit-group-dialog'
import {
  AddMembersScreen,
  GroupManagement,
  MANAGE_TITLE,
  manageParent,
  type ManageScreen,
} from './group-management'
import { ProfileHero, withViewTransition } from './profile-hero'
import {
  ChatActionsCard,
  GroupInfoRows,
  InfoCard,
  NotificationsRow,
  PeerInfoRows,
} from './profile-info-card'
import { FileTab, GifTab, LinksTab, MediaTab, PollsTab } from './shared-media'

// Панель вкладки: flex-колонка не ниже экрана колонки — иначе на короткой вкладке
// прилипшие вкладки отрывались бы от верха при переключении. `data-[state=active]:flex`,
// а не `flex`: у неактивной вкладки Radix ставит `hidden`, и класс display его бы перебил.
const TAB_PANE = 'mt-0 min-h-[calc(100dvh-9rem)] flex-col data-[state=active]:flex'

/** Насколько надо «дотянуть» колесом вверх у самого верха, чтобы развернуть фото. */
const OVERSCROLL_EXPAND_PX = 80

type Screen = ManageScreen | 'addMembers' | null

/** Кнопка шапки колонки: того же размера, что у шапки чата, — обе шапки одной высоты. */
const HEADER_BTN =
  'flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/20 active:scale-90'

/**
 * Правая колонка чата (Telegram-стиль §55): профиль, сведения и общие материалы.
 *
 * Колонка прокручивается целиком, как в Telegram: сверху шапка профиля (аватар разворачивается
 * в фото на всю ширину), под ней карточка сведений с уведомлениями, ниже — вкладки общих
 * материалов, которые прилипают к верху, когда до них докрутили. Карандаш в шапке (у админов
 * группы) открывает управление группой — экраны сменяют профиль внутри той же колонки.
 *
 * Где и как колонка показана (рядом с перепиской или поверх) — решает `RightColumn`;
 * `variant` влияет только на значок закрытия: в доке — крестик, на телефоне — стрелка назад.
 */
export function ChatDetailsPanel({
  chat,
  title,
  isPrivate,
  peerOnline = false,
  myId,
  variant = 'column',
  open = true,
  onClose,
  onMute,
  onUnmute,
  peerId,
  peerBlocked = false,
  onToggleBlock,
  onJump,
  onLeft,
  onOpenChat,
}: {
  chat: ChatListItem
  title: string
  isPrivate: boolean
  peerOnline?: boolean
  myId: string | undefined
  variant?: 'column' | 'fullscreen'
  /**
   * Панель показана прямо сейчас. Колонка на ПК не размонтируется при закрытии (её
   * ширина анимируется), поэтому без этого флага она открывалась бы на той вкладке и том
   * экране, где её закрыли, — а открываться она должна с начала.
   */
  open?: boolean
  onClose: () => void
  // §17: заглушить на время (minutes) или навсегда ('forever'); onUnmute — включить.
  // importantOnly — режим «только важные»: ответы мне и упоминания уведомляют и в mute.
  onMute: (mode: number | 'forever', importantOnly?: boolean) => void
  onUnmute: () => void
  /** Собеседник личного чата — о нём сведения и фото в шапке. */
  peerId?: string
  peerBlocked?: boolean
  onToggleBlock?: () => void
  onJump: (messageId: string) => void
  // Вышел из группы — родитель закрывает панель и сбрасывает активный чат.
  onLeft: () => void
  // Открыть личный чат с участником (создаётся при необходимости).
  onOpenChat: (chatId: string) => void
}) {
  const t = useTranslations('Chats')
  const isGroup = !isPrivate
  const isSaved = chat.type === 'SAVED'
  // Сведения о собеседнике есть только там, где он один: у «Избранного» и групп их нет.
  const peer = isPrivate && peerId && onToggleBlock ? { id: peerId, onToggleBlock } : null
  // Аватар группы меняет владелец, название — любой админ: управление открывается по любому.
  const canEdit = isGroup && (chat.isAdmin || chat.isOwner)

  const [screen, setScreen] = useState<Screen>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const firstTab = isGroup ? 'participants' : 'media'
  // Тип — string: Radix отдаёт в onValueChange обычную строку.
  const [tab, setTab] = useState<string>(firstTab)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabsAnchorRef = useRef<HTMLDivElement>(null)

  // Открылась заново — с начала: профиль, первая вкладка, верх колонки, фото свёрнуто.
  useEffect(() => {
    if (!open) return
    setTab(firstTab)
    setScreen(null)
    setExpanded(false)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [open, firstTab])

  // Участники — тот же кэш, что у переписки: статус «в сети» собеседника и счётчик группы.
  const members = useQuery({
    queryKey: chatKeys.members(chat.id),
    queryFn: () => fetchChatMembers(chat.id),
  })
  const user = useQuery({
    queryKey: userKeys.detail(peerId ?? ''),
    queryFn: () => fetchUserById(peerId as string),
    enabled: peer != null,
  })

  // Фото шапки: у собеседника — аватар и обложка профиля, у группы — её аватар. Истории
  // аватаров сервер не хранит, поэтому листаются только они.
  const hasPeer = peer != null
  const photos = useMemo(() => {
    const list = hasPeer
      ? [user.data?.avatarUrl ?? chat.avatarUrl, user.data?.coverUrl]
      : [chat.avatarUrl]
    return [...new Set(list.filter((x): x is string => Boolean(x)))]
  }, [hasPeer, user.data, chat.avatarUrl])

  const peerMember = peer ? members.data?.find((m) => m.id === peer.id) : undefined
  const onlineCount = (members.data ?? []).filter((m) => m.online && !m.banned).length
  const status = isSaved
    ? null
    : isPrivate
      ? peerOnline
        ? t('online')
        : peerMember?.lastSeenAt
          ? lastSeenText(peerMember.lastSeenAt, t)
          : t('tgRight.lastSeenRecently')
      : [
          t('participants', { count: chat.memberCount }),
          onlineCount > 0 ? t('membersOnline', { count: onlineCount }) : null,
        ]
          .filter(Boolean)
          .join(', ')

  // Смена идёт через View Transition, и состояние обновляется не сразу: колесо и прокрутка
  // успели бы запустить переход повторно на каждом событии. Флаг держит один переход за раз.
  const switching = useRef(false)
  useEffect(() => {
    switching.current = false
  }, [expanded])
  const setPhotoExpanded = (next: boolean): void => {
    if (switching.current || next === expanded) return
    if (next && photos.length === 0) return
    switching.current = true
    withViewTransition(() => {
      setExpanded(next)
      // Развёрнутое фото видно целиком: иначе первая же прокрутка свернула бы его обратно.
      if (next) scrollRef.current?.scrollTo({ top: 0 })
    })
  }
  const expand = (): void => setPhotoExpanded(true)
  // Слушатели колеса живут в эффекте — им нужна свежая функция без переподписки.
  const expandRef = useRef(expand)
  expandRef.current = expand

  // Развернуть фото, «дотянув» колесом или пальцем вверх у самого верха колонки — как
  // перетягивание в Telegram. Свернуть — обычной прокруткой вниз (onScroll ниже).
  useEffect(() => {
    const el = scrollRef.current
    if (!el || screen !== null || expanded || photos.length === 0) return
    let pull = 0
    let reset: number | undefined
    let touchY: number | null = null
    const trigger = (): void => {
      pull = 0
      expandRef.current()
    }
    const onWheel = (e: WheelEvent): void => {
      if (el.scrollTop > 0 || e.deltaY >= 0) {
        pull = 0
        return
      }
      pull -= e.deltaY
      window.clearTimeout(reset)
      reset = window.setTimeout(() => (pull = 0), 250)
      if (pull > OVERSCROLL_EXPAND_PX) trigger()
    }
    const onTouchStart = (e: TouchEvent): void => {
      touchY = el.scrollTop <= 0 ? (e.touches[0]?.clientY ?? null) : null
    }
    const onTouchMove = (e: TouchEvent): void => {
      if (touchY === null) return
      const y = e.touches[0]?.clientY
      if (y !== undefined && y - touchY > OVERSCROLL_EXPAND_PX) {
        touchY = null
        trigger()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    return () => {
      window.clearTimeout(reset)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
    }
  }, [screen, expanded, photos.length])

  function onScroll(): void {
    if (expanded && (scrollRef.current?.scrollTop ?? 0) > 12) setPhotoExpanded(false)
  }

  // Смена вкладки, когда вкладки уже прилипли: новая начинается с верха, под ними, а не с
  // того места, куда долистали предыдущую.
  function changeTab(next: string): void {
    setTab(next)
    const sc = scrollRef.current
    const anchor = tabsAnchorRef.current
    if (sc && anchor && sc.scrollTop > anchor.offsetTop) sc.scrollTop = anchor.offsetTop
  }

  function goTo(next: Screen): void {
    setScreen(next)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  function back(): void {
    if (screen === null) {
      onClose()
      return
    }
    goTo(screen === 'addMembers' ? null : manageParent(screen))
  }

  const headerTitle =
    screen === null
      ? isGroup
        ? t('tgRight.groupInfo')
        : t('details')
      : screen === 'addMembers'
        ? t('addMembers')
        : t(MANAGE_TITLE[screen])

  const showFab = screen === null && isGroup && chat.isAdmin && tab === 'participants'

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-background"
      onKeyDown={(e) => {
        // Esc внутри управления — шаг назад, а не закрытие всей колонки.
        // Открытое меню или окно Esc закрывает само — шаг назад в этот момент был бы лишним.
        if (e.key !== 'Escape' || screen === null || e.defaultPrevented) return
        if (!document.querySelector('[role="menu"],[role="dialog"],[role="alertdialog"]')) {
          e.preventDefault()
          e.stopPropagation()
          back()
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-3">
        <button
          type="button"
          aria-label={screen !== null || variant === 'fullscreen' ? t('back') : t('close')}
          onClick={back}
          className={HEADER_BTN}
        >
          {screen !== null ? (
            <ArrowLeft className="size-5" aria-hidden />
          ) : variant === 'column' ? (
            <X className="size-5" aria-hidden />
          ) : (
            <>
              {/* На телефоне колонка — экран, с него возвращаются стрелкой; на планшете
                  это остров поверх переписки, его закрывают крестиком. */}
              <ChevronLeft className="size-5 md:hidden" aria-hidden />
              <X className="hidden size-5 md:block" aria-hidden />
            </>
          )}
        </button>
        <span className="min-w-0 flex-1 truncate px-1 text-base font-semibold">{headerTitle}</span>
        {screen === null && canEdit && (
          <button
            type="button"
            aria-label={t('tgRight.manageTitle')}
            title={t('tgRight.manageTitle')}
            onClick={() => goTo('main')}
            className={HEADER_BTN}
          >
            <Pencil className="size-5" aria-hidden />
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        {screen === null ? (
          <>
            <ProfileHero
              id={chat.id}
              title={title}
              photos={photos}
              status={status}
              online={isPrivate && peerOnline}
              official={isOfficialChat(chat.type)}
              officialLabel={t('officialChat')}
              expanded={expanded}
              onExpand={expand}
            />

            {(!isSaved || peer) && (
              <InfoCard className={cn(expanded && 'mt-3')}>
                {peer && <PeerInfoRows userId={peer.id} />}
                {isGroup && <GroupInfoRows chat={chat} />}
                {!isSaved && <NotificationsRow chat={chat} onMute={onMute} onUnmute={onUnmute} />}
              </InfoCard>
            )}

            <ChatActionsCard
              chat={chat}
              peerBlocked={peerBlocked}
              onToggleBlock={peer?.onToggleBlock}
              onLeft={onLeft}
            />

            {/* Общие материалы. Вкладки прилипают к верху колонки, под ними — содержимое;
                сначала участники группы: «кто здесь» — вопрос раньше, чем «что присылали». */}
            <Tabs value={tab} onValueChange={changeTab} className="mt-3">
              <div ref={tabsAnchorRef} aria-hidden />
              <div className="sticky top-0 z-10 bg-background/85 px-3 py-2 backdrop-blur-md">
                <TabsList className="w-full sm:w-full" aria-label={t('tgRight.sharedTabs')}>
                  {isGroup && (
                    <TabsTrigger value="participants" className="flex-none">
                      {t('tabParticipants')}
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="media" className="flex-none">
                    {t('tabMedia')}
                  </TabsTrigger>
                  <TabsTrigger value="files" className="flex-none">
                    {t('tabFiles')}
                  </TabsTrigger>
                  <TabsTrigger value="links" className="flex-none">
                    {t('tabLinks')}
                  </TabsTrigger>
                  <TabsTrigger value="music" className="flex-none">
                    {t('tabMusic')}
                  </TabsTrigger>
                  <TabsTrigger value="voice" className="flex-none">
                    {t('tabVoice')}
                  </TabsTrigger>
                  <TabsTrigger value="gif" className="flex-none">
                    {t('tabGif')}
                  </TabsTrigger>
                  <TabsTrigger value="polls" className="flex-none">
                    {t('tabPolls')}
                  </TabsTrigger>
                </TabsList>
              </div>

              {isGroup && (
                <TabsContent value="participants" className={TAB_PANE}>
                  <ChatMembersList chat={chat} myId={myId} onOpenChat={onOpenChat} />
                </TabsContent>
              )}
              <TabsContent value="media" className={TAB_PANE}>
                <MediaTab chatId={chat.id} />
              </TabsContent>
              <TabsContent value="files" className={TAB_PANE}>
                <FileTab chatId={chat.id} type="file" onJump={onJump} />
              </TabsContent>
              <TabsContent value="links" className={TAB_PANE}>
                <LinksTab chatId={chat.id} onJump={onJump} />
              </TabsContent>
              <TabsContent value="music" className={TAB_PANE}>
                <FileTab chatId={chat.id} type="music" onJump={onJump} />
              </TabsContent>
              <TabsContent value="voice" className={TAB_PANE}>
                <FileTab chatId={chat.id} type="voice_note" onJump={onJump} />
              </TabsContent>
              <TabsContent value="gif" className={TAB_PANE}>
                <GifTab chatId={chat.id} onJump={onJump} />
              </TabsContent>
              <TabsContent value="polls" className={TAB_PANE}>
                <PollsTab chatId={chat.id} onJump={onJump} />
              </TabsContent>
            </Tabs>
          </>
        ) : screen === 'addMembers' ? (
          <AddMembersScreen chat={chat} onDone={() => goTo(null)} />
        ) : (
          <GroupManagement
            chat={chat}
            myId={myId}
            screen={screen}
            onNavigate={goTo}
            onEditInfo={() => setEditOpen(true)}
            onOpenChat={onOpenChat}
            onLeft={onLeft}
          />
        )}
      </div>

      {/* Добавить участников — плавающей кнопкой на вкладке участников, как в Telegram. */}
      {showFab && (
        <button
          type="button"
          aria-label={t('addMembers')}
          title={t('addMembers')}
          onClick={() => goTo('addMembers')}
          className="absolute right-4 bottom-4 z-20 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg outline-none duration-(--motion-menu) animate-in fade-in-0 zoom-in-75 hover:bg-primary/90 focus-visible:ring-4 focus-visible:ring-ring/30"
        >
          <UserPlus className="size-6" aria-hidden />
        </button>
      )}

      {editOpen && <EditGroupDialog chat={chat} title={title} onClose={() => setEditOpen(false)} />}
    </div>
  )
}
