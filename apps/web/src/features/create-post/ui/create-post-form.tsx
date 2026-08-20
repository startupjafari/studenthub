'use client'

import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight, Loader2, Play, Upload, X } from 'lucide-react'
import {
  CreatePostSchema,
  type CreatePostInput,
  type PostAudienceValue,
} from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { useFormAlert } from '../../../shared/lib'
import { uploadFileRequest } from '../../../shared/api'
import { createPostRequest, postKeys } from '../../../entities/post'
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
  Textarea,
} from '../../../shared/ui'

interface UploadedMedia {
  id: string
  url: string // локальный object-URL для превью
  isVideo: boolean
}
const MAX_MEDIA = 10

// Аудитории для UI по роли (PERSONAL отложен до списка пользователей Ф12.2).
const UI_AUDIENCES: Partial<Record<Role, PostAudienceValue[]>> = {
  [Role.PLATFORM_ADMIN]: ['ALL', 'PERSONAL'],
  [Role.UNIVERSITY_ADMIN]: ['UNIVERSITY', 'FACULTY', 'GROUP', 'TEACHERS', 'PERSONAL'],
  [Role.DEAN]: ['FACULTY', 'GROUP', 'PERSONAL'],
  [Role.TEACHER]: ['GROUP', 'SUBJECT', 'PERSONAL'],
  [Role.STAROSTA]: ['GROUP', 'PERSONAL'],
  [Role.STUDENT]: ['GROUP', 'PERSONAL'],
}

// Кто выбирает конкретную группу/факультет (у студента/старосты/декана — свои, без пикера).
const GROUP_PICKER_ROLES: Role[] = [Role.UNIVERSITY_ADMIN, Role.TEACHER]
const FACULTY_PICKER_ROLES: Role[] = [Role.UNIVERSITY_ADMIN]

// onCreated — необязательный колбэк после успешной публикации (например, закрыть модалку в профиле).
// bare — без обёртки Card (когда форма уже внутри модалки/карточки).
export function CreatePostForm({
  onCreated,
  bare,
}: { onCreated?: () => void; bare?: boolean } = {}) {
  const t = useTranslations('Feed')
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

  const audiences = role ? (UI_AUDIENCES[role] ?? []) : []

  const form = useForm<CreatePostInput>({
    resolver: zodResolver(CreatePostSchema),
    defaultValues: { audience: audiences[0], content: '' },
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
      form.reset({ audience: audiences[0], content: '' })
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
      {/* 1. Одна область загрузки (фото и видео) */}
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
          className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40"
        >
          {uploading ? (
            <Loader2 className="size-6 animate-spin" aria-hidden />
          ) : (
            <>
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Upload className="size-6" aria-hidden />
              </span>
              <span className="text-sm font-medium">{t('dropHint')}</span>
              <span className="text-xs text-muted-foreground/80">{t('mediaLimit')}</span>
            </>
          )}
        </button>
      )}

      {/* 2. Превью загруженного — горизонтальный слайдер в одну строку */}
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

      {/* 3. Аудитория (Select) + связанные пикеры */}
      <div className="flex flex-wrap items-end gap-3">
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

      {/* 4. Дата отложенной публикации (компонент Date) */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">{t('scheduleLabel')}</Label>
        <DateTimePicker
          value={scheduleAt}
          onChange={setScheduleAt}
          aria-label={t('scheduleLabel')}
        />
      </div>

      {/* 5. Текст поста — на всю ширину */}
      <div className="flex flex-col gap-1.5">
        <Textarea {...form.register('content')} rows={3} placeholder={t('placeholder')} />
        {form.formState.errors.content && (
          <p className="text-xs text-destructive">{t('contentRequired')}</p>
        )}
      </div>

      {/* 6. Кнопки */}
      <div className="flex justify-end gap-2">
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
