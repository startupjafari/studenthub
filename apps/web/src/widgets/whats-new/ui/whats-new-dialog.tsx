'use client'

import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppSelector } from '../../../shared/store'
import {
  RELEASE_NOTES,
  ReleaseNoteModal,
  fetchReleaseState,
  markReleaseSeen,
  pickReleaseNote,
  releaseKeys,
  type ReleaseState,
} from '../../../entities/release'

/**
 * Окно «Что нового» — один раз на релиз, на всех устройствах человека.
 *
 * Почему тексты берутся из бандла, а не из API: у установленного приложения открытая
 * страница неделями живёт на старой сборке (service worker отдаёт закешированный HTML).
 * Нота, прилетевшая из API раньше нового бандла, описывала бы функции, которых у человека
 * ещё нет. Здесь же нота и код, который она описывает, приезжают одним обновлением —
 * после того, как SW применили и страница перезагрузилась (`use-sw-update.ts`).
 */
export function WhatsNewDialog() {
  const authed = useAppSelector((s) => !!s.auth.accessToken)
  const queryClient = useQueryClient()

  const { data: state } = useQuery({
    queryKey: releaseKeys.state(),
    queryFn: fetchReleaseState,
    enabled: authed,
    // Состояние меняется раз в релиз и только по действию самого пользователя —
    // перезапрашивать его при каждом фокусе окна незачем.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const decision = pickReleaseNote(RELEASE_NOTES, authed ? state : undefined)

  const seen = useMutation({
    mutationFn: markReleaseSeen,
    onSuccess: (data) => {
      // Локальное обновление вместо инвалидации: ответ уже содержит новое состояние,
      // а лишний GET на закрытие окна ничего не уточнит.
      queryClient.setQueryData<ReleaseState>(releaseKeys.state(), (prev) => ({
        version: data.version,
        seenAt: data.seenAt,
        accountCreatedAt: prev?.accountCreatedAt ?? null,
      }))
    },
    // Ошибку показывать нечего: человек прочитал ноту, а не выполнял действие. Не
    // записалось — окно всплывёт в следующий раз, это меньшее зло, чем тост об ошибке
    // поверх приветственного текста.
    onError: () => undefined,
  })

  // Новичку окно не показываем, но отметку ставим молча — иначе на следующем релизе он
  // получит сразу две ноты подряд. Ровно один раз на версию.
  const acknowledged = useRef<string | null>(null)
  const mutate = seen.mutate
  useEffect(() => {
    if (!decision || decision.action !== 'acknowledge') return
    if (acknowledged.current === decision.note.version) return
    acknowledged.current = decision.note.version
    mutate(decision.note.version)
  }, [decision, mutate])

  if (!decision || decision.action !== 'show') return null

  return (
    <ReleaseNoteModal
      note={decision.note}
      busy={seen.isPending}
      onClose={() => seen.mutate(decision.note.version)}
    />
  )
}
