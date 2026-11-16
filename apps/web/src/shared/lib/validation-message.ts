'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import {
  VALIDATION_MESSAGE_PREFIX,
  VALIDATION_MESSAGE_VALUES,
  isValidationMessageKey,
} from '@studenthub/shared-schemas'

type Translate = ReturnType<typeof useTranslations>

/**
 * Текст сообщения валидации на языке интерфейса.
 *
 * Схемы из shared-schemas отдают ключ (`validation.password.tooShort`), а не текст — и в
 * форму через `zodResolver`, и в `details[].message` ответа `422 VALIDATION_ERROR`. Ключ
 * переводим словарём `Validation`. Всё остальное — готовый текст (свой `t()` формы,
 * стандартное сообщение zod, ответ старого сервера) или ключ, которого эта сборка не знает, —
 * показываем как есть: лучше сырой ключ, чем пустое место под полем.
 *
 * `t` — переводчик пространства `Validation`.
 */
export function translateValidationMessage(t: Translate, message: string): string {
  if (!isValidationMessageKey(message)) return message
  const path = message.slice(VALIDATION_MESSAGE_PREFIX.length)
  // `has` есть у настоящего переводчика next-intl; у заглушек в тестах его может не быть.
  if (typeof t.has === 'function' && !t.has(path)) return message
  return t(path, VALIDATION_MESSAGE_VALUES[message])
}

/** Хук над `translateValidationMessage`. Пустое значение (нет ошибки) остаётся пустым. */
export function useValidationMessage(): (message: string | null | undefined) => string | undefined {
  const t = useTranslations('Validation')
  return useCallback(
    (message) => (message ? translateValidationMessage(t, message) : undefined),
    [t],
  )
}
