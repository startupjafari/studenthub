'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight, Eye, ExternalLink, Flag, Trash2, X } from 'lucide-react'
import { canFileComplaint } from '@studenthub/shared-schemas'
import { pickSource, srcSetOf, useBackClose, useBodyScrollLock, useHls } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
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
const FRAME_MS = 7000
// Ширина кадра сторис для srcset: на телефоне во весь экран, на десктопе — колонка ~420px.
const STORY_SIZES = '(max-width: 640px) 100vw, 420px'

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
// полноценный пикер в формате, который смотрят секундами, никто не открывает.
const QUICK_REACTIONS = ['❤️', '🔥', '👏', '😮', '😢'] as const

/**
 * Полноэкранный просмотр сторис: кадры одного автора идут подряд, по концу кольца
 * открывается следующий автор.
 *
 * Прогресс считается таймером, а не CSS-анимацией: его нужно останавливать (палец на
 * экране, открытый список зрителей, вкладка в фоне) и отматывать назад по тапу, а
 * анимация про это ничего не знает.
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
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [ringIndex, setRingIndex] = useState(startIndex)
  const [storyIndex, setStoryIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const [viewersOpen, setViewersOpen] = useState(false)
  // Жалоба на сторис (§3.4) — тем, чью жалобу сервер примет; кадр на это время стоит.
  const [reporting, setReporting] = useState<StoryCard | null>(null)
  const myId = useAppSelector((s) => s.auth.user?.id)
  const canReport = canFileComplaint(useAppSelector((s) => s.auth.role))
  // Локальные правки поверх серверной выдачи: голос и реакция должны быть видны сразу,
  // а перезапрашивать всю ленту колец ради одного кадра незачем.
  const [patched, setPatched] = useState<Record<string, StoryCard>>({})

  useBodyScrollLock(true, true)
  useBackClose(onClose)

  const ring = rings[ringIndex]
  const raw = ring?.stories[storyIndex]
  const story = raw ? (patched[raw.id] ?? raw) : undefined

  // Закрытие обновляет ленту колец: пока шёл просмотр, сторисы стали просмотренными.
  const close = useCallback(() => {
    void qc.invalidateQueries({ queryKey: storyKeys.feed() })
    onClose()
  }, [onClose, qc])

  const goNext = useCallback(() => {
    setProgress(0)
    const current = rings[ringIndex]
    if (current && storyIndex + 1 < current.stories.length) {
      setStoryIndex(storyIndex + 1)
      return
    }
    if (ringIndex + 1 < rings.length) {
      setRingIndex(ringIndex + 1)
      setStoryIndex(0)
      return
    }
    close()
  }, [close, ringIndex, rings, storyIndex])

  const goPrev = useCallback(() => {
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

  // Отметка просмотра — один раз на кадр. Ответ не нужен: признак «смотрел» приедет
  // со следующей выдачей ленты, а ошибка сети не должна мешать смотреть дальше.
  const storyId = story?.id
  useEffect(() => {
    if (!storyId) return
    void markStoryViewed(storyId).catch(() => undefined)
  }, [storyId])

  // Снимок ещё не пришёл — время кадра не идёт: на медленной сети сторис иначе пролистывалась,
  // так и не показавшись (раньше таймер стартовал вместе с запросом картинки).
  // Готовность привязана к id кадра, а не сбрасывается эффектом: снимок из кэша присылает
  // load раньше, чем отработал бы сброс, и кадр навсегда остался бы «не готов».
  const [readyStoryId, setReadyStoryId] = useState<string | null>(null)
  const imageReady = !!storyId && readyStoryId === storyId

  // Следующий кадр греем заранее — и в этом кольце, и первый у следующего автора.
  const nextCard = ring?.stories[storyIndex + 1] ?? rings[ringIndex + 1]?.stories[0]
  useEffect(() => warmStory(nextCard), [nextCard])

  // Видео — адаптивным HLS (качество под сеть), запасной путь — оригинал.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  useHls(videoEl, story?.media?.hls, story?.media?.url)

  // Таймер кадра. Шаг 50 мс: полоса растёт плавно, а таймеров на секунду немного.
  const isVideo = story?.media?.mime.startsWith('video/') ?? false
  const waitingImage = !!story?.media && !isVideo && !imageReady
  useEffect(() => {
    if (!story || paused || viewersOpen || reporting || isVideo || waitingImage) return
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
  }, [goNext, isVideo, paused, reporting, story, viewersOpen, waitingImage])

  // Клавиатура: листание стрелками, пробел — пауза, Esc закрывает (useBackClose).
  // Пока открыта жалоба, клавиатура её: пробел и стрелки нужны полю пояснения.
  const reportOpen = reporting !== null
  useEffect(() => {
    if (reportOpen) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === ' ') {
        e.preventDefault()
        setPaused((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrev, reportOpen])

  const vote = useMutation({
    mutationFn: ({ id, optionId }: { id: string; optionId: string }) =>
      voteStoryRequest(id, optionId),
    onSuccess: (updated) => setPatched((prev) => ({ ...prev, [updated.id]: updated })),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteStoryRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storyKeys.all })
      onClose()
    },
  })

  async function toggleReaction(card: StoryCard, emoji: string): Promise<void> {
    const mine = card.reactions.find((r) => r.emoji === emoji && r.mine)
    // Оптимистично: тап по эмодзи обязан отзываться мгновенно, запрос идёт следом.
    setPatched((prev) => ({ ...prev, [card.id]: applyReaction(card, emoji, !mine) }))
    try {
      if (mine) await removeStoryReactionRequest(card.id, emoji)
      else await addStoryReactionRequest(card.id, emoji)
    } catch {
      setPatched((prev) => ({ ...prev, [card.id]: card }))
    }
  }

  async function askDelete(card: StoryCard): Promise<void> {
    setPaused(true)
    const ok = await confirm({ title: t('confirmDelete'), destructive: true })
    setPaused(false)
    if (ok) remove.mutate(card.id)
  }

  const segments = useMemo(() => ring?.stories.map((s) => s.id) ?? [], [ring])

  if (typeof document === 'undefined' || !ring || !story) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95">
      {/* Кадр 9:16 по центру: на телефоне во весь экран, на десктопе — колонкой. */}
      <div className="relative flex h-full w-full max-w-[26rem] flex-col sm:h-[min(90dvh,46rem)] sm:rounded-2xl sm:overflow-hidden">
        <div className="absolute inset-x-0 top-0 z-20 flex gap-1 p-2">
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

        <header className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 pt-5 pb-2 text-white">
          <Avatar className="size-8">
            {story.author.avatarUrl && <AvatarImage src={story.author.avatarUrl} alt="" />}
            <AvatarFallback>
              {story.author.firstName.charAt(0)}
              {story.author.lastName.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {story.author.firstName} {story.author.lastName}
          </span>
          {canReport && story.author.id !== myId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon
              aria-label={t('report')}
              className="text-white hover:bg-white/15 hover:text-white"
              onClick={() => setReporting(story)}
            >
              <Flag className="size-4" aria-hidden />
            </Button>
          )}
          {story.canDelete && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon
              aria-label={t('delete')}
              className="text-white hover:bg-white/15 hover:text-white"
              onClick={() => void askDelete(story)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon
            aria-label={tCommon('close')}
            className="text-white hover:bg-white/15 hover:text-white"
            onClick={close}
          >
            <X className="size-5" aria-hidden />
          </Button>
        </header>

        {/* Сам кадр. Пауза по удержанию — как во всех сторис: палец на экране останавливает
            отсчёт, отпускание продолжает. */}
        <div
          className={cn(
            'relative flex flex-1 items-center justify-center overflow-hidden',
            !story.media && storyBackgroundClass(story.background),
          )}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
        >
          {story.media ? (
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
                controls={false}
                onTimeUpdate={(e) => {
                  const el = e.currentTarget
                  if (el.duration > 0) setProgress(el.currentTime / el.duration)
                }}
                onEnded={goNext}
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
                // Битую картинку не ждём вечно: кадр идёт дальше по своему таймеру.
                onError={() => setReadyStoryId(story.id)}
              />
            )
          ) : null}

          {story.text && (
            <p
              className={cn(
                'absolute inset-x-6 text-center text-lg leading-snug font-medium break-words text-white drop-shadow-lg',
                story.media ? 'bottom-24' : 'top-1/2 -translate-y-1/2',
              )}
            >
              {story.text}
            </p>
          )}

          {story.poll && (
            <div className="absolute inset-x-4 bottom-24 z-10 rounded-2xl bg-black/55 p-3 text-white backdrop-blur">
              <p className="mb-2 text-sm font-medium">{story.poll.question}</p>
              <div className="flex flex-col gap-1.5">
                {story.poll.options.map((option) => {
                  const total = story.poll?.totalVotes ?? 0
                  const share = total > 0 ? Math.round((option.votes / total) * 100) : 0
                  const mine = story.poll?.myOptionId === option.id
                  const answered = story.poll?.myOptionId !== null
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={cn(
                        'relative overflow-hidden rounded-lg px-3 py-2 text-left text-sm',
                        mine ? 'bg-white/25 font-medium' : 'bg-white/10 hover:bg-white/20',
                      )}
                      onClick={() => vote.mutate({ id: story.id, optionId: option.id })}
                    >
                      {/* Доля голосов — заливкой самой кнопки: отдельная полоса в кадре
                          этого размера читается хуже, чем закрашенная строка. */}
                      {answered && (
                        <span
                          aria-hidden
                          className="absolute inset-y-0 left-0 bg-white/20"
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

          {/* Зоны листания: левая треть — назад, остальное — вперёд. Кнопки, а не
              обработчики на кадре, — чтобы работала клавиатура и читалка. */}
          <button
            type="button"
            aria-label={tCommon('previous')}
            className="absolute inset-y-0 left-0 w-1/3 cursor-default"
            onClick={goPrev}
          />
          <button
            type="button"
            aria-label={tCommon('next')}
            className="absolute inset-y-0 right-0 w-2/3 cursor-default"
            onClick={goNext}
          />
        </div>

        <footer className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 bg-gradient-to-t from-black/70 to-transparent p-3 text-white">
          {story.linkUrl && (
            <a
              href={story.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur hover:bg-white/25"
            >
              <ExternalLink className="size-4" aria-hidden />
              {story.linkLabel ?? t('openLink')}
            </a>
          )}
          <div className="flex items-center gap-1">
            {QUICK_REACTIONS.map((emoji) => {
              const mine = story.reactions.some((r) => r.emoji === emoji && r.mine)
              const count = story.reactions.find((r) => r.emoji === emoji)?.count ?? 0
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-pressed={mine}
                  aria-label={emoji}
                  onClick={() => void toggleReaction(story, emoji)}
                  className={cn(
                    'flex items-center gap-1 rounded-full px-2 py-1 text-base',
                    mine ? 'bg-white/30' : 'bg-white/10 hover:bg-white/20',
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
                className="ml-auto flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-sm hover:bg-white/20"
              >
                <Eye className="size-4" aria-hidden />
                <span className="tabular-nums">{story.viewsCount}</span>
              </button>
            )}
          </div>
        </footer>
      </div>

      {/* Стрелки на десктопе: пальцем листают тапом по кадру, мышью — по краям экрана. */}
      <Button
        type="button"
        variant="ghost"
        size="lg"
        icon
        aria-label={tCommon('previous')}
        className="absolute left-4 hidden text-white hover:bg-white/15 hover:text-white sm:flex"
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
        className="absolute right-4 hidden text-white hover:bg-white/15 hover:text-white sm:flex"
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
    </div>,
    document.body,
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
