'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Pause, Play, Redo2, Send, Undo2, Users, Volume2, VolumeX } from 'lucide-react'
import {
  CreateStorySchema,
  STORY_CARDS_MAX,
  STORY_ELEMENTS_MAX,
  STORY_IMAGE_MIMES,
  STORY_MEDIA_DEFAULTS,
  STORY_MENTIONS_MAX,
  STORY_VIDEO_MIMES,
  type CreateStoryInput,
  type StoryBackgroundValue,
  type VideoTrimInput,
} from '@studenthub/shared-schemas'
import { localId, useFormAlert, useMediaQuery } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { createStoryRequest, storyKeys, uploadStoryMedia } from '../../../entities/story'
import {
  Button,
  CROP_TOOL_BUTTON,
  CropToolbar,
  EmojiPicker,
  MediaEditorShell,
  Modal,
} from '../../../shared/ui'
import {
  clamp01,
  isCard,
  newEmojiElement,
  newEventElement,
  newMentionElement,
  newPostElement,
  newScheduleElement,
  newTextElement,
  toStoryElements,
  type EditorElement,
} from '../model/editor-element'
import { useEditorHistory } from '../model/use-editor-history'
import { canvasFilterSupported, useStoryStage } from '../model/use-story-stage'
import { CardPicker, type CardKind, type PickedCard } from './card-picker'
import { StoryCanvas } from './story-canvas'
import { MentionPicker } from './mention-picker'
import {
  StoryAudienceFields,
  useAudienceLabel,
  useStoryAudiences,
  type StoryAudienceState,
} from './audience-fields'
import {
  ElementSettings,
  GeneralSettings,
  LinkSettings,
  MediaSettings,
  PollSettings,
  type SettingsView,
} from './settings-panel'
import { StoryTools, type StoryTool } from './story-tools'
import { VideoTimeline } from './video-timeline'
import type { StoryRecipient } from './recipients-picker'

const MB = 1024 * 1024
const MEDIA_ACCEPT = [...STORY_IMAGE_MIMES, ...STORY_VIDEO_MIMES].join(',')
// Фото выбрано, но ещё не загружено: кадр собирается и уходит на сервер только при
// публикации. Метка нужна схеме — «сторис с медиа» — и подменяется настоящим id файла.
const LOCAL_PHOTO = 'local-photo'
// Копия элемента встаёт чуть ниже и правее оригинала, чтобы её было видно.
const DUPLICATE_OFFSET = 0.04

/** Содержимое кадра — то, что отменяется и повторяется. */
interface StoryDoc {
  elements: EditorElement[]
  background?: StoryBackgroundValue
}

// Видео тоже уходит на сервер только при публикации — вместе с выбранным отрезком.
const LOCAL_VIDEO = 'local-video'
const MAX_VIDEO_MS = STORY_MEDIA_DEFAULTS.videoMaxSeconds * 1000

interface PickedVideo {
  file: File
  /** Локальный object-URL для превью: подписанную ссылку сервер отдаст уже в ленте. */
  url: string
  /** Длительность по метаданным; 0 — не прочиталась (тогда отрезать нечего, решит сервер). */
  durationMs: number
}

/** Инструмент, чей элемент выбран на кадре: его кнопка слева подсвечивается. */
const TOOL_OF: Record<EditorElement['type'], StoryTool> = {
  text: 'text',
  emoji: 'emoji',
  mention: 'mention',
  event: 'event',
  post: 'post',
  schedule: 'schedule',
}

/** Длительность видео в секундах по метаданным; не удалось прочитать — 0 (решит сервер). */
function videoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const done = (seconds: number): void => {
      URL.revokeObjectURL(url)
      resolve(seconds)
    }
    video.preload = 'metadata'
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : 0)
    video.onerror = () => done(0)
    video.src = url
  })
}

/** Фокус в поле ввода — горячие клавиши редактора его не трогают. */
function isTyping(target: HTMLElement): boolean {
  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable], [role="combobox"]') !== null
  )
}

