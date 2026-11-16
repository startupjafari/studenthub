import { useTranslations } from 'next-intl'
import { PageLoader } from '../../../../shared/ui/page-loader'

export default function Loading() {
  const t = useTranslations('Common')
  return <PageLoader label={t('loading')} />
}
