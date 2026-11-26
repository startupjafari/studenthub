'use client'

import { useQuery } from '@tanstack/react-query'
import { edsConfigRequest } from '../../../shared/api'

// Фабрика ключей React Query (FRONTEND_RULES §5.5).
export const edsKeys = {
  config: () => ['eds', 'config'] as const,
}

/**
 * Включён ли вход по ЭЦП на сервере. Без NCANode его там выключают, и тогда кнопка ЭЦП не
 * показывается нигде: ни на входе, ни в настройках, ни в таблице пользователей. Пока ответа
 * нет или он с ошибкой — считаем выключенным: кнопка, которая ведёт в FEATURE_DISABLED,
 * хуже её отсутствия.
 */
export function useEdsEnabled(enabled = true): boolean {
  const { data } = useQuery({
    queryKey: edsKeys.config(),
    queryFn: edsConfigRequest,
    enabled,
    // Рычаг меняют деплоем, а не на лету: часто спрашивать незачем.
    staleTime: 5 * 60_000,
  })
  return data?.enabled === true
}
