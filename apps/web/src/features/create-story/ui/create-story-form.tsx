'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Plus, Redo2, Undo2, Users } from 'lucide-react'
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
} from '@studenthub/shared-schemas'
import { localId, useFormAlert, useMediaQuery } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { createStoryRequest, storyKeys, uploadStoryMedia } from '../../../entities/story'
import {
  Button,
  CropToolbar,
  EmojiPicker,
  FieldError,
  FormAlert,
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

interface UploadedVideo {
  id: string
  /** Локальный object-URL для превью: подписанную ссылку сервер отдаст уже в ленте. */
  url: string
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
  const wide = useMediaQuery('(min-width: 1280px)')
  const audienceLabel = useAudienceLabel()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const [photo, setPhoto] = useState<File | null>(null)
  const [video, setVideo] = useState<UploadedVideo | null>(null)
  const [uploading, setUploading] = useState(false)
  const stage = useStoryStage(photo)
  const history = useEditorHistory<StoryDoc>({ elements: [] })
  const { elements, background } = history.present
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [view, setView] = useState<SettingsView>('general')
  // Шторка настроек на узком экране; от 1280px панель видна всегда.
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
        const uploaded = await uploadStoryMedia(await stage.exportPhoto())
        input = { ...input, fileId: uploaded.id }
      }
      return createStoryRequest(input)
    },
    onMutate: () => resetApiError(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storyKeys.all })
      if (video) URL.revokeObjectURL(video.url)
      setVideo(null)
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

  // Видео не кадрируется — уходит на сервер сразу, пока автор занят остальным.
  async function uploadVideo(file: File): Promise<void> {
    setUploading(true)
    try {
      const uploaded = await uploadStoryMedia(file)
      dropMedia()
      setVideo({ id: uploaded.id, url: URL.createObjectURL(file) })
      form.setValue('fileId', uploaded.id)
      openView('media')
    } catch (e) {
      toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
    } finally {
      setUploading(false)
    }
  }

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
      const seconds = await videoDuration(file)
      if (seconds > STORY_MEDIA_DEFAULTS.videoMaxSeconds) {
        toast.error(t('tooLong', { s: STORY_MEDIA_DEFAULTS.videoMaxSeconds }))
        return
      }
      await uploadVideo(file)
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
    setPhoto(null)
    form.setValue('fileId', undefined)
    if (view === 'media') setView('general')
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
    if (tool === 'media') {
      if (hasMedia) openView('media')
      else fileRef.current?.click()
    } else if (tool === 'text') {
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
    : view === 'general'
      ? null
      : view

  // ── Горячие клавиши ─────────────────────────────────────────────────────────────────

  const busy = uploading || mutation.isPending
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
  } else if (view === 'media' && hasMedia) {
    panel = (
      <MediaSettings
        kind={photo ? 'photo' : 'video'}
        stage={stage}
        filtersSupported={photo !== null && canvasFilterSupported()}
        onReplace={() => fileRef.current?.click()}
        onRemove={dropMedia}
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

  const historyButton =
    'flex size-9 items-center justify-center rounded-lg text-white/80 transition-colors duration-150 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30 motion-reduce:transition-none'

  return (
    <MediaEditorShell
      title={t('newStory')}
      onClose={close}
      solid
      actions={
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className={historyButton}
            aria-label={t('undoEdit')}
            title={t('undoEdit')}
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <Undo2 className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            className={historyButton}
            aria-label={t('redo')}
            title={t('redo')}
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <Redo2 className="size-5" aria-hidden />
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

      <form
        id={formId}
        className="relative flex min-h-0 flex-1 flex-col border-t border-white/10 md:flex-row"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <div className="order-last md:order-none">
          <StoryTools
            active={activeTool}
            busy={uploading}
            onPick={pickTool}
            disabled={{
              media: busy,
              text: full,
              emoji: full,
              mention: full || mentionCount >= STORY_MENTIONS_MAX,
              event: full || cardsFull,
              schedule: full || cardsFull,
              post: full || cardsFull,
            }}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <StoryCanvas
            stage={stage}
            hasPhoto={photo !== null}
            videoUrl={video?.url ?? null}
            background={background}
            elements={elements}
            selectedId={selectedId}
            editingId={editingId}
            uploading={uploading}
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
              setView(hasMedia ? 'media' : 'general')
            }}
            onPickMedia={() => fileRef.current?.click()}
            onTextStory={textStory}
            onDropFile={(file) => void pickFile(file)}
          />

          {/* Кадрирование фото: поворот · линейка угла · отражение */}
          {photo && (
            <CropToolbar
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
        </div>

        {/* Настройки: колонка справа от 1280px, ниже — выезжающая панель или шторка. */}
        <aside
          aria-label={t('settingsTitle')}
          className={cn(
            'z-20 flex-col gap-4 overflow-y-auto bg-card p-4 select-text',
            'absolute inset-x-0 bottom-0 max-h-[60dvh] rounded-t-2xl border-t border-white/10 shadow-[0_-8px_32px_rgb(0_0_0/0.35)]',
            'md:inset-x-auto md:top-3 md:right-3 md:bottom-3 md:max-h-none md:w-80 md:rounded-xl md:border',
            'xl:static xl:w-[18rem] xl:shrink-0 xl:rounded-none xl:border-0 xl:border-l xl:shadow-none',
            sheetOpen
              ? 'flex duration-200 animate-in fade-in-0 slide-in-from-bottom-4 md:slide-in-from-right-4 md:slide-in-from-bottom-0 xl:animate-none motion-reduce:animate-none'
              : 'hidden xl:flex',
          )}
        >
          <span
            aria-hidden
            className="mx-auto -mt-1 mb-1 h-1 w-10 shrink-0 rounded-full bg-white/20 md:hidden"
          />
          {/* Ключ — смена содержимого панели проигрывается мягким появлением. */}
          <div
            key={selected ? `el:${selected.id}` : view}
            className="flex flex-col gap-4 duration-200 animate-in fade-in-0 motion-reduce:animate-none"
          >
            {panel}
          </div>
        </aside>
      </form>

      {/* Публикация: кому видна сторис — рядом с «Опубликовать», а не в другом углу. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="min-w-0 flex-1">
          <FormAlert error={apiError} />
          {(contentError || elementsError) && (
            <FieldError>{contentError ? t('needContent') : t('elementsInvalid')}</FieldError>
          )}
        </div>
        <button
          type="button"
          onClick={() => openView('general')}
          className="flex h-9 min-w-0 items-center gap-2 rounded-lg bg-muted/60 px-3 text-sm transition-colors duration-150 hover:bg-muted motion-reduce:transition-none"
        >
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground max-sm:sr-only">{t('audienceShort')}</span>
          <span className="truncate font-medium">{audience ? audienceLabel(audience) : ''}</span>
        </button>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="text-white hover:bg-white/10 hover:text-white max-sm:hidden"
            onClick={close}
            disabled={busy}
          >
            {tCommon('cancel')}
          </Button>
        )}
        <Button
          type="submit"
          form={formId}
          size="md"
          loading={mutation.isPending}
          disabled={uploading}
        >
          <Plus className="size-4" aria-hidden />
          {t('publish')}
        </Button>
      </div>

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
