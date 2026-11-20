'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowLeft, ChevronLeft, Pencil, UserPlus, X } from 'lucide-react'
import {
  chatKeys,
  fetchChatMembers,
  deleteChatPhotoRequest,
  fetchChatPhotos,
  fetchUserPhotos,
  groupKeys,
  type ChatListItem,
} from '../../../entities/chat'
import { fetchUserById, userKeys } from '../../../entities/user'
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, useConfirm } from '../../../shared/ui'
import { afterOverlayClose } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { ColumnNavigateProvider, interceptableHref } from '../lib/column-navigation'
import { useTabSwipe } from '../lib/use-tab-swipe'
import { isOfficialChat } from '../lib/format'
import { ChatMembersList, lastSeenText } from './chat-members-list'
import { EDIT_GROUP_FORM_ID, EditGroupScreen, type EditGroupState } from './edit-group-screen'
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
// Вкладка занимает ровно видимую высоту колонки под прилипшими вкладками (`--tab-pane-h`
// меряется ниже): выбрал вкладку — колонка доезжает до вкладок, и под ними содержимое или
// пустая плашка во весь остаток экрана, без пустоты снизу и без прыжка к соседнему блоку.
const TAB_PANE =
  'mt-0 min-h-(--tab-pane-h,calc(100dvh-9rem)) flex-col pt-1 data-[state=active]:flex'

/**
 * Прилипли ли вкладки к верху колонки: прокрутка дошла до их места в потоке (с допуском в
 * пиксель на дробную прокрутку при масштабе экрана).
 */
export function tabsStuck(scrollTop: number, tabsTop: number): boolean {
  return tabsTop > 0 && Math.ceil(scrollTop) >= tabsTop - 1
}

/** Насколько надо «дотянуть» колесом вверх у самого верха, чтобы развернуть фото. */
const OVERSCROLL_EXPAND_PX = 80

type Screen = ManageScreen | 'addMembers' | null

