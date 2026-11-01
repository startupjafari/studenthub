'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useRouter } from 'next/navigation'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Flag,
  ImageOff,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { STORY_REACTION_EMOJIS, canFileComplaint } from '@studenthub/shared-schemas'
import {
  pickSource,
  relativeTime,
  srcSetOf,
  toApiError,
  useBackClose,
  useBodyScrollLock,
  useHls,
} from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MediaImage,
  useConfirm,
} from '../../../shared/ui'
import {
  addStoryReactionRequest,
  deleteStoryRequest,
  markStoryViewed,
  removeStoryReactionRequest,
  storyBackgroundClass,
  storyKeys,
  voteStoryRequest,
  type StoryCard,
  type StoryRing,
} from '../../../entities/story'
import { useAppSelector } from '../../../shared/store'
import { ReportModal } from '../../../features/report-content'
import { StoryViewersSheet } from './story-viewers-sheet'

// Сколько держится кадр без своего таймера (текст и фото). У видео длительность своя.
const FRAME_MS = 6000
// Ширина кадра сторис для srcset: на телефоне во весь экран, на десктопе — колонка ~420px.
const STORY_SIZES = '(max-width: 640px) 100vw, 420px'
// Жесты на кадре: удержание дольше этого — пауза, а не тап; сдвиг больше — свайп.
const HOLD_MS = 220
const SWIPE_X_PX = 60
const SWIPE_DOWN_PX = 90
// Звук видео — выбор человека, а не каждого ролика: помним его в браузере.
const MUTED_KEY = 'sh.stories.muted'

// Превью соседних авторов по бокам от активной сторис (десктоп), как в Instagram: сколько
// колец видно с каждой стороны, во сколько раз превью меньше кадра и зазор между ними.
const PREVIEW_RADIUS = 2
const PREVIEW_SCALE = 0.42
// Ширина кадра — та же, что у `sm:w-[26rem]` ниже (26rem = 416px); зазор между карточками.
const FRAME_PX = 416
const GAP_PX = 24

/** Сдвиг карточки кольца от центра экрана: активная — в центре, соседние — рядом с ней. */
function slotX(offset: number): number {
  if (offset === 0) return 0
  const preview = FRAME_PX * PREVIEW_SCALE
  const first = FRAME_PX / 2 + GAP_PX + preview / 2
  return Math.sign(offset) * (first + (Math.abs(offset) - 1) * (preview + GAP_PX))
}

/** С какого кадра открывать автора: с первого непросмотренного, как в Instagram. */
function firstUnseen(ring: StoryRing | undefined): number {
  const index = ring?.stories.findIndex((s) => !s.seen) ?? -1
  return index >= 0 ? index : 0
}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTED_KEY, muted ? '1' : '0')
  } catch {
    // Хранилище недоступно (приватный режим) — звук просто не запомнится.
  }
}

/** Фокус в поле ввода — горячие клавиши сторис не должны мешать печатать. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** Прогреть следующий кадр, пока смотрят текущий: листание не упирается в сеть. */
function warmStory(card: StoryCard | undefined): void {
  const media = card?.media
  if (!media) return
  const img = new Image()
  img.sizes = STORY_SIZES
  if (media.mime.startsWith('video/')) {
    const poster = pickSource(media.poster, 640)
    if (!poster) return
    img.src = poster.url
    return
  }
  const srcset = srcSetOf(media.sources, { url: media.url, width: media.width })
  if (srcset) img.srcset = srcset
  img.src = media.url
}
// Быстрые реакции: один тап, без клавиатуры и выбора эмодзи. Набор закрыт намеренно —
// полноценный пикер в формате, который смотрят секундами, никто не открывает. Это и есть
// белый список сервера (STORY_REACTION_EMOJIS): другую реакцию он отклонит.
const QUICK_REACTIONS = STORY_REACTION_EMOJIS

/**
 * Просмотр сторис: кадры одного автора идут подряд, по концу кольца — следующий автор.
 *
 * Окно — Radix Dialog: фокус заперт внутри, Esc закрывает верхний слой (меню, жалобу,
 * само окно), после закрытия фокус возвращается туда, откуда сторис открыли.
 *
 * Прогресс считается таймером, а не CSS-анимацией: его нужно останавливать (палец на
 * экране, открытое меню, вкладка в фоне) и отматывать назад по тапу, а анимация про это
 * ничего не знает. У видео прогресс берётся из самого воспроизведения.
 */
