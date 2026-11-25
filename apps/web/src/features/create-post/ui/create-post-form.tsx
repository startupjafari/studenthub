'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { ImagePlus, Smile } from 'lucide-react'
import { CreatePostSchema, type CreatePostInput } from '@studenthub/shared-schemas'
import { useAppSelector } from '../../../shared/store'
import {
  OPTIONAL_TEXT,
  contentDraftKey,
  readContentDraft,
  removeContentDraft,
  useFormAlert,
  useLocalDraft,
  type LocalDraftStatus,
} from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  AUDIENCES_BY_ROLE,
  FACULTY_PICKER_ROLES,
  type PostAudienceValue,
  GROUP_PICKER_ROLES,
  createPostRequest,
  postKeys,
} from '../../../entities/post'
import { GroupSelect } from '../../../entities/group'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import { UserPicker, type PickedUser } from '../../../entities/user'
import { MentionSuggest, mentionQuery, type MentionSuggestHandle } from '../../../entities/search'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  EmojiPicker,
  FieldError,
  FormAlert,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RichTextField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type RichTextHandle,
} from '../../../shared/ui'
import { useMediaUploads } from '../model/use-media-uploads'
import { MAX_POST_MEDIA, isPostMediaFile, type RejectReason } from '../model/media-queue'
import { AudiencePicker } from './audience-picker'
import { ComposerMediaStrip, MEDIA_REORDER_TYPE } from './composer-media-strip'
import { PublishSettings, ScheduledChip, TOOL_BUTTON } from './publish-settings'

// Пост от имени университета — всегда весь вуз; так публикует и модератор вуза, у которого
// личных аудиторий нет вовсе (AUDIENCES_BY_ROLE).
const UNIVERSITY_PAGE_AUDIENCES: PostAudienceValue[] = ['UNIVERSITY']
/** Лимит текста поста (CreatePostSchema). Счётчик появляется на подходе к нему. */
const CONTENT_MAX = 5000
const COUNTER_FROM = CONTENT_MAX - 500

interface PostDraft {
  title: string
  content: string
  audience?: PostAudienceValue
}

/** Состояние редактора для окна вокруг него: закрывать ли без вопроса. */
export interface ComposerState {
  /** Есть то, что пропадёт при закрытии: загружаемые или упавшие вложения, несохранённый черновик. */
  unsaved: boolean
}

export interface CreatePostFormProps {
  /** После успешной публикации (закрыть окно). */
  onCreated?: () => void
  /** От имени университета — со страницы вуза (админ или модератор). */
  asUniversity?: boolean
  onStateChange?: (state: ComposerState) => void
  /** Автор в шапке, если пишут не от своего имени (страница вуза). */
  author?: { name: string; avatarUrl: string | null }
}

/**
 * Редактор публикации — как в Threads: сверху автор и кому уходит пост, ниже заголовок и
 * текст без рамок «формы», под текстом вложения, внизу — тихие инструменты и одно главное
 * действие. Набранное сохраняется в черновик на устройстве на каждую паузу (переживает
 * закрытие окна и перезагрузку вкладки) и стирается после публикации.
 *
 * Вложения грузятся каждое само по себе (прогресс, отмена, повтор) и уходят в том порядке,
 * в каком стоят в ленте превью: сервер хранит именно его (PROJECT.md, «Медиа»).
 */
