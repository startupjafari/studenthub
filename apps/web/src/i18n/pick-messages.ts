import type { AbstractIntlMessages } from 'next-intl'
import scopes from './message-scopes.json'

/** Область словаря корневого layout — то, что нужно оболочке и провайдерам на любой странице. */
export const ROOT_SCOPE = '/'

const SCOPES: Record<string, readonly string[] | undefined> = scopes

/**
 * Часть словаря для области `scope` (src/i18n/message-scopes.json, генерирует
 * `pnpm --filter web i18n:scopes`).
 *
 * Неизвестная область отдаёт словарь целиком: забытая перегенерация не должна оборачиваться
 * ключами вместо текста на экране. Её ловит тест message-scopes.test.ts, а здесь — страховка.
 */
export function pickMessages(messages: AbstractIntlMessages, scope: string): AbstractIntlMessages {
  const namespaces = SCOPES[scope]
  if (!namespaces) return messages
  const picked: AbstractIntlMessages = {}
  for (const ns of namespaces) {
    const value = messages[ns]
    if (value !== undefined) picked[ns] = value
  }
  return picked
}
