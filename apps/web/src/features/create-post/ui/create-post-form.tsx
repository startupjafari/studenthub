'use client'

import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight, Loader2, Play, Upload, X } from 'lucide-react'
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
export function CreatePostForm({
  onCreated,
  bare,
}: { onCreated?: () => void; bare?: boolean } = {}) {
  const t = useTranslations('Feed')
  const tEditor = useTranslations('Editor')
  const tPeople = useTranslations('People')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const role = useAppSelector((s) => s.auth.role)
  const [media, setMedia] = useState<UploadedMedia[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  function scrollStrip(dir: 1 | -1): void {
    stripRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' })
  }

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

  const showGroupPicker = audience === 'GROUP' && role !== null && GROUP_PICKER_ROLES.includes(role)
  const showFacultyPicker =
    audience === 'FACULTY' && role !== null && FACULTY_PICKER_ROLES.includes(role)
  const showSubject = audience === 'SUBJECT'
  const showPersonal = audience === 'PERSONAL'
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

  // Загрузка фото/видео одной областью: object-URL для превью + upload в бакет постов.
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

  if (audiences.length === 0) return null

  const body = (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit('PUBLISHED')()
      }}
      className="flex flex-col gap-6 py-2 sm:px-2"
    >
      <FormAlert error={apiError} />
      {/* 1. Заголовок и текст. Первыми: за этим в форму и приходят, а раньше до поля
          ввода нужно было проскроллить дропзону и три настройки. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="post-title" className="text-xs">
          {t('titleLabel')}
        </Label>
        <Input
          id="post-title"
          {...form.register('title', OPTIONAL_TEXT)}
          placeholder={t('titlePlaceholder')}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="post-content" className="text-xs">
          {t('contentLabel')}
        </Label>
        {/* Разметка остаётся видимой в поле: человек видит, что именно уедет на
            сервер, а не догадывается по кнопкам панели. */}
        <Controller
          control={form.control}
          name="content"
          render={({ field }) => (
            <MarkdownEditor
              id="post-content"
              value={field.value ?? ''}
              onChange={field.onChange}
              placeholder={t('placeholder')}
              hint={tEditor('markdownHint')}
            />
          )}
        />
        {form.formState.errors.content && (
          <p className="text-xs text-destructive">{t('contentRequired')}</p>
        )}
      </div>

      {/* 2. Вложения: фото и видео */}
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
      {media.length < MAX_MEDIA && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void handleFiles(e.dataTransfer.files)
          }}
          // Пока вложений нет — компактная полоса, а не блок в треть экрана: на
          // телефоне высокая дропзона отодвигала кнопки публикации за нижний край,
          // а перетаскивать файлы там всё равно нечем.
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40"
        >
          {uploading ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <>
              <Upload className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="text-sm font-medium">{t('dropHint')}</span>
              <span className="hidden text-xs text-muted-foreground/80 sm:inline">
                · {t('mediaLimit')}
              </span>
            </>
          )}
        </button>
      )}

      {/* Превью загруженного — горизонтальный слайдер в одну строку */}
      {media.length > 0 && (
        <div className="group/strip relative">
          <div
            ref={stripRef}
            className="flex gap-2 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:thin]"
          >
            {media.map((m) => (
              <div
                key={m.id}
                className="group relative size-24 shrink-0 overflow-hidden rounded-xl border border-border bg-muted"
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
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
            ))}
          </div>
          {media.length > 4 && (
            <>
              <button
                type="button"
                aria-label={t('prevMedia')}
                onClick={() => scrollStrip(-1)}
                className="absolute left-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-sm backdrop-blur transition-opacity hover:bg-card"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={t('nextMedia')}
                onClick={() => scrollStrip(1)}
                className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-sm backdrop-blur transition-opacity hover:bg-card"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </>
          )}
        </div>
      )}

      {/* 3. Кому и когда. На широком экране — в две колонки: поля короткие, и
          растягивать их на всю ширину незачем. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div
          className={cn(
            'flex flex-wrap items-end gap-3',
            // Когда рядом с аудиторией появляется выбор группы, факультета, предмета
            // или адресата, половины ширины на всё это мало — занимаем обе колонки.
            (showGroupPicker || showFacultyPicker || showSubject || showPersonal) &&
              'sm:col-span-2',
          )}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label className="text-xs">{t('audience')}</Label>
            <Controller
              control={form.control}
              name="audience"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
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

          {showGroupPicker && (
            <div className="flex flex-1 flex-col gap-1.5">
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
            <div className="flex flex-1 flex-col gap-1.5">
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
            <div className="flex flex-1 flex-col gap-1.5">
              <Label className="text-xs">{t('subject')}</Label>
              <Input {...form.register('subject')} />
            </div>
          )}

          {showPersonal && (
            <div className="flex flex-1 flex-col gap-1.5">
              <Label className="text-xs">{tPeople('pickUser')}</Label>
              <UserPicker value={target} onSelect={setTarget} />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t('scheduleLabel')}</Label>
          <DateTimePicker
            value={scheduleAt}
            onChange={setScheduleAt}
            aria-label={t('scheduleLabel')}
          />
        </div>
      </div>

      {/* 4. Действия — липкой полосой у нижнего края: в длинной форме кнопка
          «Опубликовать» уезжала за экран, и до неё приходилось скроллить. */}
      <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t border-border bg-card px-1 py-3">
        <Button
          type="button"
          variant="outline"
          loading={mutation.isPending}
          onClick={() => void submit('DRAFT')()}
        >
          {t('saveDraft')}
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {scheduleAt ? t('schedule') : t('publish')}
        </Button>
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
