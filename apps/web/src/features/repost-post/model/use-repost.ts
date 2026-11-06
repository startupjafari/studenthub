'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  postKeys,
  repostArticleRequest,
  repostRequest,
  selfRepostAudience,
} from '../../../entities/post'
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

  // Репостят пост или статью — одна и та же «своя» аудитория, разный адрес.
  const mutation = useMutation({
    mutationFn: (target: { kind: 'post' | 'article'; id: string }) => {
      if (!audience) throw new Error('no self audience')
      return target.kind === 'post'
        ? repostRequest(target.id, { audience })
        : repostArticleRequest(target.id, { audience })
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
    repost: (postId: string) => mutation.mutate({ kind: 'post', id: postId }),
    repostArticle: (articleId: string) => mutation.mutate({ kind: 'article', id: articleId }),
    isPending: mutation.isPending,
  }
}
