'use client'

import { useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { toApiError } from './api-error'
import { useValidationMessage } from './validation-message'

/**
 * Серверная или техническая ошибка — тостом в правый нижний угол, а не плашкой в потоке
 * (DESIGN_SYSTEM §9, §10.3). Правило без исключений: отказ сервера, сбой сети, отказ
 * NCALayer, неудачная загрузка файла — всё, что не про конкретное поле, всплывает тостом.
 *
 * Почему не плашка над формой: она раздвигает вёрстку ровно в момент повторной попытки —
 * поля и кнопки уезжают из-под курсора, модальное окно упирается в 90vh и начинает
 * прокручиваться, а у длинной формы плашка в начале оказывается выше сгиба, и человек,
 * нажавший «отправить» внизу, отказа не видит вовсе.
 *
 * Ошибки отдельных полей тост не заменяет никогда: их место в строке подписи поля
 * (`FieldError`). Туда же — серверная ошибка про одно поле («имя занято»).
 *
 * `id` — свой у каждой формы: повторный отказ обновляет тот же тост, а не копит
 * стопку одинаковых сообщений.
 *
 * `show(error)` — текст из словаря `Errors` по `code`. `showText(text)` — когда у экрана
 * своё прочтение кода («неверный пароль» вместо общего BAD_REQUEST, отказы стойки
 * библиотеки, NCALayer): тот же тост с тем же `id`, только текст готовый. Отдельной
 * функцией, а не вторым аргументом `show`: `onError: show` получает вторым аргументом
 * переменные мутации, и они ушли бы в тост вместо текста.
 */
export function useErrorToast(id: string): {
  show: (error: unknown) => void
  showText: (text: string) => void
} {
  const tErr = useTranslations('Errors')
  const translate = useValidationMessage()

  const show = useCallback(
    (e: unknown) => {
      const api = toApiError(e)
      // Поля из details показываем строкой под заголовком: подписывать ошибку под каждым
      // полем тост не может.
      const details = api.code === 'VALIDATION_ERROR' ? api.details : undefined
      toast.error(tErr(api.code), {
        id,
        description: details?.length
          ? details.map((d) => translate(d.message)).join(' · ')
          : undefined,
      })
    },
    [id, tErr, translate],
  )

  const showText = useCallback(
    (text: string) => {
      toast.error(text, { id })
    },
    [id],
  )

  // Тост живёт ровно столько, сколько форма: окно закрыли — сообщение о его ошибке
  // уносим следом, иначе оно висит поверх экрана, к которому уже не относится.
  //
  // Гасить тост ПЕРЕД новой попыткой при этом нельзя: sonner помечает закрытый тост
  // на удаление и размонтирует через 200 мс, и ответ сервера, пришедший внутри этого
  // окна, обновит уже помеченную запись — отказ молча не покажется. Поэтому чистка
  // только здесь, при размонтировании, где новой ошибки заведомо не будет.
  useEffect(
    () => () => {
      // Тело блоком, а не сокращённой стрелкой: `toast.dismiss` возвращает id, и React
      // принял бы его за функцию очистки.
      toast.dismiss(id)
    },
    [id],
  )

  return { show, showText }
}
