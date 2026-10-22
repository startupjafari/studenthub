import { useTranslations } from 'next-intl'
import type { BookConditionValue } from '@studenthub/shared-schemas'

/** Подписи состояния экземпляра — явными ключами (FRONTEND_RULES §10). */
export function useConditionLabels(): Record<BookConditionValue, string> {
  const t = useTranslations('LibraryCatalog')
  return {
    GOOD: t('conditionValue.GOOD'),
    WORN: t('conditionValue.WORN'),
    DAMAGED: t('conditionValue.DAMAGED'),
  }
}
