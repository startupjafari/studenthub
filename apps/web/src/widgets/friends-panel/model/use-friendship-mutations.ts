'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { acceptFriendRequest, friendKeys, removeFriendship } from '../../../entities/friendship'
import { notificationKeys } from '../../../entities/notification'

/**
 * Принять / отклонить заявку и удалить из друзей — общий набор для панели и окна.
 *
 * Инвалидируем всё поддерево `friends`: одно действие меняет сразу три выборки
 * (счётчики, список друзей, список заявок), и точечная инвалидация каждой из них
 * ничего не экономит, а забыть одну — легко.
 *
 * Уведомления сбрасываем тоже: принимая заявку, сервер гасит уведомление о ней
 * (clearRequestNotification), и без этого бейдж колокола остаётся висеть.
 */
export function useFriendshipMutations() {
  const t = useTranslations('Friends')
  const tErr = useTranslations('Errors')
  const queryClient = useQueryClient()

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: friendKeys.all })
    void queryClient.invalidateQueries({ queryKey: notificationKeys.all })
  }

  const accept = useMutation({
    mutationFn: (friendshipId: string) => acceptFriendRequest(friendshipId),
    onSuccess: () => {
      invalidate()
      toast.success(t('accepted'))
    },
    onError: () => toast.error(tErr('INTERNAL_ERROR')),
  })

  // Один эндпоинт на три исхода: отклонить входящую, отменить свою, удалить из друзей.
  // Текст тоста поэтому задаёт вызывающая сторона — по контексту кнопки.
  const remove = useMutation({
    mutationFn: (vars: { friendshipId: string; message?: string }) =>
      removeFriendship(vars.friendshipId),
    onSuccess: (_data, vars) => {
      invalidate()
      if (vars.message) toast.success(vars.message)
    },
    onError: () => toast.error(tErr('INTERNAL_ERROR')),
  })

  return { accept, remove }
}