/**
 * Редактор сторис на весь экран: инструменты слева, кадр 9:16 по центру, контекстные
 * настройки справа, внизу — кому видна сторис, «Отмена» и «Опубликовать».
 *
 * Состояния: пустой кадр — крупная зона загрузки и «текстовая сторис»; с медиа — кадр и
 * кадрирование под ним; выбран элемент — рамка с маркерами на кадре и его свойства справа.
 * Правки кадра (элементы и фон) отменяются и повторяются; фото кадрируется прямо на сцене
 * и собирается в JPEG только при публикации.
 *
 * На узком экране панели не сжимаются: инструменты — лентой внизу, настройки — шторкой.
 */
export function CreateStoryForm({
  onCreated,
  onClose,
}: { onCreated?: () => void; onClose?: () => void } = {}) {
  const t = useTranslations('Stories')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')
  const formId = useId()
  const qc = useQueryClient()
  const wide = useMediaQuery('(min-width: 1024px)')
  const audienceLabel = useAudienceLabel()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const [photo, setPhoto] = useState<File | null>(null)
  const [video, setVideo] = useState<PickedVideo | null>(null)
  // Выбранный на раскадровке отрезок видео.
  const [trim, setTrim] = useState<VideoTrimInput | null>(null)
  // Где сейчас превью видео, мс — для черты на раскадровке.
  const [videoAtMs, setVideoAtMs] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  // Прогресс загрузки медиа при публикации, %; null — ничего не грузится.
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)
  // Превью видео: по умолчанию без звука (автозапуск со звуком браузер запретит), звук и
  // пауза — кнопками под кадром.
  const [videoMuted, setVideoMuted] = useState(true)
  const [videoPaused, setVideoPaused] = useState(false)
  const stage = useStoryStage(photo)
  const history = useEditorHistory<StoryDoc>({ elements: [] })
  const { elements, background } = history.present
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [view, setView] = useState<SettingsView>('general')
  // Шторка настроек на узком экране; от 1024px панель видна всегда.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [cardKind, setCardKind] = useState<CardKind | null>(null)
  // Карточка, которую меняют на другую запись (а не добавляют новую).
  const [replacingId, setReplacingId] = useState<string | null>(null)
  // Ссылка добавлена — отдельное состояние, а не «linkUrl !== undefined»: пустое поле
  // уходит в форму как undefined (OPTIONAL_TEXT), и ссылка пропадала бы на стёртом адресе.
  const [linkOpen, setLinkOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const audiences = useStoryAudiences()
  // Имена получателей «выбранных» — для чипов; в форму уходят только их id.
  const [recipients, setRecipients] = useState<StoryRecipient[]>([])

  const form = useForm<CreateStoryInput>({
    resolver: zodResolver(CreateStorySchema),
    defaultValues: { audience: audiences[0] },
  })
  const audience = form.watch('audience')
  const poll = form.watch('poll')
  const hasMedia = photo !== null || video !== null

  // Кадр живёт в истории правок, а в форму уходит готовым к запросу: схема проверяет его
  // вместе с остальным (содержимое, число отметок). Фон — только у сторис без медиа.
  useEffect(() => {
    const opts = { shouldValidate: form.formState.isSubmitted }
    form.setValue('elements', elements.length > 0 ? toStoryElements(elements) : undefined, opts)
    form.setValue('background', hasMedia ? undefined : background, opts)
  }, [elements, background, hasMedia, form])

  function setAudience(next: StoryAudienceState): void {
    const opts = { shouldValidate: form.formState.isSubmitted }
    form.setValue('audience', next.audience, opts)
    form.setValue('groupId', next.groupId, opts)
    form.setValue('facultyId', next.facultyId, opts)
    form.setValue(
      'userIds',
      next.audience === 'SELECTED' && next.recipients.length > 0
        ? next.recipients.map((r) => r.id)
        : undefined,
      opts,
    )
    setRecipients(next.recipients)
  }

  const selected = elements.find((e) => e.id === selectedId) ?? null
  const selectedIndex = selected ? elements.indexOf(selected) : -1
  const full = elements.length >= STORY_ELEMENTS_MAX
  const cardsFull = elements.filter(isCard).length >= STORY_CARDS_MAX
  const mentionCount = new Set(elements.flatMap((e) => (e.type === 'mention' ? [e.userId] : [])))
    .size

  // ── Правки кадра (через историю) ─────────────────────────────────────────────────────

  function updateElements(update: (list: EditorElement[]) => EditorElement[], key?: string) {
    history.apply((doc) => ({ ...doc, elements: update(doc.elements) }), key)
  }

  function select(id: string | null): void {
    setSelectedId(id)
    if (id) setSheetOpen(true)
  }

  function addElement(element: EditorElement, edit = false): void {
    if (full) return
    updateElements((list) => [...list, element])
    select(element.id)
    if (edit) setEditingId(element.id)
  }

  function patchElement(id: string, patch: Partial<EditorElement>, key?: string): void {
    updateElements(
      (list) => list.map((e) => (e.id === id ? ({ ...e, ...patch } as EditorElement) : e)),
      key,
    )
  }

  function removeElement(id: string): void {
    updateElements((list) => list.filter((e) => e.id !== id))
    if (selectedId === id) setSelectedId(null)
    if (editingId === id) setEditingId(null)
  }

  /** Сдвиг по слоям: элементы рисуются по порядку, последний — сверху. */
  function moveLayer(id: string, step: 1 | -1): void {
    updateElements((list) => {
      const i = list.findIndex((e) => e.id === id)
      const j = i + step
      if (i < 0 || j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j] as EditorElement, next[i] as EditorElement]
      return next
    })
  }

  function duplicate(element: EditorElement): void {
    addElement({
      ...element,
      id: localId(),
      x: clamp01(element.x + DUPLICATE_OFFSET),
      y: clamp01(element.y + DUPLICATE_OFFSET),
    })
  }

  function finishEditing(id: string): void {
    setEditingId(null)
    // Пустой текст схема не примет — такой элемент просто убирается.
    const element = elements.find((e) => e.id === id)
    if (element?.type === 'text' && element.text.trim() === '') removeElement(id)
  }

  function addCard(card: PickedCard): void {
    const replacing = replacingId ? elements.find((e) => e.id === replacingId) : undefined
    const fresh =
      card.kind === 'event'
        ? newEventElement(card.event)
        : card.kind === 'post'
          ? newPostElement(card.post)
          : newScheduleElement(card.pair, card.date)
    if (replacing) {
      // Другая запись на месте прежней карточки: положение, размер и поворот — те же.
      const { x, y, scale, rotation } = replacing
      updateElements((list) =>
        list.map((e) =>
          e.id === replacing.id ? { ...fresh, id: e.id, x, y, scale, rotation } : e,
        ),
      )
    } else {
      addElement(fresh)
    }
    setCardKind(null)
    setReplacingId(null)
  }

  /** Текстовая сторис: фон и текст на нём — одним шагом истории, текст сразу в наборе. */
  function textStory(): void {
    const element = newTextElement(t('textDefault'))
    history.apply((doc) => ({
      background: doc.background ?? 'graphite',
      elements: [...doc.elements, element],
    }))
    select(element.id)
    setEditingId(element.id)
  }

  // ── Медиа ────────────────────────────────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: async (input: CreateStoryInput) => {
      // Фото собирается в кадр 1080×1920 и загружается только сейчас: пока автор правил
      // кадр, на сервер ничего не уходило.
      if (input.fileId === LOCAL_PHOTO) {
        const uploaded = await uploadStoryMedia(await stage.exportPhoto(), setUploadPercent)
        input = { ...input, fileId: uploaded.id }
      } else if (input.fileId === LOCAL_VIDEO && video) {
        // Отрезок — только если он что-то режет: ролик целиком в лимите грузится как есть.
        const cuts = trim !== null && (trim.startMs > 0 || trim.endMs < video.durationMs)
        const uploaded = await uploadStoryMedia(
          video.file,
          setUploadPercent,
          cuts ? trim : undefined,
        )
        input = { ...input, fileId: uploaded.id }
      }
      return createStoryRequest(input)
    },
    onSettled: () => setUploadPercent(null),
    onMutate: () => resetApiError(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storyKeys.all })
      if (video) URL.revokeObjectURL(video.url)
      setVideo(null)
      setTrim(null)
      setPhoto(null)
      setLinkOpen(false)
      history.reset({ elements: [] })
      setSelectedId(null)
      setRecipients([])
      form.reset({ audience: audiences[0] })
      toast.success(t('published'))
      onCreated?.()
    },
    onError: (e) => showApiError(e),
  })

  // Формат, размер и длительность проверяются до загрузки — сервер проверит то же, но
  // гнать по сети файл, который всё равно не пройдёт, незачем.
  async function pickFile(file: File | undefined): Promise<void> {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    const isImage = (STORY_IMAGE_MIMES as readonly string[]).includes(file.type)
    const isVideo = (STORY_VIDEO_MIMES as readonly string[]).includes(file.type)
    if (!isImage && !isVideo) {
      toast.error(t('badFormat'))
      return
    }
    const maxMb = isImage ? STORY_MEDIA_DEFAULTS.imageMaxMb : STORY_MEDIA_DEFAULTS.videoMaxMb
    if (file.size > maxMb * MB) {
      toast.error(t('tooLarge', { mb: maxMb }))
      return
    }
    if (isVideo) {
      // Ролик длиннее лимита не отклоняется: на раскадровке выбирают отрезок до 1:45,
      // по умолчанию — начало ролика.
      const durationMs = Math.round((await videoDuration(file)) * 1000)
      dropMedia()
      setVideo({ file, url: URL.createObjectURL(file), durationMs })
      setTrim(durationMs > 0 ? { startMs: 0, endMs: Math.min(durationMs, MAX_VIDEO_MS) } : null)
      setVideoAtMs(0)
      setVideoMuted(true)
      setVideoPaused(false)
      form.setValue('fileId', LOCAL_VIDEO)
      return
    }
    dropMedia()
    setPhoto(file)
    form.setValue('fileId', LOCAL_PHOTO)
    openView('media')
  }

  function dropMedia(): void {
    if (video) URL.revokeObjectURL(video.url)
    setVideo(null)
    setTrim(null)
    setPhoto(null)
    form.setValue('fileId', undefined)
    if (view === 'media') setView('general')
  }

  // Превью видео: звук и пауза — кнопками, играет только выбранный отрезок по кругу.
  // `muted` React выставляет только при монтировании — звук переключаем свойством.
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.muted = videoMuted
    if (videoPaused) el.pause()
    // Запуск со звуком браузер разрешает только после жеста — нажатие кнопки им и было.
    else void el.play().catch(() => undefined)
  }, [videoMuted, videoPaused, video])

  useEffect(() => {
    const el = videoRef.current
    if (!el || !video) return
    let frame = 0
    // Черта на раскадровке — по кадрам анимации: timeupdate приходит 4 раза в секунду, и
    // черта шла бы рывками. Дошли до конца отрезка — обратно к его началу.
    const tick = (): void => {
      const ms = el.currentTime * 1000
      if (trim && (ms >= trim.endMs || ms < trim.startMs - 250)) {
        el.currentTime = trim.startMs / 1000
      }
      setVideoAtMs(el.currentTime * 1000)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const onEnded = (): void => {
      el.currentTime = (trim?.startMs ?? 0) / 1000
      if (!videoPaused) void el.play().catch(() => undefined)
    }
    el.addEventListener('ended', onEnded)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('ended', onEnded)
    }
  }, [video, trim, videoPaused])

  function seekVideo(ms: number): void {
    const el = videoRef.current
    if (el) el.currentTime = ms / 1000
    setVideoAtMs(ms)
  }

  // ── Панели и инструменты ─────────────────────────────────────────────────────────────

  function openView(next: SettingsView): void {
    setSelectedId(null)
    setEditingId(null)
    setView(next)
    setSheetOpen(true)
  }

  function closePanel(): void {
    setSelectedId(null)
    setView('general')
    setSheetOpen(false)
  }

  function pickTool(tool: StoryTool): void {
    if (tool === 'text') {
      addElement(newTextElement(t('textDefault')), true)
    } else if (tool === 'emoji') {
      setEmojiOpen(true)
    } else if (tool === 'mention') {
      setMentionOpen(true)
    } else if (tool === 'link') {
      setLinkOpen(true)
      openView('link')
    } else if (tool === 'poll') {
      if (!poll) form.setValue('poll', { question: '', options: ['', ''] })
      openView('poll')
    } else {
      setReplacingId(null)
      setCardKind(tool)
    }
  }

  function removeLink(): void {
    form.setValue('linkUrl', undefined)
    form.setValue('linkLabel', undefined)
    setLinkOpen(false)
    setView('general')
  }

  function removePoll(): void {
    form.setValue('poll', undefined)
    setView('general')
  }

  const activeTool: StoryTool | null = selected
    ? TOOL_OF[selected.type]
    : view === 'link' || view === 'poll'
      ? view
      : null

  // ── Горячие клавиши ─────────────────────────────────────────────────────────────────

  const busy = mutation.isPending
  // Корень оболочки — граница, внутри которой работают горячие клавиши.
  const stageRootRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    stageRootRef.current = stage.stageRef.current?.closest<HTMLElement>('[data-overlay]') ?? null
  })
  const live = useRef({ selectedId, sheetOpen, wide, history, removeElement })
  live.current = { selectedId, sheetOpen, wide, history, removeElement }

  useEffect(() => {
    // В фазе захвата: раньше, чем Esc увидит оболочка и закроет весь редактор.
    function onKey(e: KeyboardEvent): void {
      const root = stageRootRef.current
      const target = e.target as HTMLElement | null
      if (!root || !target) return
      // Только когда фокус в редакторе (или нигде): во вложенных окнах — их клавиши.
      if (target !== document.body && !root.contains(target)) return
      if (isTyping(target)) return
      const { selectedId: id, sheetOpen: open, wide: isWide, history: h } = live.current
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && (key === 'z' || key === 'y')) {
        e.preventDefault()
        if (key === 'y' || e.shiftKey) h.redo()
        else h.undo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && id) {
        e.preventDefault()
        live.current.removeElement(id)
      } else if (e.key === 'Escape' && (id || (open && !isWide))) {
        e.preventDefault()
        if (id) setSelectedId(null)
        else setSheetOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (audiences.length === 0) return null

  const contentError = form.formState.errors.text
  const elementsError = form.formState.errors.elements

  // Пока фото или видео уходит на сервер, редактор не закрывается — иначе публикация
  // продолжилась бы без окна, а ошибку некому было бы показать.
  function close(): void {
    if (busy) return
    onClose?.()
  }

  const audienceFields = (
    <StoryAudienceFields
      stacked
      value={{
        audience,
        groupId: form.watch('groupId'),
        facultyId: form.watch('facultyId'),
        recipients,
      }}
      onChange={setAudience}
      recipientsError={form.formState.errors.userIds ? t('recipientsNeed') : undefined}
    />
  )

  let panel
  if (selected) {
    panel = (
      <ElementSettings
        element={selected}
        onChange={(patch) =>
          patchElement(selected.id, patch, `${Object.keys(patch).join(',')}:${selected.id}`)
        }
        onForward={() => moveLayer(selected.id, 1)}
        onBackward={() => moveLayer(selected.id, -1)}
        onDuplicate={() => duplicate(selected)}
        onRemove={() => removeElement(selected.id)}
        onReplaceCard={
          isCard(selected)
            ? () => {
                setReplacingId(selected.id)
                setCardKind(selected.type as CardKind)
              }
            : undefined
        }
        canForward={selectedIndex < elements.length - 1}
        canBackward={selectedIndex > 0}
        canDuplicate={!full && !(isCard(selected) && cardsFull) && selected.type !== 'mention'}
        onClose={closePanel}
      />
    )
  } else if (view === 'media' && photo) {
    panel = (
      <MediaSettings
        stage={stage}
        filtersSupported={canvasFilterSupported()}
        onClose={closePanel}
      />
    )
  } else if (view === 'link' && linkOpen) {
    panel = <LinkSettings form={form} onRemove={removeLink} onClose={closePanel} />
  } else if (view === 'poll' && poll) {
    panel = <PollSettings form={form} onRemove={removePoll} onClose={closePanel} />
  } else {
    panel = (
      <GeneralSettings
        audience={audienceFields}
        hasMedia={hasMedia}
        background={background}
        onBackground={(key) => history.apply((doc) => ({ ...doc, background: key }), 'background')}
        linkUrl={linkOpen ? (form.watch('linkUrl') ?? '') : undefined}
        pollQuestion={poll?.question}
        hasPoll={!!poll}
        onOpen={openView}
        onClose={() => setSheetOpen(false)}
      />
    )
  }

  const iconButton =
    'flex size-9 items-center justify-center rounded-lg text-white/80 transition-colors duration-150 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30 motion-reduce:transition-none'

  // Подсказка над кадром — по тому, что сейчас в работе.
  const hint = selected
    ? t('elementHint')
    : photo
      ? t('photoHint')
      : elements.length > 0
        ? t('selectHint')
        : t('formatHint')

  return (
    <MediaEditorShell
      title={t('newStory')}
      onClose={close}
      solid
      actions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={iconButton}
            aria-label={t('undoEdit')}
            title={t('undoEdit')}
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <Undo2 className="size-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label={t('redo')}
            title={t('redo')}
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <Redo2 className="size-[18px]" aria-hidden />
          </button>
        </div>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept={MEDIA_ACCEPT}
        className="hidden"
        onChange={(e) => void pickFile(e.target.files?.[0])}
      />

      {/* Каркас — одна сетка, без отступов и сдвигов для раскладки панелей:
          телефон  — [кадр] / [инструменты] / [публикация];
          планшет  — [иконки | кадр] / [публикация], настройки выезжают поверх справа;
          ноутбук  — [220 | кадр | 280], от 1280px — [260 | кадр | 300]; снизу — публикация 64px. */}
      <form
        id={formId}
        className={cn(
          'relative grid min-h-0 flex-1',
          'grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto_auto]',
          'md:grid-cols-[72px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_auto]',
          'lg:grid-cols-[220px_minmax(0,1fr)_280px] xl:grid-cols-[260px_minmax(0,1fr)_300px]',
        )}
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <div className="row-start-2 min-h-0 border-t border-white/10 md:col-start-1 md:row-start-1 md:border-t-0 md:border-r">
          <StoryTools
            active={activeTool}
            onPick={pickTool}
            disabled={{
              text: full,
              emoji: full,
              mention: full || mentionCount >= STORY_MENTIONS_MAX,
              event: full || cardsFull,
              schedule: full || cardsFull,
              post: full || cardsFull,
            }}
          />
        </div>

        {/* Рабочая область: сверху и снизу — полосы одной высоты, кадр строго посередине.
            Нижняя полоса есть всегда (линейка фото, звук видео или пусто), поэтому кадр не
            прыгает, когда появляется медиа или открываются настройки. */}
        <main className="row-start-1 grid min-h-0 min-w-0 grid-rows-[0_minmax(0,1fr)_3.5rem] md:col-start-2 md:grid-rows-[3.5rem_minmax(0,1fr)_3.5rem]">
          {/* Не `hidden`: выпавшая из сетки строка сдвинула бы кадр в нулевую. На телефоне
              строка нулевой высоты, подсказка обрезается. */}
          <p className="flex min-h-0 items-center justify-center truncate overflow-hidden px-4 text-xs text-muted-foreground">
            {hint}
          </p>
          <StoryCanvas
            stage={stage}
            hasPhoto={photo !== null}
            videoUrl={video?.url ?? null}
            videoRef={videoRef}
            background={background}
            elements={elements}
            selectedId={selectedId}
            editingId={editingId}
            onSelect={select}
            onPatch={patchElement}
            onStartEdit={(id) => {
              select(id)
              setEditingId(id)
            }}
            onEditDone={finishEditing}
            onRemoveMedia={dropMedia}
            onTapStage={() => {
              setEditingId(null)
              setView(photo ? 'media' : 'general')
            }}
            onPickMedia={() => fileRef.current?.click()}
            onTextStory={textStory}
            onDropFile={(file) => void pickFile(file)}
          />
          <div className="flex min-w-0 items-center justify-center">
            {/* Кадрирование фото: поворот · линейка угла · отражение */}
            {photo && (
              <CropToolbar
                className="pt-0"
                angle={stage.angle}
                flip={stage.flip}
                disabled={!stage.ready}
                onRotate={stage.rotate90}
                onAngle={stage.setAngle}
                onFlip={stage.toggleFlip}
                onRulerStart={stage.onRulerStart}
                onRulerEnd={stage.onRulerEnd}
              />
            )}
            {/* Превью видео: пауза, звук и раскадровка с выбором отрезка до 1:45. */}
            {video && (
              <div className="flex w-full min-w-0 items-center gap-2 px-4">
                <button
                  type="button"
                  className={cn(CROP_TOOL_BUTTON, 'text-white/80 hover:text-white')}
                  aria-label={videoPaused ? tCommon('play') : tCommon('pause')}
                  title={videoPaused ? tCommon('play') : tCommon('pause')}
                  onClick={() => setVideoPaused((p) => !p)}
                >
                  {videoPaused ? (
                    <Play className="size-5" aria-hidden />
                  ) : (
                    <Pause className="size-5" aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  className={cn(
                    CROP_TOOL_BUTTON,
                    videoMuted ? 'text-white/80 hover:text-white' : 'text-primary',
                  )}
                  aria-label={videoMuted ? tCommon('unmute') : tCommon('mute')}
                  title={videoMuted ? tCommon('unmute') : tCommon('mute')}
                  aria-pressed={!videoMuted}
                  onClick={() => {
                    setVideoMuted((m) => !m)
                    setVideoPaused(false)
                  }}
                >
                  {videoMuted ? (
                    <VolumeX className="size-5" aria-hidden />
                  ) : (
                    <Volume2 className="size-5" aria-hidden />
                  )}
                </button>
                {trim && video.durationMs > 0 && (
                  <VideoTimeline
                    url={video.url}
                    durationMs={video.durationMs}
                    trim={trim}
                    maxMs={MAX_VIDEO_MS}
                    currentMs={videoAtMs}
                    onTrim={(next, edge) => {
                      setTrim(next)
                      // Превью показывает тянущийся край: видно, где режется ролик.
                      seekVideo(
                        edge === 'start' ? next.startMs : Math.max(next.startMs, next.endMs - 500),
                      )
                    }}
                    onSeek={seekVideo}
                  />
                )}
              </div>
            )}
          </div>
        </main>

        {/* Настройки: колонка сетки от 1024px; уже — выезжающая панель или шторка поверх
            рабочей области, чтобы кадр под ней не менял размер. */}
        <aside
          aria-label={t('settingsTitle')}
          className={cn(
            'z-20 min-h-0 flex-col overflow-x-hidden overflow-y-auto bg-card p-4 select-text',
            'absolute inset-x-0 bottom-0 max-h-[60dvh] rounded-t-xl border-t border-white/10 shadow-[0_-8px_32px_rgb(0_0_0/0.35)]',
            // планшет: отступ 16px от краёв рабочей области, над полосой публикации (64px)
            'md:inset-x-auto md:top-4 md:right-4 md:bottom-20 md:max-h-none md:w-80 md:rounded-xl md:border',
            'lg:static lg:col-start-3 lg:row-start-1 lg:w-auto lg:rounded-none lg:border-0 lg:border-l lg:shadow-none',
            sheetOpen
              ? 'flex duration-200 animate-in fade-in-0 slide-in-from-bottom-4 md:slide-in-from-right-4 md:slide-in-from-bottom-0 lg:animate-none motion-reduce:animate-none'
              : 'hidden lg:flex',
          )}
        >
          <span
            aria-hidden
            className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-white/20 md:hidden"
          />
          {/* Ключ — смена содержимого панели проигрывается мягким появлением. */}
          <div
            key={selected ? `el:${selected.id}` : view}
            className="duration-200 animate-in fade-in-0 motion-reduce:animate-none"
          >
            {panel}
          </div>
        </aside>

        {/* Публикация 64px — во всю ширину под колонками: на центр кадра не влияет. Слева —
            формат или ошибка, справа — кому видна сторис, «Отмена» и «Опубликовать». */}
        <footer className="col-span-full row-start-3 flex h-16 items-center gap-3 border-t border-white/10 px-4 md:row-start-2 lg:row-start-2 box-content pb-[env(safe-area-inset-bottom)]">
          <div className="min-w-0 flex-1 text-xs">
            {uploadPercent !== null ? (
              <p className="truncate text-muted-foreground tabular-nums">
                {t('uploadingPercent', { percent: uploadPercent })}
              </p>
            ) : apiError ? (
              <p role="alert" className="truncate text-destructive">
                {tErr(apiError.code)}
              </p>
            ) : contentError || elementsError ? (
              <p role="alert" className="truncate text-destructive">
                {contentError ? t('needContent') : t('elementsInvalid')}
              </p>
            ) : (
              <p className="truncate text-muted-foreground max-sm:hidden">{t('formatInfo')}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => openView('general')}
            className="flex h-10 min-w-0 items-center gap-2 rounded-[10px] bg-muted/50 px-3 text-sm transition-colors duration-150 hover:bg-muted motion-reduce:transition-none"
          >
            <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground max-sm:sr-only">{t('audienceShort')}</span>
            <span className="truncate font-medium">{audience ? audienceLabel(audience) : ''}</span>
          </button>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="max-sm:hidden"
              onClick={close}
              disabled={busy}
            >
              {tCommon('cancel')}
            </Button>
          )}
          <Button type="submit" form={formId} size="lg" loading={mutation.isPending}>
            <Send className="size-4" aria-hidden />
            {t('publish')}
          </Button>
        </footer>
      </form>

      {emojiOpen && (
        <Modal onClose={() => setEmojiOpen(false)} title={t('toolEmoji')} size="md">
          <EmojiPicker
            size="lg"
            onPick={(emoji) => {
              addElement(newEmojiElement(emoji))
              setEmojiOpen(false)
            }}
          />
        </Modal>
      )}

      {cardKind && (
        <CardPicker
          kind={cardKind}
          onPick={addCard}
          onClose={() => {
            setCardKind(null)
            setReplacingId(null)
          }}
        />
      )}

      {mentionOpen && (
        <MentionPicker
          onClose={() => setMentionOpen(false)}
          onPick={(userId, name) => {
            addElement(newMentionElement(userId, name))
            setMentionOpen(false)
          }}
        />
      )}
    </MediaEditorShell>
  )
}
