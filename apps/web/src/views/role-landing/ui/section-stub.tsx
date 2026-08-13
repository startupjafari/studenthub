import { getTranslations } from 'next-intl/server'
import { Wrench } from 'lucide-react'
import { EmptyState } from '../../../shared/ui'

// Универсальная заглушка ещё не реализованного раздела (внутри ролевой оболочки).
export async function SectionStub() {
  const t = await getTranslations('Dashboard')
  return (
    <EmptyState
      icon={<Wrench className="size-6" aria-hidden />}
      title={t('inDevelopment')}
      description={t('sectionSoon')}
      className="min-h-[320px]"
    />
  )
}
