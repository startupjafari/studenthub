'use client'

import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { fetchConsentState, fetchMe, userKeys } from '../../../entities/user'

// Само окно — отдельным чанком: форма нужна единицам и раз в редакцию документов, а гейт
// стоит в оболочке каждого экрана. ssr: false — окно зависит от сессии.
const ConsentDialog = dynamic(() => import('./consent-dialog').then((m) => m.ConsentDialog), {
  ssr: false,
})

/**
 * Гейт повторного согласия на обработку персональных данных (A-F29).
 *
 * Согласие из регистрации перестаёт подходить, когда меняется редакция документов или когда
 * дата рождения в профиле расходится с тем, кто его давал (сам человек или законный
 * представитель). Тогда сервер отвечает `required`, и окно закрывает интерфейс, пока
 * согласие не примут заново или не выйдут. Остальным окно не показывается вовсе.
 */
export function ConsentGate() {
  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const birthDate = me.data?.birthDate ?? null
  const consent = useQuery({
    queryKey: userKeys.consent(birthDate),
    queryFn: fetchConsentState,
    // Ждём профиль: дата рождения входит в ключ, иначе запрос ушёл бы дважды.
    enabled: me.isSuccess,
    // Редакция меняется с выкаткой, а основание — правкой профиля (она меняет ключ):
    // перезапрашивать состояние на каждый фокус окна незачем.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })

  if (!consent.data?.required) return null
  return <ConsentDialog state={consent.data} birthDate={birthDate} />
}