export function StoryViewer({
  rings,
  startIndex,
  onClose,
}: {
  rings: StoryRing[]
  startIndex: number
  onClose: () => void
}) {
  const t = useTranslations('Stories')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const router = useRouter()
  // Отказ сервера — тостом по коду (сторис истекла, удалена модератором, нет прав), а не
  // молча: раньше голос и удаление просто ничего не делали.
  const showError = (e: unknown): void => {
    toast.error(tErr(toApiError(e).code))
  }
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [ringIndex, setRingIndex] = useState(startIndex)
  const [storyIndex, setStoryIndex] = useState(() => firstUnseen(rings[startIndex]))
  const [progress, setProgress] = useState(0)
  // Причины паузы раздельно: удержание пальцем, пробел/кнопка, меню, окна поверх, фон.
  const [holding, setHolding] = useState(false)
  const [manualPause, setManualPause] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [viewersOpen, setViewersOpen] = useState(false)
  const [tabHidden, setTabHidden] = useState(false)
  // Жалоба на сторис (§3.4) — тем, чью жалобу сервер примет; кадр на это время стоит.
  const [reporting, setReporting] = useState<StoryCard | null>(null)
  const [muted, setMuted] = useState(readMuted)
  // Медиа кадра не загрузилось (битая ссылка, видео не играет) — показываем это, а кадр
  // идёт дальше по таймеру, а не висит.
  const [failedStoryId, setFailedStoryId] = useState<string | null>(null)
  const myId = useAppSelector((s) => s.auth.user?.id)
  const canReport = canFileComplaint(useAppSelector((s) => s.auth.role))
  // Локальные правки поверх серверной выдачи: голос и реакция должны быть видны сразу,
  // а перезапрашивать всю ленту колец ради одного кадра незачем.
  const [patched, setPatched] = useState<Record<string, StoryCard>>({})
  // Где остановились у каждого автора: вернулись к нему — продолжаем с того же кадра.
  const positions = useRef<Record<string, number>>({})

  useBodyScrollLock(true, true)
  useBackClose(onClose)

  const ring = rings[ringIndex]
  const raw = ring?.stories[storyIndex]
  const story = raw ? (patched[raw.id] ?? raw) : undefined
  const reportOpen = reporting !== null
  const paused = holding || manualPause || menuOpen || viewersOpen || reportOpen || tabHidden

  // Закрытие обновляет кольца — и ленты, и профиля: пока шёл просмотр, сторисы стали
  // просмотренными.
  const close = useCallback(() => {
    void qc.invalidateQueries({ queryKey: storyKeys.all })
    onClose()
  }, [onClose, qc])

  // Переход к другому автору: запоминаем, где остановились у текущего, у нового — его
  // сохранённый кадр или первый непросмотренный.
  const openRing = useCallback(
    (index: number) => {
      const current = rings[ringIndex]
      const target = rings[index]
      if (!target) return
      if (current) positions.current[current.author.id] = storyIndex
      setProgress(0)
      setRingIndex(index)
      setStoryIndex(positions.current[target.author.id] ?? firstUnseen(target))
    },
    [ringIndex, rings, storyIndex],
  )

  const goNextRing = useCallback(() => {
    if (ringIndex + 1 < rings.length) openRing(ringIndex + 1)
    else close()
  }, [close, openRing, ringIndex, rings.length])

  const goPrevRing = useCallback(() => {
    if (ringIndex > 0) openRing(ringIndex - 1)
  }, [openRing, ringIndex])

  // Конец кадра приходит из двух мест (таймер и `ended` у видео) — переход делается
  // ровно один раз на кадр, иначе «двойное» листание проскакивало сторис.
  const advancedFrom = useRef<string | null>(null)
  const goNext = useCallback(() => {
    const key = `${ringIndex}:${storyIndex}`
    if (advancedFrom.current === key) return
    advancedFrom.current = key
    setProgress(0)
    const current = rings[ringIndex]
    if (current && storyIndex + 1 < current.stories.length) {
      setStoryIndex(storyIndex + 1)
      return
    }
    goNextRing()
  }, [goNextRing, ringIndex, rings, storyIndex])

  const goPrev = useCallback(() => {
    advancedFrom.current = null
    setProgress(0)
    if (storyIndex > 0) {
      setStoryIndex(storyIndex - 1)
      return
    }
    if (ringIndex > 0) {
      const prev = rings[ringIndex - 1]
      setRingIndex(ringIndex - 1)
      setStoryIndex(Math.max(0, (prev?.stories.length ?? 1) - 1))
    }
  }, [ringIndex, rings, storyIndex])

  // Отметка просмотра — когда кадр действительно показан (медиа загрузилось или его нет),
  // и один раз на кадр. Ответ не нужен: признак «смотрел» приедет со следующей выдачей,
  // а ошибка сети не должна мешать смотреть дальше. Кто смотрит — сервер берёт из токена.
  const storyId = story?.id
  const [readyStoryId, setReadyStoryId] = useState<string | null>(null)
  const isVideoMedia = story?.media?.mime.startsWith('video/') ?? false
  const failed = !!storyId && failedStoryId === storyId
  const isVideo = isVideoMedia && !failed
  const imageReady = !!storyId && readyStoryId === storyId
  // Снимок ещё не пришёл — время кадра не идёт: на медленной сети сторис иначе
  // пролистывалась, так и не показавшись. Готовность привязана к id кадра, а не
  // сбрасывается эффектом: снимок из кэша присылает load раньше, чем отработал бы сброс.
  const waitingImage = !!story?.media && !isVideoMedia && !imageReady
  const shown = !!storyId && (!story?.media || isVideoMedia || imageReady)
  const viewedIds = useRef(new Set<string>())
  useEffect(() => {
    if (!storyId || !shown || viewedIds.current.has(storyId)) return
    viewedIds.current.add(storyId)
    void markStoryViewed(storyId).catch(() => undefined)
  }, [shown, storyId])

  // Следующий кадр греем заранее — и в этом кольце, и первый у следующего автора.
  const nextCard = ring?.stories[storyIndex + 1] ?? rings[ringIndex + 1]?.stories[0]
  useEffect(() => warmStory(nextCard), [nextCard])

  // Видео — адаптивным HLS (качество под сеть), запасной путь — оригинал.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  useHls(videoEl, story?.media?.hls, story?.media?.url)

  // Пауза видео — вместе с паузой кадра: удержание, меню, фон вкладки.
  useEffect(() => {
    if (!videoEl) return
    if (paused) videoEl.pause()
    else void videoEl.play().catch(() => undefined)
  }, [paused, videoEl])

  // Уход вкладки в фон — пауза; вернулись — продолжаем.
  useEffect(() => {
    const onVisibility = (): void => setTabHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Таймер кадра. Шаг 50 мс: полоса растёт плавно, а таймеров на секунду немного.
  useEffect(() => {
    if (!story || paused || isVideo || waitingImage) return
    const step = 50
    const timer = setInterval(() => {
      setProgress((value) => {
        const next = value + step / FRAME_MS
        if (next >= 1) {
          // Переход вне setState-колбэка: иначе он выполнится дважды в StrictMode.
          queueMicrotask(goNext)
          return 1
        }
        return next
      })
    }, step)
    return () => clearInterval(timer)
  }, [goNext, isVideo, paused, story, waitingImage])

  // Клавиатура: стрелки — листание, пробел — пауза. Esc закрывает Radix. Пока открыто меню
  // или окно поверх и пока фокус в поле ввода, клавиши принадлежат им.
  useEffect(() => {
    if (reportOpen || viewersOpen || menuOpen) return
    function onKey(e: KeyboardEvent): void {
      if (isTyping(e.target)) return
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === ' ') {
        e.preventDefault()
        setManualPause((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrev, menuOpen, reportOpen, viewersOpen])

  // Жесты на кадре. Тап по краю листает (кнопки-зоны ниже), удержание ставит паузу, свайп
  // в сторону — к соседнему автору, вниз — закрыть. После удержания и свайпа тап по зоне
  // гасится: иначе отпускание пальца ещё и перелистывало бы кадр.
  const gesture = useRef<{ x: number; y: number } | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const swallowTap = useRef(false)
  const endGesture = (): void => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
    gesture.current = null
    setHolding(false)
  }
  useEffect(() => () => endGesture(), [])
  const onPointerDown = (e: ReactPointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    gesture.current = { x: e.clientX, y: e.clientY }
    swallowTap.current = false
    holdTimer.current = setTimeout(() => {
      swallowTap.current = true
      setHolding(true)
    }, HOLD_MS)
  }
  const onPointerMove = (e: ReactPointerEvent): void => {
    const g = gesture.current
    if (!g || !holdTimer.current) return
    // Палец поехал — это свайп, а не удержание.
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 12) {
      clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }
  const onPointerUp = (e: ReactPointerEvent): void => {
    const g = gesture.current
    endGesture()
    if (!g) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (Math.abs(dx) > SWIPE_X_PX && Math.abs(dx) > Math.abs(dy)) {
      swallowTap.current = true
      if (dx < 0) goNextRing()
      else goPrevRing()
    } else if (dy > SWIPE_DOWN_PX && dy > Math.abs(dx)) {
      swallowTap.current = true
      close()
    }
  }
  const tap = (go: () => void) => () => {
    if (swallowTap.current) {
      swallowTap.current = false
      return
    }
    go()
  }

  const vote = useMutation({
    mutationFn: ({ id, optionId }: { id: string; optionId: string }) =>
      voteStoryRequest(id, optionId),
    onSuccess: (updated) => setPatched((prev) => ({ ...prev, [updated.id]: updated })),
    onError: showError,
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteStoryRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storyKeys.all })
      onClose()
    },
    onError: showError,
  })

  async function toggleReaction(card: StoryCard, emoji: string): Promise<void> {
    const mine = card.reactions.find((r) => r.emoji === emoji && r.mine)
    // Оптимистично: тап по эмодзи обязан отзываться мгновенно, запрос идёт следом.
    setPatched((prev) => ({ ...prev, [card.id]: applyReaction(card, emoji, !mine) }))
    try {
      if (mine) await removeStoryReactionRequest(card.id, emoji)
      else await addStoryReactionRequest(card.id, emoji)
    } catch (e) {
      setPatched((prev) => ({ ...prev, [card.id]: card }))
      showError(e)
    }
  }

  async function askDelete(card: StoryCard): Promise<void> {
    setManualPause(true)
    const ok = await confirm({ title: t('confirmDelete'), destructive: true })
    setManualPause(false)
    if (ok) remove.mutate(card.id)
  }

  function openProfile(authorId: string): void {
    close()
    router.push(authorId === myId ? '/profile' : `/profile/${authorId}`)
  }

  function toggleMute(): void {
    setMuted((m) => {
      writeMuted(!m)
      return !m
    })
  }

  const segments = useMemo(() => ring?.stories.map((s) => s.id) ?? [], [ring])

  if (!ring || !story) return null

  const authorName = `${story.author.firstName} ${story.author.lastName}`
  const mine = story.author.id === myId
  const atStart = ringIndex === 0 && storyIndex === 0
  const iconButton = 'size-10 text-white hover:bg-white/15 hover:text-white sm:size-9'

  // Лента колец: активное — кадром по центру, соседние — уменьшенными превью по бокам.
  // Каждая карточка позиционируется сдвигом от центра; при смене автора сдвиг и масштаб
  // анимируются, и лента плавно проезжает, а не перескакивает. На телефоне превью не
  // помещаются — там только активный кадр во весь экран.
  const visible = rings
    .map((r, index) => ({ r, index, offset: index - ringIndex }))
    .filter(({ offset }) => Math.abs(offset) <= PREVIEW_RADIUS)

  const activeFrame = (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-black sm:rounded-2xl">
      {/* Верх: сегменты прогресса, автор и действия. Подложка-градиент — чтобы белый текст
          читался поверх светлого кадра. */}
      <div className="absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/60 to-transparent px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-8">
        <div className="flex gap-1" aria-hidden>
          {segments.map((id, i) => (
            <span key={id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <span
                className="block h-full bg-white"
                style={{
                  width: i < storyIndex ? '100%' : i === storyIndex ? `${progress * 100}%` : '0%',
                }}
              />
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1 text-white">
          <button
            type="button"
            onClick={() => openProfile(story.author.id)}
            className="flex min-w-0 items-center gap-2 rounded-full py-1 pr-2 pl-0.5 transition-colors duration-150 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            <Avatar className="size-8">
              {story.author.avatarUrl && <AvatarImage src={story.author.avatarUrl} alt="" />}
              <AvatarFallback>
                {story.author.firstName.charAt(0)}
                {story.author.lastName.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 truncate text-sm font-semibold">{authorName}</span>
            <time dateTime={story.createdAt} className="shrink-0 text-xs text-white/70">
              {relativeTime(story.createdAt, locale)}
            </time>
          </button>
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            icon
            aria-label={manualPause ? tCommon('play') : tCommon('pause')}
            className={iconButton}
            onClick={() => setManualPause((p) => !p)}
          >
            {manualPause ? (
              <Play className="size-4" aria-hidden />
            ) : (
              <Pause className="size-4" aria-hidden />
            )}
          </Button>
          {isVideo && (
            <Button
              type="button"
              variant="ghost"
              icon
              aria-label={muted ? tCommon('unmute') : tCommon('mute')}
              aria-pressed={muted}
              className={iconButton}
              onClick={toggleMute}
            >
              {muted ? (
                <VolumeX className="size-4" aria-hidden />
              ) : (
                <Volume2 className="size-4" aria-hidden />
              )}
            </Button>
          )}
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                icon
                aria-label={t('actions')}
                className={iconButton}
              >
                <MoreHorizontal className="size-5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[60] min-w-48">
              {mine && story.viewsCount !== null && (
                <DropdownMenuItem onSelect={() => setViewersOpen(true)}>
                  <Eye className="size-4" aria-hidden />
                  {t('viewersWithCount', { count: story.viewsCount })}
                </DropdownMenuItem>
              )}
              {!mine && (
                <DropdownMenuItem onSelect={() => openProfile(story.author.id)}>
                  <UserRound className="size-4" aria-hidden />
                  {t('openProfile')}
                </DropdownMenuItem>
              )}
              {/* Опасные действия — последними и за линией (правило для всех меню). */}
              {(story.canDelete || (canReport && !mine)) && <DropdownMenuSeparator />}
              {canReport && !mine && (
                <DropdownMenuItem variant="destructive" onSelect={() => setReporting(story)}>
                  <Flag className="size-4" aria-hidden />
                  {t('report')}
                </DropdownMenuItem>
              )}
              {story.canDelete && (
                <DropdownMenuItem variant="destructive" onSelect={() => void askDelete(story)}>
                  <Trash2 className="size-4" aria-hidden />
                  {t('delete')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            icon
            aria-label={tCommon('close')}
            className={iconButton}
            onClick={close}
          >
            <X className="size-5" aria-hidden />
          </Button>
        </div>
      </div>

      {/* Сам кадр. Удержание — пауза, свайп в сторону — соседний автор, вниз — закрыть.
          `touch-none`: жесты наши, браузер не должен прокручивать и обновлять страницу. */}
      <div
        className={cn(
          'relative flex flex-1 touch-none items-center justify-center overflow-hidden select-none',
          !story.media && storyBackgroundClass(story.background),
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endGesture}
        onPointerLeave={endGesture}
      >
        {story.media && !failed ? (
          isVideo ? (
            <video
              key={story.id}
              ref={setVideoEl}
              // При HLS источник ставит useHls; иначе — оригинал, как раньше.
              src={story.media.hls ? undefined : story.media.url}
              poster={pickSource(story.media.poster, 1280)?.url}
              className="size-full object-contain"
              autoPlay
              playsInline
              muted={muted}
              controls={false}
              onTimeUpdate={(e) => {
                const el = e.currentTarget
                if (el.duration > 0) setProgress(el.currentTime / el.duration)
              }}
              onEnded={goNext}
              onError={() => setFailedStoryId(story.id)}
            />
          ) : (
            // Ссылка подписана сервером и живёт 15 минут: next/image её не оптимизирует,
            // как и у медиа постов. Заглушка видна сразу, копия — по ширине экрана.
            <MediaImage
              key={story.id}
              src={story.media.url}
              media={story.media}
              alt=""
              fit="contain"
              loading="eager"
              sizes={STORY_SIZES}
              className="size-full"
              onLoad={() => setReadyStoryId(story.id)}
              // Битую картинку не ждём вечно: показываем ошибку, кадр идёт дальше.
              onError={() => {
                setReadyStoryId(story.id)
                setFailedStoryId(story.id)
              }}
            />
          )
        ) : null}

        {failed && (
          <div className="flex flex-col items-center gap-2 px-8 text-center text-white/80">
            <ImageOff className="size-8" aria-hidden />
            <p className="text-sm">{isVideoMedia ? t('videoError') : t('mediaError')}</p>
          </div>
        )}

        {waitingImage && !failed && (
          <Loader2
            className="absolute size-8 animate-spin text-white/70 motion-reduce:animate-none"
            aria-label={tCommon('loading')}
          />
        )}

        {story.text && (
          <p
            className={cn(
              'pointer-events-none absolute inset-x-6 text-center text-lg leading-snug font-medium break-words text-white drop-shadow-lg',
              story.media ? 'bottom-28' : 'top-1/2 -translate-y-1/2',
            )}
          >
            {story.text}
          </p>
        )}

        {/* Зоны листания: левая треть — назад, остальное — вперёд. Кнопки, а не
            обработчики на кадре, — чтобы работала клавиатура и читалка. */}
        <button
          type="button"
          aria-label={tCommon('previous')}
          className="absolute inset-y-0 left-0 w-1/3 cursor-default focus-visible:outline-none"
          onClick={tap(goPrev)}
        />
        <button
          type="button"
          aria-label={tCommon('next')}
          className="absolute inset-y-0 right-0 w-2/3 cursor-default focus-visible:outline-none"
          onClick={tap(goNext)}
        />

        {story.poll && (
          <div className="absolute inset-x-4 bottom-28 z-10 rounded-2xl bg-black/55 p-3 text-white backdrop-blur">
            <p className="mb-2 text-sm font-medium">{story.poll.question}</p>
            <div className="flex flex-col gap-1.5">
              {story.poll.options.map((option) => {
                const total = story.poll?.totalVotes ?? 0
                const share = total > 0 ? Math.round((option.votes / total) * 100) : 0
                const chosen = story.poll?.myOptionId === option.id
                const answered = story.poll?.myOptionId !== null
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      'relative overflow-hidden rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150',
                      chosen ? 'bg-white/25 font-medium' : 'bg-white/10 hover:bg-white/20',
                    )}
                    onClick={() => vote.mutate({ id: story.id, optionId: option.id })}
                  >
                    {/* Доля голосов — заливкой самой кнопки: отдельная полоса в кадре
                        этого размера читается хуже, чем закрашенная строка. */}
                    {answered && (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-300 motion-reduce:transition-none"
                        style={{ width: `${share}%` }}
                      />
                    )}
                    <span className="relative flex justify-between gap-2">
                      <span className="truncate">{option.text}</span>
                      {answered && <span className="tabular-nums">{share}%</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <footer className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white">
        {story.linkUrl && (
          <a
            href={story.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur transition-colors duration-150 hover:bg-white/25"
          >
            <ExternalLink className="size-4" aria-hidden />
            {story.linkLabel ?? t('openLink')}
          </a>
        )}
        <div className="flex items-center gap-1.5">
          {QUICK_REACTIONS.map((emoji) => {
            const chosen = story.reactions.some((r) => r.emoji === emoji && r.mine)
            const count = story.reactions.find((r) => r.emoji === emoji)?.count ?? 0
            return (
              <button
                key={emoji}
                type="button"
                aria-pressed={chosen}
                aria-label={emoji}
                onClick={() => void toggleReaction(story, emoji)}
                className={cn(
                  'flex h-10 min-w-10 items-center justify-center gap-1 rounded-full px-2 text-base transition-[background-color,transform] duration-150 active:scale-90 motion-reduce:transition-none',
                  chosen ? 'scale-105 bg-white/30' : 'bg-white/10 hover:bg-white/20',
                )}
              >
                <span aria-hidden>{emoji}</span>
                {count > 0 && <span className="text-xs tabular-nums">{count}</span>}
              </button>
            )
          })}
          {story.viewsCount !== null && (
            <button
              type="button"
              onClick={() => setViewersOpen(true)}
              aria-label={t('viewersWithCount', { count: story.viewsCount })}
              className="ml-auto flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm transition-colors duration-150 hover:bg-white/20"
            >
              <Eye className="size-4" aria-hidden />
              <span className="tabular-nums">{story.viewsCount}</span>
            </button>
          )}
        </div>
      </footer>
    </div>
  )

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 overflow-hidden bg-black/95 outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            {t('openStoryOf', { name: authorName })}
          </DialogPrimitive.Title>
          {visible.map(({ r, index, offset }) => {
            const active = offset === 0
            return (
              <div
                key={r.author.id}
                className={cn(
                  'absolute sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(90dvh,46rem)] sm:w-[26rem]',
                  'sm:[transform:translate(-50%,-50%)_translateX(var(--story-x))_scale(var(--story-s))]',
                  'sm:transition-[transform,opacity] sm:duration-200 sm:ease-out motion-reduce:transition-none',
                  active ? 'inset-0 z-10' : 'hidden sm:block sm:opacity-60 sm:hover:opacity-90',
                )}
                style={
                  {
                    '--story-x': `${slotX(offset)}px`,
                    '--story-s': active ? 1 : PREVIEW_SCALE,
                  } as CSSProperties
                }
              >
                {active ? activeFrame : <RingPreview ring={r} onOpen={() => openRing(index)} />}
              </div>
            )
          })}

          {/* Стрелки на десктопе — у краёв кадра: пальцем листают тапом, мышью — здесь. */}
          <Button
            type="button"
            variant="ghost"
            size="lg"
            icon
            aria-label={tCommon('previous')}
            disabled={atStart}
            className="absolute top-1/2 left-4 z-20 hidden -translate-y-1/2 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white disabled:opacity-0 sm:flex lg:left-[calc(50%-16.5rem)]"
            onClick={goPrev}
          >
            <ChevronLeft className="size-6" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            icon
            aria-label={tCommon('next')}
            className="absolute top-1/2 right-4 z-20 hidden -translate-y-1/2 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white sm:flex lg:right-[calc(50%-16.5rem)]"
            onClick={goNext}
          >
            <ChevronRight className="size-6" aria-hidden />
          </Button>

          {viewersOpen && (
            <StoryViewersSheet storyId={story.id} onClose={() => setViewersOpen(false)} />
          )}
          {reporting && (
            <ReportModal
              targetType="STORY"
              targetId={reporting.id}
              preview={reporting.text ?? undefined}
              onClose={() => setReporting(null)}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * Превью соседнего автора: следующий непросмотренный кадр (или первый), затемнённый, с
 * аватаром и именем по центру. Карточка рисуется в размере кадра и уменьшается
 * трансформацией вместе с лентой, поэтому шрифт и аватар здесь крупнее обычного.
 */
function RingPreview({ ring, onOpen }: { ring: StoryRing; onOpen: () => void }) {
  const t = useTranslations('Stories')
  const card = ring.stories.find((s) => !s.seen) ?? ring.stories[0]
  if (!card) return null
  const media = card.media
  const isVideo = media?.mime.startsWith('video/') ?? false
  const poster = isVideo && media ? pickSource(media.poster, 640)?.url : undefined
  const name = `${ring.author.firstName} ${ring.author.lastName}`

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('openStoryOf', { name })}
      className="relative block size-full cursor-pointer overflow-hidden rounded-2xl outline-none focus-visible:ring-8 focus-visible:ring-white/50"
    >
      {media && !isVideo ? (
        <MediaImage
          src={media.url}
          media={media}
          alt=""
          fit="cover"
          sizes="180px"
          className="size-full"
        />
      ) : poster ? (
        // Постер видео — уже уменьшенная копия с сервера, отдельной заглушки у него нет.
        <MediaImage src={poster} alt="" fit="cover" sizes="180px" className="size-full" />
      ) : (
        <div className={cn('size-full', storyBackgroundClass(card.background))} />
      )}
      <span className="absolute inset-0 bg-black/50" aria-hidden />
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-white">
        <span
          className={cn(
            'flex size-32 items-center justify-center rounded-full p-1.5',
            ring.hasUnseen
              ? 'bg-gradient-to-br from-primary via-indigo-500 to-violet-500'
              : 'bg-white/40',
          )}
        >
          <Avatar className="size-full border-4 border-black">
            {ring.author.avatarUrl && <AvatarImage src={ring.author.avatarUrl} alt="" />}
            <AvatarFallback className="text-4xl">
              {ring.author.firstName.charAt(0)}
              {ring.author.lastName.charAt(0)}
            </AvatarFallback>
          </Avatar>
        </span>
        <span className="max-w-full text-center text-4xl leading-tight font-semibold break-words">
          {name}
        </span>
      </span>
    </button>
  )
}

/** Пересчёт реакций кадра после тапа — та же арифметика, что сделает сервер. */
function applyReaction(card: StoryCard, emoji: string, add: boolean): StoryCard {
  const existing = card.reactions.find((r) => r.emoji === emoji)
  let reactions = card.reactions
  if (existing) {
    reactions = card.reactions
      .map((r) => (r.emoji === emoji ? { ...r, mine: add, count: r.count + (add ? 1 : -1) } : r))
      .filter((r) => r.count > 0)
  } else if (add) {
    reactions = [...card.reactions, { emoji, count: 1, mine: true }]
  }
  return { ...card, reactions }
}
