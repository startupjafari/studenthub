'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { toApiError } from '../../../shared/lib'

// Коды, у которых текст сервера говорит, ЧТО не так: «Сначала добавьте результат»,
// «Недопустимый переход», «Заявку уже обработал другой сотрудник».
const EXPLAINED_CODES = new Set(['BAD_REQUEST', 'CONFLICT'])

/**
 * Отказ действия с заявкой — тостом по коду ошибки (FRONTEND_RULES §5.4), как в мастере
 * подачи. Раньше любая ошибка рабочего окна и карточки заявки показывалась как «Не удалось
 * загрузить»: конфликт, нехватка результата и недопустимый переход выглядели одинаково.
 * У отказа по существу под заголовком — пояснение сервера.
 */
export function useActionError(): (error: unknown) => void {
  const tErr = useTranslations('Errors')
  return useCallback(
    (error: unknown) => {
      const { code, message } = toApiError(error)
      toast.error(
        tErr(code),
        EXPLAINED_CODES.has(code) && message ? { description: message } : undefined,
      )
    },
    [tErr],
  )
}