/** Глубина экрана колонки: по ней понятно, шаг вглубь это или назад. */
function screenDepth(screen: Screen): number {
  if (screen === null) return 0
  if (screen === 'addMembers' || screen === 'main') return 1
  if (screen === 'addAdmin') return 3
  return 2
}

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
  // Аватар группы меняет владелец, название — любой админ (и участник, если владелец открыл
  // «смену информации», §8.3): управление открывается по любому из них.
  const canEdit =
    isGroup &&
    (chat.isAdmin ||
      chat.isOwner ||
      (chat.type === 'GROUP' && chat.permissions?.changeInfo === true))

  const [screen, setScreen] = useState<Screen>(null)
  // Откуда въезжает новый экран колонки: вглубь — справа, назад — слева.
  const [enterFrom, setEnterFrom] = useState<'right' | 'left'>('right')
  // «Сохранить» правки группы живёт в шапке колонки, а состояние формы — на её экране.
  const [editState, setEditState] = useState<EditGroupState>({ canSave: false, saving: false })
  const [expanded, setExpanded] = useState(false)
  // Вкладки прилипли к верху — шапка колонки говорит уже не «О группе», а «Общие материалы»
  // (на вкладке участников — «Участники»), и крестик сменяется стрелкой «наверх, к профилю»,
  // как в Telegram.
  const [stuck, setStuck] = useState(false)
  const firstTab = isGroup ? 'participants' : 'media'
  // Тип — string: Radix отдаёт в onValueChange обычную строку.
  const [tab, setTab] = useState<string>(firstTab)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabsAnchorRef = useRef<HTMLDivElement>(null)
  const tabsBarRef = useRef<HTMLDivElement>(null)

  // Высота под вкладками = видимая высота колонки минус полоса вкладок. Меряем, а не
  // угадываем через dvh: колонка бывает в сайдбаре, островом и экраном телефона.
  useEffect(() => {
    const sc = scrollRef.current
    const bar = tabsBarRef.current
    if (!sc || !bar || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      sc.style.setProperty('--tab-pane-h', `${Math.max(0, sc.clientHeight - bar.offsetHeight)}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(sc)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [screen])

  // Открылась заново — с начала: профиль, первая вкладка, верх колонки, фото свёрнуто.
  useEffect(() => {
    if (!open) return
    setTab(firstTab)
    setScreen(null)
    setEnterFrom('right')
    setExpanded(false)
    setStuck(false)
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

  // Фото шапки — история аватаров, как в Telegram (§8.3): у собеседника его фото профиля, у
  // группы — фото группы, текущее первым. Обложку профиля Telegram в шапке не показывает —
  // её здесь и нет. Пока история не пришла (или старый сервер) — один текущий аватар.
  const hasPeer = peer != null
  const isUserGroup = chat.type === 'GROUP'
  const current = hasPeer ? (user.data?.avatarUrl ?? chat.avatarUrl) : chat.avatarUrl
  const history = useQuery({
    // Текущий аватар — в ключе: сменили фото — история перечитывается сама.
    queryKey: [
      ...(hasPeer ? groupKeys.userPhotos(peerId ?? '') : groupKeys.chatPhotos(chat.id)),
      current,
    ],
    queryFn: () => (hasPeer ? fetchUserPhotos(peerId as string) : fetchChatPhotos(chat.id)),
    enabled: open && (hasPeer || isUserGroup),
    staleTime: 60_000,
  })
  const photos = useMemo(() => {
    const list = history.data?.length ? history.data.map((p) => p.url) : [current]
    return [...new Set(list.filter((x): x is string => Boolean(x)))]
  }, [history.data, current])

  // Удалить фото группы из истории — только владелец (фото группы — его, §8.3). Текущее
  // сменится предыдущим: сервер вернёт новый аватар, список и шапка перечитаются.
  const qc = useQueryClient()
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const deletePhoto = useMutation({
    mutationFn: (photoId: string) => deleteChatPhotoRequest(chat.id, photoId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: groupKeys.chatPhotos(chat.id) })
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      toast.success(t('tgGroups.photoDeleted'))
    },
    onError: (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })
  const photoIds = history.data?.map((p) => p.id) ?? []
  const onDeletePhoto =
    isUserGroup && chat.isOwner && photoIds.length === photos.length
      ? (index: number): void => {
          const id = photoIds[index]
          // Пустой id — аватар старше истории: удаляется только целиком, из окна правки.
          if (!id) return
          void confirm({ title: t('tgGroups.photoDeleteConfirm'), destructive: true }).then(
            (ok) => {
              if (ok) deletePhoto.mutate(id)
            },
          )
        }
      : undefined

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
    const sc = scrollRef.current
    if (!sc) return
    if (expanded && sc.scrollTop > 12) setPhotoExpanded(false)
    const anchor = tabsAnchorRef.current
    setStuck(screen === null && anchor != null && tabsStuck(sc.scrollTop, anchor.offsetTop))
  }

  // Стрелка шапки у прилипших вкладок — плавно наверх, к профилю (как «назад» в Telegram).
  function scrollToProfile(): void {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    scrollRef.current?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  }

  // Выбор вкладки докатывает колонку до вкладок: они встают к верху, под ними — содержимое
  // во всю оставшуюся высоту (как в Telegram). Уже прилипшие — новая вкладка начинается с
  // верха, а не с того места, куда долистали предыдущую.
  function scrollToTabs(): void {
    const sc = scrollRef.current
    const anchor = tabsAnchorRef.current
    if (!sc || !anchor || Math.abs(sc.scrollTop - anchor.offsetTop) < 1) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    sc.scrollTo({ top: anchor.offsetTop, behavior: reduce ? 'auto' : 'smooth' })
  }
  function changeTab(next: string): void {
    setTab(next)
    scrollToTabs()
  }

  function goTo(next: Screen): void {
    setEnterFrom(screenDepth(next) >= screenDepth(screen) ? 'right' : 'left')
    setScreen(next)
    setStuck(false)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  function back(): void {
    if (screen === null) {
      onClose()
      return
    }
    goTo(screen === 'addMembers' ? null : manageParent(screen))
  }

  const shared = screen === null && stuck
  const headerTitle =
    screen === null
      ? shared
        ? tab === 'participants'
          ? t('tabParticipants')
          : t('tgRight.sharedTabs')
        : isGroup
          ? t('tgRight.groupInfo')
          : t('details')
      : screen === 'addMembers'
        ? t('addMembers')
        : t(MANAGE_TITLE[screen])

  const showFab =
    screen === null &&
    isGroup &&
    (chat.isAdmin || chat.isOwner || (isUserGroup && chat.permissions?.addMembers === true)) &&
    tab === 'participants'

  // Переход со страницы из колонки — через закрытие колонки (column-navigation.tsx): иначе
  // снятие её записи в истории откатывало бы адрес новой страницы.
  const router = useRouter()
  const navigate = useCallback(
    (href: string) => {
      onClose()
      afterOverlayClose(() => router.push(href))
    },
    [onClose, router],
  )

  // Свайп по содержимому вкладок листает вкладки (§55, как в Telegram), на пружине.
  const tabOrder = useMemo(
    () => [
      ...(isGroup ? ['participants'] : []),
      'media',
      'files',
      'links',
      'music',
      'voice',
      'gif',
      'polls',
    ],
    [isGroup],
  )
  const swipeRef = useTabSwipe({ tabs: tabOrder, current: tab, onChange: changeTab })

  return (
    <ColumnNavigateProvider value={navigate}>
      <div
        className="relative flex h-full min-h-0 flex-col bg-background"
        onClickCapture={(e) => {
          const href = interceptableHref(e)
          if (!href) return
          e.preventDefault()
          navigate(href)
        }}
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
            aria-label={
              shared
                ? t('tgRight.toTop')
                : screen !== null || variant === 'fullscreen'
                  ? t('back')
                  : t('close')
            }
            onClick={shared ? scrollToProfile : back}
            className={HEADER_BTN}
          >
            {screen !== null || shared ? (
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
          {/* Смена заголовка — коротким проявлением, а не скачком текста. */}
          <span
            key={headerTitle}
            className="min-w-0 flex-1 truncate px-1 text-base font-semibold duration-(--motion-micro) animate-in fade-in-0"
          >
            {headerTitle}
          </span>
          {screen === 'editInfo' && (
            <Button
              type="submit"
              form={EDIT_GROUP_FORM_ID}
              size="sm"
              loading={editState.saving}
              disabled={!editState.canSave}
              className="mr-1"
            >
              {t('save')}
            </Button>
          )}
          {screen === null && !shared && canEdit && (
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
          // Без привязки прокрутки браузера: при смене вкладки содержимое под вкладками меняется
          // целиком, и браузер «доворачивал» колонку к старому якорю — новая вкладка
          // открывалась с обрезанной первой строкой.
          className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none]"
        >
          {screen === null ? (
            // Возврат к профилю — въезд слева; первое открытие колонки — без сдвига.
            <div
              key="profile"
              className={cn(
                enterFrom === 'left' &&
                  'duration-(--motion-page) animate-in fade-in-0 slide-in-from-left-8',
              )}
            >
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
                onDeletePhoto={onDeletePhoto}
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
                <div
                  ref={tabsBarRef}
                  // Нажатие и на уже открытую вкладку докатывает к ней — onValueChange тогда молчит.
                  onClick={scrollToTabs}
                  className="sticky top-0 z-10 bg-background/85 px-3 py-2 backdrop-blur-md"
                >
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

                <div ref={swipeRef} className="touch-pan-y">
                  {isGroup && (
                    <TabsContent value="participants" className={TAB_PANE}>
                      {/* Участники — на карточке-острове, как остальные списки вкладок. */}
                      <div className="mx-3 mb-3 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                        <ChatMembersList chat={chat} myId={myId} onOpenChat={onOpenChat} />
                      </div>
                    </TabsContent>
                  )}
                  <TabsContent value="media" className={TAB_PANE}>
                    <MediaTab chatId={chat.id} onJump={onJump} />
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
                </div>
              </Tabs>
            </div>
          ) : screen === 'addMembers' ? (
            <div className="duration-(--motion-page) animate-in fade-in-0 slide-in-from-right-8">
              <AddMembersScreen chat={chat} onDone={() => goTo(null)} />
            </div>
          ) : screen === 'editInfo' ? (
            <EditGroupScreen
              chat={chat}
              title={title}
              onDone={() => goTo('main')}
              onStateChange={setEditState}
            />
          ) : (
            <GroupManagement
              enterFrom={enterFrom}
              chat={chat}
              myId={myId}
              screen={screen}
              onNavigate={goTo}
              onEditInfo={() => goTo('editInfo')}
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
      </div>
    </ColumnNavigateProvider>
  )
}
