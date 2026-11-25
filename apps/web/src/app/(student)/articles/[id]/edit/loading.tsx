import { useTranslations } from 'next-intl'
import { PageLoader } from '../../../../../shared/ui/page-loader'

// loading.tsx обязателен для каждого сегмента (§2.2).
export default function Loading() {
  const t = useTranslations('Common')
  return <PageLoader label={t('loading')} className="min-h-0 flex-1" />
}
