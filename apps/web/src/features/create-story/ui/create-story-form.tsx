'use client'

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  AtSign,
  BarChart3,
  CalendarDays,
  Clock,
  Crop,
  ImagePlus,
  Link2,
  Loader2,
  Maximize,
  Newspaper,
  Plus,
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
import { useAppSelector } from '../../../shared/store'
import { OPTIONAL_TEXT, useFormAlert } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  STORY_AUDIENCES_BY_ROLE,
  STORY_BACKGROUND_CLASS,
  STORY_FACULTY_PICKER_ROLES,
  STORY_GROUP_PICKER_ROLES,
  createStoryRequest,
  fitImageToStory,
  storyKeys,
  uploadStoryMedia,
} from '../../../entities/story'
import { GroupSelect } from '../../../entities/group'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import {
  Button,
  EmojiPicker,
  FieldError,
  FormAlert,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
import { CardPicker, type CardKind, type PickedCard } from './card-picker'
import { StoryCanvas, type CanvasMedia } from './story-canvas'
import { ElementInspector } from './element-inspector'
import { MentionPicker } from './mention-picker'

// Окно кадрирования тяжёлое (жесты, canvas) — грузится, только когда фото выбрано.
const ImageCropModal = dynamic(
  () => import('../../../shared/ui/image-crop-modal').then((m) => m.ImageCropModal),
  { ssr: false },
)

const MAX_POLL_OPTIONS = 4
const MIN_POLL_OPTIONS = 2
const MB = 1024 * 1024
// Кадр сторис: 9:16, ширина итогового снимка — как у телефона в портрете.
const STORY_ASPECT = 9 / 16
const STORY_OUTPUT_WIDTH = 1080
const MEDIA_ACCEPT = [...STORY_IMAGE_MIMES, ...STORY_VIDEO_MIMES].join(',')

interface PickedMedia extends CanvasMedia {
  id: string
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
 * Редактор сторис.
 *
 * Слева — кадр 9:16, каким его увидят: фон или медиа и элементы поверх (текст, эмодзи,
 * отметки), их двигают прямо на кадре. Справа — инструменты и свойства выбранного
 * элемента. Фото перед загрузкой либо кадрируется под 9:16, либо ставится целиком с
 * размытым фоном. Ссылка и опрос открываются кнопками и по умолчанию свёрнуты.
 */
export function CreateStoryForm({ onCreated }: { onCreated?: () => void } = {}) {
  const t = useTranslations('Stories')
  const tFeed = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const role = useAppSelector((s) => s.auth.role)
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const [media, setMedia] = useState<PickedMedia | null>(null)
  const [uploading, setUploading] = useState(false)
  const [elements, setElementsState] = useState<EditorElement[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [cardKind, setCardKind] = useState<CardKind | null>(null)
  // Фото выбрано — сначала спрашиваем, как его разместить; кадрирование — отдельным окном.
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  // Блок ссылки открыт — отдельное состояние, а не «linkUrl !== undefined»: пустое поле
  // уходит в форму как undefined (OPTIONAL_TEXT), и блок закрывался бы на стёртом адресе.
  const [linkOpen, setLinkOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const audiences = role ? (STORY_AUDIENCES_BY_ROLE[role] ?? []) : []

  const form = useForm<CreateStoryInput>({
    resolver: zodResolver(CreateStorySchema),
    defaultValues: { audience: audiences[0] },
  })
  const audience = form.watch('audience')
  const background = form.watch('background')
  const poll = form.watch('poll')

  const showGroupPicker =
    audience === 'GROUP' && role !== null && STORY_GROUP_PICKER_ROLES.includes(role)
  const showFacultyPicker =
    audience === 'FACULTY' && role !== null && STORY_FACULTY_PICKER_ROLES.includes(role)

  const faculties = useQuery({
    queryKey: facultyKeys.list(),
    queryFn: () => fetchFaculties(),
    enabled: showFacultyPicker,
  })

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
    mutationFn: (input: CreateStoryInput) => createStoryRequest(input),
    onMutate: () => resetApiError(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storyKeys.all })
      if (media) URL.revokeObjectURL(media.url)
      setMedia(null)
      setLinkOpen(false)
      setElementsState([])
      setSelectedId(null)
      form.reset({ audience: audiences[0] })
      toast.success(t('published'))
      onCreated?.()
    },
    onError: (e) => showApiError(e),
  })

  async function upload(file: File): Promise<void> {
    setUploading(true)
    try {
      const uploaded = await uploadStoryMedia(file)
      if (media) URL.revokeObjectURL(media.url)
      setMedia({
        id: uploaded.id,
        url: URL.createObjectURL(file),
        isVideo: file.type.startsWith('video/'),
      })
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
      await upload(file)
      return
    }
    setPendingImage(file)
  }

  async function placeWhole(file: File): Promise<void> {
    setPendingImage(null)
    setUploading(true)
    try {
      await upload(await fitImageToStory(file))
    } catch {
      setUploading(false)
      toast.error(tErr('INTERNAL_ERROR'))
    }
  }

  function dropMedia(): void {
    if (media) URL.revokeObjectURL(media.url)
    setMedia(null)
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

  const tool = 'shrink-0'
  const contentError = form.formState.errors.text
  const elementsError = form.formState.errors.elements

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
    >
      <FormAlert error={apiError} />

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="flex w-full max-w-[18rem] flex-col gap-1">
          <StoryCanvas
            media={media}
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
          <FieldError>
            {contentError ? t('needContent') : elementsError ? t('elementsInvalid') : null}
          </FieldError>
        </div>

        <div className="flex w-full min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
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
              className={tool}
              disabled={uploading}
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
          {!media && (
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs text-muted-foreground">{t('background')}</Label>
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
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1">
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
                className="sm:w-44"
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
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Controller
          control={form.control}
          name="audience"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger size="md" aria-label={tFeed('audience')} className="w-full sm:w-44">
                <SelectValue placeholder={tFeed('audience')} />
              </SelectTrigger>
              <SelectContent>
                {audiences.map((a) => (
                  <SelectItem key={a} value={a}>
                    {tFeed(`audience${a}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />

        {showGroupPicker && (
          // Поиск по группам на сервере, а не первые 100 по алфавиту.
          <div className="w-full sm:w-44">
            <Controller
              control={form.control}
              name="groupId"
              render={({ field }) => (
                <GroupSelect
                  value={field.value ?? null}
                  onChange={(v) => field.onChange(v ?? undefined)}
                  placeholder={tFeed('audienceGROUP')}
                  size="md"
                />
              )}
            />
          </div>
        )}

        {showFacultyPicker && (
          <Controller
            control={form.control}
            name="facultyId"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                <SelectTrigger
                  size="md"
                  aria-label={tFeed('audienceFACULTY')}
                  className="w-full sm:w-44"
                >
                  <SelectValue placeholder={tFeed('audienceFACULTY')} />
                </SelectTrigger>
                <SelectContent>
                  {(faculties.data ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}

        <Button type="submit" size="md" loading={mutation.isPending} disabled={uploading}>
          <Plus className="size-4" aria-hidden />
          {t('publish')}
        </Button>
      </div>

      {pendingImage && (
        <Modal onClose={() => setPendingImage(null)} title={t('fitTitle')} size="md">
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setCropFile(pendingImage)
                setPendingImage(null)
              }}
              className="flex flex-col items-start gap-1 rounded-xl border border-border p-3 text-left transition-colors duration-150 hover:border-ring/60 hover:bg-muted"
            >
              <Crop className="size-5 text-primary" aria-hidden />
              <span className="text-sm font-semibold">{t('fitCrop')}</span>
              <span className="text-xs text-muted-foreground">{t('fitCropHint')}</span>
            </button>
            <button
              type="button"
              onClick={() => void placeWhole(pendingImage)}
              className="flex flex-col items-start gap-1 rounded-xl border border-border p-3 text-left transition-colors duration-150 hover:border-ring/60 hover:bg-muted"
            >
              <Maximize className="size-5 text-primary" aria-hidden />
              <span className="text-sm font-semibold">{t('fitWhole')}</span>
              <span className="text-xs text-muted-foreground">{t('fitWholeHint')}</span>
            </button>
          </div>
        </Modal>
      )}

      {cropFile && (
        <ImageCropModal
          file={cropFile}
          saving={uploading}
          onCancel={() => setCropFile(null)}
          onSave={(cropped) => {
            setCropFile(null)
            void upload(cropped)
          }}
          title={t('cropTitle')}
          confirmLabel={t('cropConfirm')}
          shape="square"
          aspect={STORY_ASPECT}
          outputWidth={STORY_OUTPUT_WIDTH}
        />
      )}

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
    </form>
  )
}
