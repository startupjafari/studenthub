import { useTranslations } from 'next-intl'
import { PageLoader } from '../shared/ui'

// Каждый route segment обязан иметь loading.tsx (docs/FRONTEND_RULES.md §2.2).
export default function Loading() {
  const t = useTranslations('Common')
  return <PageLoader label={t('loading')} className="min-h-screen" />
}