export function CreatePostForm({
  onCreated,
  asUniversity = false,
  onStateChange,
  author,
}: CreatePostFormProps) {
  const t = useTranslations('Feed')
  const tPeople = useTranslations('People')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const role = useAppSelector((s) => s.auth.role)
  const me = useAppSelector((s) => s.auth.user)
  const fileRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<RichTextHandle | null>(null)
  const mentionRef = useRef<MentionSuggestHandle>(null)
  const [dragging, setDragging] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mention, setMention] = useState<string | null>(null)
  // Отложенная публикация: значение datetime-local (пусто — опубликовать сразу).
  const [scheduleAt, setScheduleAt] = useState('')
  const [target, setTarget] = useState<PickedUser | null>(null)

  const audiences = useMemo(
    () => (asUniversity ? UNIVERSITY_PAGE_AUDIENCES : role ? (AUDIENCES_BY_ROLE[role] ?? []) : []),
    [asUniversity, role],
  )

  // Черновик — на пользователя и место: пост от имени вуза не смешивается с личным.
  const draftKey = me ? contentDraftKey(me.id, asUniversity ? 'post:university' : 'post:new') : null
  const [restored] = useState(() => (draftKey ? readContentDraft<PostDraft>(draftKey) : null))
  const [restoredShown, setRestoredShown] = useState(restored !== null)

  const form = useForm<CreatePostInput>({
    resolver: zodResolver(CreatePostSchema),
    defaultValues: {
      audience: restored?.value.audience ?? audiences[0],
      content: restored?.value.content ?? '',
      title: restored?.value.title ?? '',
    },
  })
  const audience = form.watch('audience')
  const title = form.watch('title') ?? ''
  const content = form.watch('content') ?? ''

  // Роль приезжает из Redux после восстановления сессии, а useForm фиксирует defaultValues один
  // раз при монтировании. На холодной загрузке страницы форма успевает создаться с role === null,
  // аудитория остаётся пустой — и «Опубликовать» молча не отправляет запрос (zod требует
  // audience). Поэтому доставляем значение по умолчанию, когда роль стала известна. Аудитория
  // из черновика, которой у роли больше нет, заменяется первой разрешённой.
  useEffect(() => {
    const current = form.getValues('audience')
    if ((!current || !audiences.includes(current)) && audiences[0]) {
      form.setValue('audience', audiences[0], { shouldValidate: false })
    }
  }, [audiences, form])

  const onReject = useCallback(
    (reasons: Set<RejectReason>) => {
      if (reasons.has('type')) toast.error(t('mediaTypeRejected'))
      if (reasons.has('size')) toast.error(tErr('FILE_TOO_LARGE'))
      if (reasons.has('limit')) toast.error(t('mediaLimitCount', { max: MAX_POST_MEDIA }))
    },
    [t, tErr],
  )
  const media = useMediaUploads(onReject)

  const isEmpty = !title.trim() && !content.trim()
  const draftStatus = useLocalDraft<PostDraft>(
    draftKey,
    { title, content, audience },
    { empty: isEmpty },
  )

  const showGroupPicker = audience === 'GROUP' && role !== null && GROUP_PICKER_ROLES.includes(role)
  const showFacultyPicker =
    audience === 'FACULTY' && role !== null && FACULTY_PICKER_ROLES.includes(role)
  const showSubject = audience === 'SUBJECT'
  const showPersonal = audience === 'PERSONAL'
  const showScope = showGroupPicker || showFacultyPicker || showSubject || showPersonal

  const faculties = useQuery({
    queryKey: facultyKeys.list(),
    queryFn: () => fetchFaculties(),
    enabled: showFacultyPicker,
  })

  const mutation = useMutation({
    mutationFn: (input: CreatePostInput) =>
      createPostRequest({
        ...input,
        // Порядок — ровно как в ленте превью: сервер сохранит его (File.order).
        mediaIds: media.readyIds,
        targetUserId: target?.id,
        ...(asUniversity ? { asUniversity: true } : {}),
      }),
    onMutate: () => resetApiError(),
    onSuccess: (created, variables) => {
      void qc.invalidateQueries({ queryKey: postKeys.all })
      if (draftKey) removeContentDraft(draftKey)
      form.reset({ audience: audiences[0], content: '', title: '' })
      media.clear()
      setTarget(null)
      setScheduleAt('')
      setRestoredShown(false)
      // Тост — по тому, что сделал сервер, а не по тому, что просили: время, успевшее
      // пройти, пока форма была открыта, сервер публикует сразу.
      toast.success(
        variables.status === 'DRAFT'
          ? t('draftSaved')
          : created.status === 'SCHEDULED'
            ? t('scheduledOk')
            : t('published'),
      )
      onCreated?.()
    },
    // Текст и вложения остаются в форме: ошибку можно исправить и отправить снова.
    onError: (e) => showApiError(e),
  })

  // Окно вокруг спрашивает подтверждение, только когда закрытие что-то потеряет: текст
  // и так лежит в черновике, а вложения туда не попадают.
  const unsaved = media.items.length > 0 || draftStatus === 'error' || draftStatus === 'pending'
  useEffect(() => onStateChange?.({ unsaved }), [unsaved, onStateChange])

  const blocked = media.uploading || media.failed || mutation.isPending
  const submit = (status: 'DRAFT' | 'PUBLISHED') =>
    form.handleSubmit((v) => {
      // Пока файл грузится или упал, его id нет в списке: пост ушёл бы без него.
      if (media.uploading || media.failed) return
      // Отложить можно только в будущее: прошедшее время сервер понял бы как «опубликовать
      // сейчас», а человек нажимал «Запланировать».
      if (status === 'PUBLISHED' && scheduleAt && new Date(scheduleAt).getTime() <= Date.now()) {
        toast.error(t('schedulePast'))
        setSettingsOpen(true)
        return
      }
      setSettingsOpen(false)
      mutation.mutate({
        ...v,
        status,
        scheduledAt: status === 'PUBLISHED' && scheduleAt ? new Date(scheduleAt) : null,
      })
    })

  function addFiles(list: FileList | File[] | null | undefined): void {
    if (!list || list.length === 0) return
    media.add(Array.from(list))
  }

  function onDragOver(e: DragEvent<HTMLFormElement>): void {
    // Перестановку превью обрабатывает сама лента: подсветка — только для файлов снаружи.
    if (
      !e.dataTransfer.types.includes('Files') ||
      e.dataTransfer.types.includes(MEDIA_REORDER_TYPE)
    )
      return
    e.preventDefault()
    if (media.items.length < MAX_POST_MEDIA) setDragging(true)
  }

  // Упоминание: что набрано после «@» перед курсором в поле текста.
  function syncMention(): void {
    const before = editorRef.current?.textBefore() ?? ''
    setMention(mentionQuery(before, before.length))
  }

  if (audiences.length === 0) return null

  const name = author?.name ?? (me ? `${me.lastName} ${me.firstName}` : '')
  const avatarUrl = author ? author.avatarUrl : (me?.avatarUrl ?? null)
  const canPublish = content.trim().length > 0 && !blocked
  const mediaFull = media.items.length >= MAX_POST_MEDIA

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit('PUBLISHED')()
      }}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        // dragleave всплывает и при переходе между вложенными узлами — гасим подсветку,
        // только когда курсор действительно ушёл из формы.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(false)
        addFiles(e.dataTransfer.files)
      }}
      // Вставка снимка из буфера (Ctrl/Cmd+V) — вложением, а не картинкой внутри текста.
      // Перехват на всплытии вниз (capture): иначе вставку первым забрал бы редактор.
      onPasteCapture={(e) => {
        const files = Array.from(e.clipboardData.files).filter(isPostMediaFile)
        if (files.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        addFiles(files)
      }}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-4 pb-3 sm:px-5">
        <FormAlert error={apiError} />

        {/* Автор и аудитория — кто пишет и кому. */}
        <div className="flex items-center gap-3">
          <Avatar className="size-10 shrink-0">
            {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
            <AvatarFallback className="text-xs">
              {name
                .split(' ')
                .map((p) => p[0] ?? '')
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
            <span className="max-w-full truncate text-sm leading-tight font-semibold">{name}</span>
            <Controller
              control={form.control}
              name="audience"
              render={({ field }) => (
                <AudiencePicker value={field.value} options={audiences} onChange={field.onChange} />
              )}
            />
          </div>
        </div>

        {/* Уточнение адресата — только для тех аудиторий, где оно нужно. */}
        {showScope && (
          <div className="grid gap-3 sm:grid-cols-2">
            {showGroupPicker && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="post-group" className="text-xs">
                  {t('group')}
                </Label>
                <Controller
                  control={form.control}
                  name="groupId"
                  render={({ field }) => (
                    <GroupSelect
                      id="post-group"
                      value={field.value ?? null}
                      onChange={(v) => field.onChange(v ?? undefined)}
                      placeholder={t('selectGroup')}
                    />
                  )}
                />
              </div>
            )}
            {showFacultyPicker && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t('faculty')}</Label>
                <Controller
                  control={form.control}
                  name="facultyId"
                  render={({ field }) => (
                    <Select value={field.value ?? ''} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t('selectFaculty')} />
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
              </div>
            )}
            {showSubject && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="post-subject" className="text-xs">
                  {t('subject')}
                </Label>
                <Input id="post-subject" {...form.register('subject')} />
              </div>
            )}
            {showPersonal && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{tPeople('pickUser')}</Label>
                <UserPicker value={target} onSelect={setTarget} />
              </div>
            )}
          </div>
        )}

        {/* Заголовок и текст — без рамок «формы»: читаются как начало документа. */}
        <div className="relative flex flex-col">
          <Input
            id="post-title"
            aria-label={t('titleLabel')}
            placeholder={t('titleOptional')}
            maxLength={200}
            className="h-auto rounded-none border-transparent bg-transparent px-0 py-1 text-lg font-semibold shadow-none hover:border-transparent focus-visible:border-transparent focus-visible:ring-0 md:text-lg dark:bg-transparent"
            {...form.register('title', OPTIONAL_TEXT)}
          />
          <Controller
            control={form.control}
            name="content"
            render={({ field }) => (
              <RichTextField
                id="post-content"
                aria-label={t('contentLabel')}
                value={field.value ?? ''}
                onChange={(v) => {
                  field.onChange(v)
                  syncMention()
                }}
                placeholder={t('placeholder')}
                bare
                handle={editorRef}
                onKeyDown={(e) => {
                  if (mentionRef.current?.handleKey(e.key)) return true
                  // Ctrl/Cmd+Enter — опубликовать, как в Threads и почте.
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    void submit('PUBLISHED')()
                    return true
                  }
                  return false
                }}
                // Поле растёт под текст до половины экрана, дальше — своя прокрутка.
                className="max-h-[45dvh] min-h-24 overflow-y-auto px-0 text-[0.9375rem]"
              />
            )}
          />
          <MentionSuggest
            query={mention}
            handle={mentionRef}
            className="top-full bottom-auto mt-1 mb-0"
            onPick={(login) => {
              editorRef.current?.insertText(`@${login} `, (mention?.length ?? 0) + 1)
              setMention(null)
            }}
          />
        </div>
        <FieldError>{form.formState.errors.content && t('contentRequired')}</FieldError>

        {media.items.length > 0 && (
          <ComposerMediaStrip
            items={media.items}
            onRemove={media.remove}
            onRetry={media.retry}
            onMove={media.move}
          />
        )}
        {media.failed && <p className="text-xs text-destructive">{t('mediaFailedHint')}</p>}

        {scheduleAt && (
          <ScheduledChip
            scheduleAt={scheduleAt}
            onEdit={() => setSettingsOpen(true)}
            onClear={() => setScheduleAt('')}
          />
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {/* Подвал: тихие инструменты слева, состояние черновика и главное действие справа. */}
      <div className="flex shrink-0 items-center gap-1 border-t border-border px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-3">
        <button
          type="button"
          aria-label={t('addMedia')}
          title={t('addMedia')}
          disabled={mediaFull}
          onClick={() => fileRef.current?.click()}
          className={TOOL_BUTTON}
        >
          <ImagePlus className="size-5" aria-hidden />
        </button>
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t('emoji')}
              title={t('emoji')}
              className={cn(TOOL_BUTTON, emojiOpen && 'bg-muted text-foreground')}
            >
              <Smile className="size-5" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" className="border-0 bg-transparent shadow-none">
            <EmojiPicker
              onPick={(emoji) => {
                editorRef.current?.insertText(emoji)
                editorRef.current?.focus()
              }}
            />
          </PopoverContent>
        </Popover>
        <PublishSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          scheduleAt={scheduleAt}
          onScheduleChange={setScheduleAt}
          onSaveDraft={() => void submit('DRAFT')()}
          disabled={!canPublish}
          savingDraft={mutation.isPending && mutation.variables?.status === 'DRAFT'}
        />

        <div className="ml-auto flex min-w-0 items-center gap-3">
          <ComposerStatus
            status={draftStatus}
            restored={restoredShown && !isEmpty}
            length={content.length}
            onDiscard={() => {
              if (draftKey) removeContentDraft(draftKey)
              form.reset({ audience: form.getValues('audience'), content: '', title: '' })
              setRestoredShown(false)
            }}
          />
          <Button
            type="submit"
            loading={mutation.isPending && mutation.variables?.status !== 'DRAFT'}
            disabled={!canPublish}
            className="h-10 shrink-0 rounded-full px-5"
          >
            {scheduleAt ? t('schedule') : t('publish')}
          </Button>
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary">
          {t('dropFiles')}
        </div>
      )}
    </form>
  )
}

