'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight, Clock, ImagePlus, Loader2, Play, X } from 'lucide-react'
import { CreatePostSchema, type CreatePostInput } from '@studenthub/shared-schemas'
import { useAppSelector } from '../../../shared/store'
import { OPTIONAL_TEXT, useFormAlert } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { uploadFileRequest } from '../../../shared/api'
import {
  AUDIENCES_BY_ROLE,
  FACULTY_PICKER_ROLES,
  GROUP_PICKER_ROLES,
  createPostRequest,
  postKeys,
} from '../../../entities/post'
import { fetchGroups, groupKeys } from '../../../entities/group'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import { UserPicker, type PickedUser } from '../../../entities/user'
import {
  Button,
  Card,
  CardContent,
  DateTimePicker,
  FormAlert,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  MarkdownEditor,
} from '../../../shared/ui'

interface UploadedMedia {
  id: string
  url: string // локальный object-URL для превью
  isVideo: boolean
}
const MAX_MEDIA = 10

// onCreated — необязательный колбэк после успешной публикации (например, закрыть модалку в профиле).
// bare — без обёртки Card (когда форма уже внутри модалки/карточки).
//
// Раскладка компактная, как в мессенджерах: заголовок и текст — один блок без
// внутренних рамок, панель форматирования всплывает над выделением, вложения
// добавляются иконкой и ложатся лентой под текстом.
// Постоянно видимая дропзона и панель кнопок отъедали высоту у того, ради чего
// окно открывают, — у самого текста.
export function CreatePostForm({
  onCreated,
  bare,
}: { onCreated?: () => void; bare?: boolean } = {}) {
  const t = useTranslations('Feed')
  const tCommon = useTranslations('Common')
  const tPeople = useTranslations('People')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const role = useAppSelector((s) => s.auth.role)
  const [media, setMedia] = useState<UploadedMedia[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  // Стрелки показываем по факту: лента короче ширины блока — листать нечего.
  const [strip, setStrip] = useState({ left: false, right: false })
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [dragging, setDragging] = useState(false)

  const audiences = role ? (AUDIENCES_BY_ROLE[role] ?? []) : []

  const form = useForm<CreatePostInput>({
    resolver: zodResolver(CreatePostSchema),
    defaultValues: { audience: audiences[0], content: '', title: '' },
  })
  const audience = form.watch('audience')

  // Роль приезжает из Redux после восстановления сессии, а useForm фиксирует defaultValues один
  // раз при монтировании. На холодной загрузке страницы форма успевает создаться с role === null,
  // аудитория остаётся пустой — и «Опубликовать» молча не отправляет запрос (zod требует
  // audience). Поэтому доставляем значение по умолчанию, когда роль стала известна.
  useEffect(() => {
    if (!form.getValues('audience') && audiences[0]) {
      form.setValue('audience', audiences[0], { shouldValidate: false })
    }
  }, [audiences, form])

  // Лента изменилась (добавили или убрали превью) — пересчитываем доступность стрелок.
  // Логика продублирована с syncStrip намеренно: вынесенная функция попала бы в
  // зависимости эффекта и пересоздавалась бы на каждый рендер.
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setStrip({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 })
  }, [media.length, uploading])

  const showGroupPicker = audience === 'GROUP' && role !== null && GROUP_PICKER_ROLES.includes(role)
  const showFacultyPicker =
    audience === 'FACULTY' && role !== null && FACULTY_PICKER_ROLES.includes(role)
  const showSubject = audience === 'SUBJECT'
  const showPersonal = audience === 'PERSONAL'
  const showScope = showGroupPicker || showFacultyPicker || showSubject || showPersonal
  const [target, setTarget] = useState<PickedUser | null>(null)

  const groups = useQuery({
    queryKey: groupKeys.list(),
    queryFn: () => fetchGroups(),
    enabled: showGroupPicker,
  })
  const faculties = useQuery({
    queryKey: facultyKeys.list(),
    queryFn: () => fetchFaculties(),
    enabled: showFacultyPicker,
  })

  const mutation = useMutation({
    mutationFn: (input: CreatePostInput) =>
      createPostRequest({ ...input, mediaIds: media.map((m) => m.id), targetUserId: target?.id }),
    onMutate: () => resetApiError(),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: postKeys.all })
      form.reset({ audience: audiences[0], content: '', title: '' })
      media.forEach((m) => URL.revokeObjectURL(m.url))
      setMedia([])
      setTarget(null)
      setScheduleAt('')
      setScheduleOpen(false)
      toast.success(
        variables.status === 'DRAFT'
          ? t('draftSaved')
          : variables.scheduledAt
            ? t('scheduledOk')
            : t('published'),
      )
      onCreated?.()
    },
    onError: (e) => showApiError(e),
  })

  // Отложенная публикация: значение datetime-local (пусто — опубликовать сразу).
  const [scheduleAt, setScheduleAt] = useState('')
  const submit = (status: 'DRAFT' | 'PUBLISHED') =>
    form.handleSubmit((v) =>
      mutation.mutate({
        ...v,
        status,
        scheduledAt: status === 'PUBLISHED' && scheduleAt ? new Date(scheduleAt) : null,
      }),
    )

  // Загрузка фото/видео: object-URL для превью + upload в бакет постов.
  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return
    const list = Array.from(files).slice(0, MAX_MEDIA - media.length)
    setUploading(true)
    for (const file of list) {
      const isVideo = file.type.startsWith('video/')
      try {
        const f = await uploadFileRequest('POSTS', file)
        setMedia((prev) => [...prev, { id: f.id, url: URL.createObjectURL(file), isVideo }])
      } catch (e) {
        toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
      }
    }
    setUploading(false)
  }
  function removeMedia(id: string): void {
    setMedia((prev) => {
      const m = prev.find((x) => x.id === id)
      if (m) URL.revokeObjectURL(m.url)
      return prev.filter((x) => x.id !== id)
    })
  }

  function syncStrip(): void {
    const el = stripRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    // Допуск в пару пикселей: дробные ширины дают остаток и на краю ленты.
    setStrip({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 })
  }
  function scrollStrip(dir: 1 | -1): void {
    const el = stripRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.8), behavior: 'smooth' })
  }

  if (audiences.length === 0) return null

  const mediaFull = media.length >= MAX_MEDIA

  const body = (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit('PUBLISHED')()
      }}
      className="flex flex-col gap-3 sm:px-2"
    >
      <FormAlert error={apiError} />

      {/* 1. Заголовок и текст — один блок с общей рамкой: заголовок читается как
          крупная первая строка документа, а не как ещё одно поле формы.
          Перетаскивание работает на весь блок, поэтому отдельная дропзона не нужна. */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!mediaFull) setDragging(true)
        }}
        onDragLeave={(e) => {
          // dragleave всплывает и при переходе между вложенными узлами —
          // гасим подсветку только когда курсор действительно ушёл из блока.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!mediaFull) void handleFiles(e.dataTransfer.files)
        }}
        className={cn(
          'relative flex flex-col rounded-xl border border-input bg-background transition-[color,box-shadow,border-color] focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15 dark:bg-input/30',
          dragging && 'border-primary ring-4 ring-primary/15',
        )}
      >
        <Input
          id="post-title"
          aria-label={t('titleLabel')}
          placeholder={t('titlePlaceholder')}
          // Рамку и фокус держит блок целиком — у заголовка своих границ нет.
          className="h-auto rounded-none border-transparent bg-transparent px-3 pt-3 pb-1 text-lg font-semibold hover:border-transparent focus-visible:border-transparent focus-visible:ring-0 md:text-lg dark:bg-transparent"
          {...form.register('title', OPTIONAL_TEXT)}
        />
        {/* Разметка остаётся видимой в поле: человек видит, что именно уедет на
            сервер, а не догадывается по кнопкам панели. */}
        <Controller
          control={form.control}
          name="content"
          render={({ field }) => (
            <MarkdownEditor
              id="post-content"
              aria-label={t('contentLabel')}
              value={field.value ?? ''}
              onChange={field.onChange}
              placeholder={t('placeholder')}
              autoGrow
              bare
              rows={3}
              // Поле растёт под текст: снизу — минимум в несколько строк, сверху —
              // половина экрана, иначе подвал с «Опубликовать» уезжает за нижний край.
              className="max-h-[45vh] min-h-28"
            />
          )}
        />
        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-primary/10 text-sm font-medium text-primary">
            {t('dropHint')}
          </div>
        )}
      </div>
      {form.formState.errors.content && (
        <p className="text-xs text-destructive">{t('contentRequired')}</p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {/* 2. Вложения — горизонтальной лентой под текстом: десять превью сеткой
          заняли бы три ряда и вытолкнули подвал за нижний край окна. */}
      {(media.length > 0 || uploading) && (
        <div className="group/strip relative">
          <div
            ref={stripRef}
            onScroll={syncStrip}
            className="flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {media.map((m) => (
              <div
                key={m.id}
                className="group relative size-24 shrink-0 snap-start overflow-hidden rounded-xl border border-border bg-muted sm:size-28"
              >
                {m.isVideo ? (
                  <video src={m.url} muted className="size-full object-cover" />
                ) : (
                  <img src={m.url} alt="" className="size-full object-cover" />
                )}
                {m.isVideo && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 text-white">
                    <Play className="size-5 fill-current" aria-hidden />
                  </span>
                )}
                <button
                  type="button"
                  aria-label={t('removeMedia')}
                  onClick={() => removeMedia(m.id)}
                  // На тач-экране кнопка видна всегда: `hover` в Tailwind v4 работает
                  // только там, где есть курсор, — иначе вложение не убрать вовсе.
                  className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-black/55 text-white transition-opacity hover:bg-black/75 focus-visible:opacity-100 sm:size-6 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            ))}
            {uploading && (
              <div className="flex size-24 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground sm:size-28">
                <Loader2 className="size-5 animate-spin" aria-hidden />
              </div>
            )}
          </div>

          {/* Стрелки-слайдер поверх ленты. Появляются только с той стороны,
              куда есть куда листать, — иначе кнопка обманывает. */}
          {strip.left && (
            <button
              type="button"
              aria-label={t('prevMedia')}
              onClick={() => scrollStrip(-1)}
              className="absolute top-1/2 left-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
          )}
          {strip.right && (
            <button
              type="button"
              aria-label={t('nextMedia')}
              onClick={() => scrollStrip(1)}
              className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          )}
        </div>
      )}

      {/* 3. Уточнение адресата — только для тех аудиторий, где оно нужно. */}
      {showScope && (
        <div className="grid gap-3 sm:grid-cols-2">
          {showGroupPicker && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t('group')}</Label>
              <Controller
                control={form.control}
                name="groupId"
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('selectGroup')} />
                    </SelectTrigger>
                    <SelectContent>
                      {(groups.data ?? []).map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
              <Label className="text-xs">{t('subject')}</Label>
              <Input {...form.register('subject')} />
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

      {/* 4. Отложенная публикация — строка появляется по кнопке с часами. */}
      {(scheduleOpen || scheduleAt) && (
        <div className="flex items-center gap-2">
          <DateTimePicker
            value={scheduleAt}
            onChange={setScheduleAt}
            aria-label={t('scheduleLabel')}
            className="flex-1"
          />
          <Button
            type="button"
            icon
            variant="ghost"
            aria-label={tCommon('clear')}
            onClick={() => {
              setScheduleAt('')
              setScheduleOpen(false)
            }}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      )}

      {/* 5. Подвал: инструменты слева, аудитория и действия справа. Липкий, чтобы
          «Опубликовать» не уезжало за нижний край длинной формы. */}
      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t border-border bg-card px-1 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3">
        <div className="flex items-center gap-0.5">
          <ToolButton
            label={t('addMedia')}
            disabled={mediaFull}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-4" aria-hidden />
          </ToolButton>
          <ToolButton
            label={t('scheduleLabel')}
            active={scheduleOpen || !!scheduleAt}
            onClick={() => setScheduleOpen((v) => !v)}
          >
            <Clock className="size-4" aria-hidden />
          </ToolButton>
        </div>

        <div className="min-w-0 flex-1">
          <Controller
            control={form.control}
            name="audience"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger size="md" aria-label={t('audience')} className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {audiences.map((a) => (
                    <SelectItem key={a} value={a}>
                      {t(`audience${a}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        {/* На телефоне действия переносятся на свою строку во всю ширину. */}
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            type="button"
            variant="outline"
            loading={mutation.isPending}
            onClick={() => void submit('DRAFT')()}
            className="h-11 flex-1 sm:h-10 sm:flex-none"
          >
            {t('saveDraft')}
          </Button>
          <Button
            type="submit"
            loading={mutation.isPending}
            className="h-11 flex-1 sm:h-10 sm:flex-none"
          >
            {scheduleAt ? t('schedule') : t('publish')}
          </Button>
        </div>
      </div>
    </form>
  )

  if (bare) return body
  return (
    <Card>
      <CardContent className="pt-6">{body}</CardContent>
    </Card>
  )
}

// Иконка-инструмент в подвале: форматирование, вложения, отложенная публикация.
// Включённое состояние подсвечено и объявляется скринридеру через aria-pressed.
function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      icon
      variant="ghost"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(active && 'bg-muted text-foreground')}
    >
      {children}
    </Button>
  )
}
