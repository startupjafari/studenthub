import { useTranslations } from 'next-intl'
import { PageLoader } from '../../../shared/ui'

// loading.tsx обязателен для сегмента (docs/FRONTEND_RULES.md §2.2).
export default function Loading() {
  const t = useTranslations('Common')
  return <PageLoader label={t('loading')} />
}
