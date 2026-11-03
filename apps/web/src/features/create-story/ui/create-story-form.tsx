'use client'

import { useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  AtSign,
  BarChart3,
  CalendarDays,
  Clock,
  ImagePlus,
  Link2,
  Loader2,
  Newspaper,
  Plus,
  Shrink,
  Smile,
  Type,
  X,
} from 'lucide-react'
import {
  CreateStorySchema,
  STORY_BACKGROUNDS,
  STORY_CARDS_MAX,
  STORY_ELEMENTS_MAX,
  STORY_IMAGE_MIMES,
  STORY_MEDIA_DEFAULTS,
  STORY_MENTIONS_MAX,
  STORY_VIDEO_MIMES,
  type CreateStoryInput,
} from '@studenthub/shared-schemas'
import { OPTIONAL_TEXT, useFormAlert } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  STORY_BACKGROUND_CLASS,
  createStoryRequest,
  storyKeys,
  uploadStoryMedia,
} from '../../../entities/story'
import {
  Button,
  CROP_TOOL_BUTTON,
  CropToolbar,
  EmojiPicker,
  FieldError,
  FormAlert,
  Input,
  Label,
  MediaEditorShell,
  Modal,
} from '../../../shared/ui'
import {
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
import { useStoryStage } from '../model/use-story-stage'
import { CardPicker, type CardKind, type PickedCard } from './card-picker'
import { StoryCanvas } from './story-canvas'
import { ElementInspector } from './element-inspector'
import { MentionPicker } from './mention-picker'
import { StoryAudienceFields, useStoryAudiences, type StoryAudienceState } from './audience-fields'
import type { StoryRecipient } from './recipients-picker'

const MAX_POLL_OPTIONS = 4
const MIN_POLL_OPTIONS = 2
const MB = 1024 * 1024
const MEDIA_ACCEPT = [...STORY_IMAGE_MIMES, ...STORY_VIDEO_MIMES].join(',')
// Фото выбрано, но ещё не загружено: кадр собирается и уходит на сервер только при
// публикации. Метка нужна схеме — «сторис с медиа» — и подменяется настоящим id файла.
const LOCAL_PHOTO = 'local-photo'

interface UploadedVideo {
  id: string
  /** Локальный object-URL для превью: подписанную ссылку сервер отдаст уже в ленте. */
  url: string
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

/**
 * Редактор сторис на весь экран, в оформлении окна кадрирования фото.
 *
 * По центру — кадр 9:16, каким его увидят: фон или медиа и элементы поверх (текст, эмодзи,
 * отметки), их двигают прямо на кадре. Фото кадрируется тут же: его двигают, приближают
 * колесом или щипком, а снизу — поворот, линейка угла, отражение и «целиком с фоном».
 * Слева — инструменты и свойства выбранного элемента; ссылка и опрос открываются кнопками
 * и по умолчанию свёрнуты. Внизу — аудитория и публикация.
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
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const [photo, setPhoto] = useState<File | null>(null)
  const [video, setVideo] = useState<UploadedVideo | null>(null)
  const [uploading, setUploading] = useState(false)
  const stage = useStoryStage(photo)
  const [elements, setElementsState] = useState<EditorElement[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [cardKind, setCardKind] = useState<CardKind | null>(null)
  // Блок ссылки открыт — отдельное состояние, а не «linkUrl !== undefined»: пустое поле
  // уходит в форму как undefined (OPTIONAL_TEXT), и блок закрывался бы на стёртом адресе.
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
  const background = form.watch('background')
  const poll = form.watch('poll')

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
  const full = elements.length >= STORY_ELEMENTS_MAX
  const cardsFull = elements.filter(isCard).length >= STORY_CARDS_MAX
  const mentionCount = new Set(elements.flatMap((e) => (e.type === 'mention' ? [e.userId] : [])))
    .size

  // Элементы живут в состоянии редактора, а в форму уходят готовыми к запросу: схема
  // проверяет их вместе с остальным (содержимое, число отметок).
  function setElements(next: EditorElement[]): void {
    setElementsState(next)
    form.setValue('elements', next.length > 0 ? toStoryElements(next) : undefined, {
      shouldValidate: form.formState.isSubmitted,
    })
  }

  function addElement(element: EditorElement): void {
    if (full) return
    setElements([...elements, element])
    setSelectedId(element.id)
  }

  function addCard(card: PickedCard): void {
    if (card.kind === 'event') addElement(newEventElement(card.event))
    else if (card.kind === 'post') addElement(newPostElement(card.post))
    else addElement(newScheduleElement(card.pair, card.date))
    setCardKind(null)
  }

  function patchElement(id: string, patch: Partial<EditorElement>): void {
    setElements(elements.map((e) => (e.id === id ? ({ ...e, ...patch } as EditorElement) : e)))
  }

  function removeElement(id: string): void {
    setElements(elements.filter((e) => e.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

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
      setElementsState([])
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
      // Фон — свойство текстовой сторис: с медиа его не видно, а схема такую пару отвергает.
      form.setValue('background', undefined)
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
    form.setValue('background', undefined)
  }

  function dropMedia(): void {
    if (video) URL.revokeObjectURL(video.url)
    setVideo(null)
    setPhoto(null)
    form.setValue('fileId', undefined)
  }

  function toggleLink(): void {
    if (linkOpen) {
      form.setValue('linkUrl', undefined)
      form.setValue('linkLabel', undefined)
    }
    setLinkOpen(!linkOpen)
  }

  function togglePoll(): void {
    form.setValue('poll', poll ? undefined : { question: '', options: ['', ''] })
  }

  function setOption(index: number, value: string): void {
    const options = [...(poll?.options ?? [])]
    options[index] = value
    form.setValue(`poll.options`, options, { shouldValidate: false })
  }

  function addOption(): void {
    const options = [...(poll?.options ?? [])]
    if (options.length >= MAX_POLL_OPTIONS) return
    form.setValue(`poll.options`, [...options, ''])
  }

  function removeOption(index: number): void {
    const options = (poll?.options ?? []).filter((_, i) => i !== index)
    if (options.length < MIN_POLL_OPTIONS) return
    form.setValue(`poll.options`, options)
  }

  if (audiences.length === 0) return null

  // Инструменты: на телефоне — лента с прокруткой вбок, на широком экране — колонка слева.
  const tool = 'shrink-0 md:w-full md:justify-start'
  const contentError = form.formState.errors.text
  const elementsError = form.formState.errors.elements
  const busy = uploading || mutation.isPending

  // Пока фото или видео уходит на сервер, редактор не закрывается — иначе публикация
  // продолжилась бы без окна, а ошибку некому было бы показать.
  function close(): void {
    if (busy) return
    onClose?.()
  }

  return (
    <MediaEditorShell
      title={t('newStory')}
      hint={photo ? t('photoHint') : undefined}
      onClose={close}
      footer={
        <>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <StoryAudienceFields
              value={{
                audience,
                groupId: form.watch('groupId'),
                facultyId: form.watch('facultyId'),
                recipients,
              }}
              onChange={setAudience}
              recipientsError={form.formState.errors.userIds ? t('recipientsNeed') : undefined}
            />
          </div>
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
        </>
      }
    >
      <form
        id={formId}
        className="flex min-h-0 flex-1 flex-col md:flex-row"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <StoryCanvas
            stage={stage}
            hasPhoto={photo !== null}
            videoUrl={video?.url ?? null}
            background={background}
            elements={elements}
            selectedId={selectedId}
            uploading={uploading}
            onSelect={setSelectedId}
            onMove={(id, x, y) => patchElement(id, { x, y })}
            onRemove={removeElement}
            onRemoveMedia={dropMedia}
            onDropFile={(file) => void pickFile(file)}
          />

          {/* Кадрирование фото: поворот · линейка угла · отражение · целиком с фоном */}
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
            >
              <button
                type="button"
                aria-label={t('fitWhole')}
                title={t('fitWhole')}
                aria-pressed={stage.whole}
                onClick={stage.toggleWhole}
                disabled={!stage.ready}
                className={cn(
                  CROP_TOOL_BUTTON,
                  stage.whole ? 'text-primary' : 'text-white/80 hover:text-white',
                )}
              >
                <Shrink className="size-5" aria-hidden />
              </button>
            </CropToolbar>
          )}
        </div>

        <aside
          aria-label={t('tools')}
          className="flex max-h-[38dvh] shrink-0 flex-col gap-3 overflow-y-auto border-t border-white/10 px-4 py-3 select-text md:order-first md:max-h-none md:w-72 md:border-t-0 md:border-r lg:w-80"
        >
          <FormAlert error={apiError} />
          {(contentError || elementsError) && (
            <FieldError>{contentError ? t('needContent') : t('elementsInvalid')}</FieldError>
          )}

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0">
            <input
              ref={fileRef}
              type="file"
              accept={MEDIA_ACCEPT}
              className="hidden"
              onChange={(e) => void pickFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="md"
              className={cn(tool, 'md:col-span-2')}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="size-4" aria-hidden />
              )}
              {t('media')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              className={tool}
              disabled={full}
              onClick={() => addElement(newTextElement(t('textDefault')))}
            >
              <Type className="size-4" aria-hidden />
              {t('toolText')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              className={tool}
              disabled={full}
              onClick={() => setEmojiOpen(true)}
            >
              <Smile className="size-4" aria-hidden />
              {t('toolEmoji')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              className={tool}
              disabled={full || mentionCount >= STORY_MENTIONS_MAX}
              onClick={() => setMentionOpen(true)}
            >
              <AtSign className="size-4" aria-hidden />
              {t('toolMention')}
            </Button>
            {(
              [
                ['event', CalendarDays, 'toolEvent'],
                ['post', Newspaper, 'toolPost'],
                ['schedule', Clock, 'toolPair'],
              ] as const
            ).map(([kind, Icon, label]) => (
              <Button
                key={kind}
                type="button"
                variant="outline"
                size="md"
                className={tool}
                disabled={full || cardsFull}
                onClick={() => setCardKind(kind)}
              >
                <Icon className="size-4" aria-hidden />
                {t(label)}
              </Button>
            ))}
            <Button
              type="button"
              variant={linkOpen ? 'secondary' : 'outline'}
              size="md"
              className={tool}
              aria-pressed={linkOpen}
              onClick={toggleLink}
            >
              <Link2 className="size-4" aria-hidden />
              {t('addLink')}
            </Button>
            <Button
              type="button"
              variant={poll ? 'secondary' : 'outline'}
              size="md"
              className={tool}
              aria-pressed={!!poll}
              onClick={togglePoll}
            >
              <BarChart3 className="size-4" aria-hidden />
              {t('addPoll')}
            </Button>
          </div>

          {/* Фон выбирается только у сторис без медиа — поверх фото он не виден. */}
          {!photo && !video && (
            <div className="flex flex-wrap items-center gap-2">
              <Label className="w-full text-xs text-muted-foreground">{t('background')}</Label>
              {STORY_BACKGROUNDS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={t('background')}
                  aria-pressed={background === key}
                  onClick={() => form.setValue('background', key)}
                  className={cn(
                    'size-7 rounded-full ring-offset-2 ring-offset-background',
                    STORY_BACKGROUND_CLASS[key],
                    background === key && 'ring-2 ring-primary',
                  )}
                />
              ))}
            </div>
          )}

          {selected ? (
            <ElementInspector
              element={selected}
              onChange={(patch) => patchElement(selected.id, patch)}
              onRemove={() => removeElement(selected.id)}
            />
          ) : (
            elements.length > 0 && (
              <p className="text-xs text-muted-foreground">{t('selectElementHint')}</p>
            )
          )}

          {linkOpen && (
            <div className="flex flex-col gap-2">
              <div>
                <Input
                  {...form.register('linkUrl', OPTIONAL_TEXT)}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  aria-label={t('linkUrl')}
                />
                <FieldError>{form.formState.errors.linkUrl && t('badLink')}</FieldError>
              </div>
              <Input
                {...form.register('linkLabel', OPTIONAL_TEXT)}
                placeholder={t('linkLabel')}
                aria-label={t('linkLabel')}
              />
            </div>
          )}

          {poll && (
            <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <Input
                {...form.register('poll.question')}
                placeholder={t('pollQuestion')}
                aria-label={t('pollQuestion')}
              />
              {poll.options.map((option, index) => (
                // Варианты опроса — строки без id, порядок меняется только удалением.
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={option}
                    onChange={(e) => setOption(index, e.target.value)}
                    placeholder={t('pollOption', { n: index + 1 })}
                    aria-label={t('pollOption', { n: index + 1 })}
                  />
                  {poll.options.length > MIN_POLL_OPTIONS && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="md"
                      icon
                      aria-label={t('removeOption')}
                      onClick={() => removeOption(index)}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              ))}
              {poll.options.length < MAX_POLL_OPTIONS && (
                <Button type="button" variant="ghost" size="sm" onClick={addOption}>
                  <Plus className="size-4" aria-hidden />
                  {t('addOption')}
                </Button>
              )}
              <FieldError>{form.formState.errors.poll && t('pollIncomplete')}</FieldError>
            </div>
          )}
        </aside>
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
        <CardPicker kind={cardKind} onPick={addCard} onClose={() => setCardKind(null)} />
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
