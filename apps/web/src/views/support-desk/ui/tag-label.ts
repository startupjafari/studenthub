import type { useTranslations } from 'next-intl'
import type { SupportTag } from '@studenthub/shared-schemas'

// Подписи тегов — явной картой, а не собранным ключом: собранный ключ не видит ни
// компилятор, ни проверка словарей (FRONTEND_RULES §10).
export function tagLabels(t: ReturnType<typeof useTranslations>): Record<SupportTag, string> {
  return {
    ACCESS: t('tagAccess'),
    DATA: t('tagData'),
    DOCS: t('tagDocs'),
    BUG: t('tagBug'),
    FEATURE: t('tagFeature'),
    ABUSE: t('tagAbuse'),
    OTHER: t('tagOther'),
  }
}
