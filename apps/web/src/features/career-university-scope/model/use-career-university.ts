'use client'

import { useCallback, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Role } from '@studenthub/shared-types'
import { useAppDispatch, useAppSelector } from '../../../shared/store'
import { setCareerUniversity } from '../../../shared/store/ui-slice'

/** Роли без собственного вуза: область данных карьерного центра они выбирают вручную. */
const NEEDS_PICK: Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]

/**
 * Вуз, в чьём scope работает карьерный центр.
 *
 * У сотрудника вуза он в токене, и запросы уходят без параметра — сервер всё равно возьмёт
 * свой, а чужой не отдаст. Платформенные роли своего вуза не имеют: без выбранного вуза
 * разделы карьерного центра отвечают `WRONG_SCOPE`, поэтому им показывается переключатель.
 *
 * Хранится в сторе — это контекст всего продукта, один на все его разделы, а не фильтр
 * страницы. В адрес он дублируется, чтобы пережить перезагрузку (стор живёт в памяти) и
 * уехать вместе со ссылкой; адрес же и подхватывается обратно, когда стор пуст.
 */
export function useCareerUniversity(): {
  /** Нужен ли этой роли ручной выбор вуза. */
  needsPick: boolean
  /** Выбранный вуз; null — ещё не выбран. */
  universityId: string | null
  select: (id: string) => void
} {
  const role = useAppSelector((s) => s.auth.role)
  const stored = useAppSelector((s) => s.ui.careerUniversityId)
  const dispatch = useAppDispatch()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const needsPick = role !== null && NEEDS_PICK.includes(role)
  const fromUrl = params.get('universityId')
  const universityId = needsPick ? (stored ?? fromUrl) : null

  // Стор и адрес держим согласованными в обе стороны:
  // • перезагрузка обнуляет стор — выбор возвращается из адреса;
  // • переход по сайдбару уводит на чистый адрес — дописываем в него текущий вуз,
  //   иначе перезагрузка на этом разделе снова показала бы «Выберите университет».
  useEffect(() => {
    if (!needsPick) return
    if (!stored && fromUrl) {
      dispatch(setCareerUniversity(fromUrl))
      return
    }
    if (stored && !fromUrl) {
      const next = new URLSearchParams(params.toString())
      next.set('universityId', stored)
      router.replace(`${pathname}?${next.toString()}`)
    }
  }, [needsPick, stored, fromUrl, dispatch, params, pathname, router])

  const select = useCallback(
    (id: string) => {
      dispatch(setCareerUniversity(id))
      const next = new URLSearchParams(params.toString())
      next.set('universityId', id)
      // replace, а не push: смена области данных — не шаг навигации, и «назад» должно
      // уводить со страницы, а не перебирать ранее выбранные вузы.
      router.replace(`${pathname}?${next.toString()}`)
    },
    [dispatch, params, pathname, router],
  )

  return { needsPick, universityId, select }
}
