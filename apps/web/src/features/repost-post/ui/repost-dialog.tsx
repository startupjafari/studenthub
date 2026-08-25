'use client'

import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Repeat2 } from 'lucide-react'
import { RepostSchema, type RepostInput } from '@studenthub/shared-schemas'
import { useAppSelector } from '../../../shared/store'
import { useFormAlert } from '../../../shared/lib'
import {
  FACULTY_PICKER_ROLES,
  GROUP_PICKER_ROLES,
  REPOST_AUDIENCES_BY_ROLE,
  postKeys,
  repostRequest,
  type FeedPost,
} from '../../../entities/post'
import { fetchGroups, groupKeys } from '../../../entities/group'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import { UserPicker, type PickedUser } from '../../../entities/user'
import {
  Button,
  FormAlert,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../shared/ui'

// Какая цель не выбрана — ошибка показывается под соответствующим полем (FRONTEND_RULES §7).
type Missing = 'user' | 'group' | 'faculty' | null

// Репост поста со своим комментарием: POST /posts/:id/repost. Аудиторию выбирает репостящий —
// от аудитории оригинала она не наследуется (её считает сервер по роли).
export function RepostDialog({ post, onClose }: { post: FeedPost; onClose: () => void }) {
  const t = useTranslations('Feed')
  const tCommon = useTranslations('Common')
  const tPeople = useTranslations('People')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const role = useAppSelector((s) => s.auth.role)
  const [target, setTarget] = useState<PickedUser | null>(null)
  const [missing, setMissing] = useState<Missing>(null)

  const audiences = role ? (REPOST_AUDIENCES_BY_ROLE[role] ?? []) : []
  const form = useForm<RepostInput>({
    resolver: zodResolver(RepostSchema),
    defaultValues: { audience: audiences[0], content: '' },
  })
  const audience = form.watch('audience')

  const showGroupPicker = audience === 'GROUP' && role !== null && GROUP_PICKER_ROLES.includes(role)
  const showFacultyPicker =
    audience === 'FACULTY' && role !== null && FACULTY_PICKER_ROLES.includes(role)
  const showPersonal = audience === 'PERSONAL'

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
    mutationFn: (input: RepostInput) => repostRequest(post.id, input),
    onMutate: () => resetApiError(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.all })
      toast.success(t('reposted'))
      onClose()
    },
    onError: (e) => showApiError(e),
  })

  // Пост-первоисточник для цитаты: репост репоста ссылается на оригинал (так же считает сервер).
  const source = post.original ?? { author: post.author, content: post.content }

  const submit = form.handleSubmit((v) => {
    if (showPersonal && !target) return setMissing('user')
    if (showGroupPicker && !v.groupId) return setMissing('group')
    if (showFacultyPicker && !v.facultyId) return setMissing('faculty')
    setMissing(null)
    mutation.mutate({
      audience: v.audience,
      content: v.content?.trim() ? v.content.trim() : undefined,
      groupId: showGroupPicker ? v.groupId : undefined,
      facultyId: showFacultyPicker ? v.facultyId : undefined,
      targetUserId: showPersonal ? target?.id : undefined,
    })
  })

  return (
    <Modal onClose={onClose} title={t('repostTitle')} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="flex flex-col gap-4 px-4 py-4"
      >
        <FormAlert error={apiError} />

        {/* Цитата оригинала — что именно репостится */}
        <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
          <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Repeat2 className="size-3.5" aria-hidden />
            {source.author.lastName} {source.author.firstName}
          </p>
          <p className="line-clamp-4 whitespace-pre-wrap">{source.content || t('mediaPost')}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs" htmlFor="repost-audience">
            {t('audience')}
          </Label>
          <Controller
            control={form.control}
            name="audience"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="repost-audience" className="w-full">
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
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs" htmlFor="repost-group">
              {t('group')}
            </Label>
            <Controller
              control={form.control}
              name="groupId"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger id="repost-group" className="w-full">
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
            {missing === 'group' && (
              <p className="text-xs text-destructive">{t('targetRequired')}</p>
            )}
          </div>
        )}

        {showFacultyPicker && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs" htmlFor="repost-faculty">
              {t('faculty')}
            </Label>
            <Controller
              control={form.control}
              name="facultyId"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger id="repost-faculty" className="w-full">
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
            {missing === 'faculty' && (
              <p className="text-xs text-destructive">{t('targetRequired')}</p>
            )}
          </div>
        )}

        {showPersonal && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{tPeople('pickUser')}</Label>
            <UserPicker value={target} onSelect={setTarget} />
            {missing === 'user' && (
              <p className="text-xs text-destructive">{t('targetRequired')}</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs" htmlFor="repost-comment">
            {t('repostComment')}
          </Label>
          <Textarea
            id="repost-comment"
            rows={3}
            placeholder={t('repostPlaceholder')}
            {...form.register('content')}
          />
          {form.formState.errors.content && (
            <p className="text-xs text-destructive">{t('contentTooLong')}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={audiences.length === 0}>
            {t('repost')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
