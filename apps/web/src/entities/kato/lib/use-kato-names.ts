'use client'

import { useQuery } from '@tanstack/react-query'
import { useLocale } from 'next-intl'
import { katoKeys, resolveKato } from '../api/kato-api'
import { katoName } from './kato-name'

// Код КАТО — ровно 9 цифр. Всё остальное в `University.city` — свободный текст
// (зарубежный вуз): такое значение показываем как есть и в резолв не отправляем,
// иначе бэкенд ответит 422 на весь запрос.
export const isKatoCode = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^\d{9}$/.test(value)

/**
 * Названия по кодам — одним запросом на весь список. Вызывать на уровне экрана
 * (таблица вузов), а не в строке: запрос на строку дал бы N+1.
 */
export function useKatoNames(codes: (string | null | undefined)[]) {
  const locale = useLocale()
  const wanted = [...new Set(codes.filter(isKatoCode))]

  const { data, isPending } = useQuery({
    queryKey: katoKeys.resolve(wanted),
    queryFn: () => resolveKato(wanted),
    enabled: wanted.length > 0,
    // Справочник меняется раз в несколько лет — перезапрашивать его незачем.
    staleTime: Infinity,
  })

  const byCode = new Map((data ?? []).map((u) => [u.code, katoName(u, locale)]))

  return {
    // Свободный текст возвращается как есть; неизвестный код — тоже, чтобы вместо
    // названия не появлялась пустота, если справочник ещё не загрузился.
    nameOf: (value: string | null | undefined): string | null =>
      value ? (byCode.get(value) ?? value) : null,
    isPending: wanted.length > 0 && isPending,
  }
}
