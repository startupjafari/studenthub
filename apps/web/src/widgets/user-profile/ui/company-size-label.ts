import { useTranslations } from 'next-intl'
import type { CompanySize } from '@studenthub/shared-schemas'

/** Подпись численности — явной картой, без сборки ключа из значения (FRONTEND_RULES §10). */
export function useCompanySizeLabel(): (size: CompanySize) => string {
  const t = useTranslations('Company')
  const labels: Record<CompanySize, string> = {
    '1_10': t('size1to10'),
    '11_50': t('size11to50'),
    '51_200': t('size51to200'),
    '201_1000': t('size201to1000'),
    '1000_PLUS': t('size1000plus'),
  }
  return (size) => labels[size]
}
