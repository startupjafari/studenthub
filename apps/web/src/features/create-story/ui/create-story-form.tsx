'use client'

import { useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { BarChart3, ImagePlus, Link2, Loader2, Plus, X } from 'lucide-react'
import {
  CreateStorySchema,
  STORY_BACKGROUNDS,
  STORY_TEXT_MAX,
  type CreateStoryInput,
} from '@studenthub/shared-schemas'
import { useAppSelector } from '../../../shared/store'
import { useFormAlert } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  STORY_AUDIENCES_BY_ROLE,
  STORY_BACKGROUND_CLASS,
  STORY_FACULTY_PICKER_ROLES,
  STORY_GROUP_PICKER_ROLES,
  createStoryRequest,
  storyKeys,
  uploadStoryMedia,
} from '../../../entities/story'
import { fetchGroups, groupKeys } from '../../../entities/group'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import {
  Button,
  FieldError,
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

const MAX_POLL_OPTIONS = 4
const MIN_POLL_OPTIONS = 2

interface PickedMedia {
  id: string
  /** Локальный object-URL для превью: подписанную ссылку сервер отдаст уже в ленте. */
  url: string
  isVideo: boolean
}

/**
 * Форма публикации сторис.
 *
 * Собрана как кадр, а не как анкета: слева превью будущей сторис (фон или медиа с
 * текстом поверх), справа — чем его наполнить. Ссылка и опрос открываются кнопками и
 * по умолчанию свёрнуты: их добавляют к одной сторис из десяти, а поля под них
 * занимали бы высоту всегда.
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
  const fileRef = useRef<HTMLInputElement>(null)

  const audiences = role ? (STORY_AUDIENCES_BY_ROLE[role] ?? []) : []

  const form = useForm<CreateStoryInput>({
    resolver: zodResolver(CreateStorySchema),
    defaultValues: { audience: audiences[0], text: '' },
  })
  const audience = form.watch('audience')
  const background = form.watch('background')
  const poll = form.watch('poll')
  const linkUrl = form.watch('linkUrl')
  const text = form.watch('text') ?? ''

  const showGroupPicker =
    audience === 'GROUP' && role !== null && STORY_GROUP_PICKER_ROLES.includes(role)
  const showFacultyPicker =
    audience === 'FACULTY' && role !== null && STORY_FACULTY_PICKER_ROLES.includes(role)

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
    mutationFn: (input: CreateStoryInput) => createStoryRequest(input),
    onMutate: () => resetApiError(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storyKeys.all })
      if (media) URL.revokeObjectURL(media.url)
      setMedia(null)
      form.reset({ audience: audiences[0], text: '' })
      toast.success(t('published'))
      onCreated?.()
    },
    onError: (e) => showApiError(e),
  })

  async function handleFile(files: FileList | null): Promise<void> {
    const file = files?.[0]
    if (!file) return
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
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function dropMedia(): void {
    if (media) URL.revokeObjectURL(media.url)
    setMedia(null)
    form.setValue('fileId', undefined)
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

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
    >
      <FormAlert error={apiError} />

      <div className="flex flex-col gap-4 sm:flex-row">
        {/* Превью кадра: 9:16, как и сам формат. */}
        <div
          className={cn(
            'relative flex aspect-[9/16] w-full max-w-[12rem] shrink-0 items-center justify-center overflow-hidden rounded-2xl text-white',
            !media && STORY_BACKGROUND_CLASS[background ?? 'graphite'],
            media && 'bg-black',
          )}
        >
          {media ? (
            media.isVideo ? (
              <video src={media.url} className="size-full object-cover" muted playsInline />
            ) : (
              // Локальный object-URL: оптимизировать blob next/image не может.
              <img src={media.url} alt="" className="size-full object-cover" />
            )
          ) : null}
          {text.trim() !== '' && (
            <p className="absolute inset-x-3 bottom-4 text-center text-sm font-medium break-words drop-shadow-lg">
              {text}
            </p>
          )}
          {media && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon
              aria-label={t('removeMedia')}
              className="absolute top-2 right-2 bg-black/50 text-white hover:bg-black/70"
              onClick={dropMedia}
            >
              <X className="size-4" aria-hidden />
            </Button>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <Textarea
              {...form.register('text')}
              rows={3}
              maxLength={STORY_TEXT_MAX}
              placeholder={t('textPlaceholder')}
              aria-label={t('textPlaceholder')}
            />
            <FieldError>{form.formState.errors.text && t('needContent')}</FieldError>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="md"
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
              variant={linkUrl ? 'secondary' : 'outline'}
              size="md"
              onClick={() => form.setValue('linkUrl', linkUrl ? undefined : '')}
            >
              <Link2 className="size-4" aria-hidden />
              {t('addLink')}
            </Button>
            <Button
              type="button"
              variant={poll ? 'secondary' : 'outline'}
              size="md"
              onClick={togglePoll}
            >
              <BarChart3 className="size-4" aria-hidden />
              {t('addPoll')}
            </Button>
          </div>

          {/* Фон выбирается только у текстовой сторис — поверх фото он не виден. */}
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

          {linkUrl !== undefined && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1">
                <Input
                  {...form.register('linkUrl')}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  aria-label={t('linkUrl')}
                />
                <FieldError>{form.formState.errors.linkUrl && t('badLink')}</FieldError>
              </div>
              <Input
                {...form.register('linkLabel')}
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
          <Controller
            control={form.control}
            name="groupId"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                <SelectTrigger
                  size="md"
                  aria-label={tFeed('audienceGROUP')}
                  className="w-full sm:w-44"
                >
                  <SelectValue placeholder={tFeed('audienceGROUP')} />
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
    </form>
  )
}