/**
 * Состояние черновика рядом с кнопкой: «Сохранение…», «Черновик сохранён», ошибка или
 * «Восстановлен черновик · Очистить». На подходе к лимиту — счётчик символов.
 */
function ComposerStatus({
  status,
  restored,
  length,
  onDiscard,
}: {
  status: LocalDraftStatus
  restored: boolean
  length: number
  onDiscard: () => void
}) {
  const t = useTranslations('Feed')
  if (length >= COUNTER_FROM) {
    return (
      <span
        className={cn(
          'text-xs tabular-nums',
          length > CONTENT_MAX ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {CONTENT_MAX - length}
      </span>
    )
  }
  let text: string | null = null
  if (status === 'pending') text = t('draftSaving')
  else if (status === 'error') text = t('draftSaveFailed')
  else if (status === 'saved') text = t('draftSavedLocal')
  if (restored && status === 'idle') {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="truncate">{t('draftRestored')}</span>
        <button
          type="button"
          onClick={onDiscard}
          className="shrink-0 cursor-pointer font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {t('draftDiscard')}
        </button>
      </span>
    )
  }
  if (!text) return null
  return (
    <span
      aria-live="polite"
      className={cn(
        'truncate text-xs max-[380px]:hidden',
        status === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {text}
    </span>
  )
}
