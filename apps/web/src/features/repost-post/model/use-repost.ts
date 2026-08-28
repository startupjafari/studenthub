'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { postKeys, repostRequest, selfRepostAudience } from '../../../entities/post'
import { useAppSelector } from '../../../shared/store'

/**
 * Репост в один клик: пост уходит в собственную ленту репостящего, без окна с выбором
 * аудитории и комментарием. Выбирать было нечего — репост и так всегда «к себе».
 *
 * `audience === null` — роль не умеет репостить без явной цели (преподаватель: своей
 * группы у него нет, а PERSONAL требует получателя). Тогда вызывающий показывает окно
 * `RepostDialog`, где цель выбирают руками.
 */
export function useRepost() {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const role = useAppSelector((s) => s.auth.role)
  const groupId = useAppSelector((s) => s.auth.groupId)
  const facultyId = useAppSelector((s) => s.auth.facultyId)
  const universityId = useAppSelector((s) => s.auth.universityId)

  const audience = selfRepostAudience(role, { groupId, facultyId, universityId })

  const mutation = useMutation({
    mutationFn: (postId: string) => {
      if (!audience) throw new Error('no self audience')
      return repostRequest(postId, { audience })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.all })
      toast.success(t('reposted'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  return {
    /** null — мгновенный репост недоступен, нужен `RepostDialog`. */
    audience,
    repost: (postId: string) => mutation.mutate(postId),
    isPending: mutation.isPending,
  }
}
