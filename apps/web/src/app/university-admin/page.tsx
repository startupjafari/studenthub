import { getTranslations } from 'next-intl/server'
import { StatsDashboard } from '../../widgets/stats-dashboard'
import { PageHeader } from '../../shared/ui'

export default async function Page() {
  const t = await getTranslations('Stats')
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} />
      <StatsDashboard />
    </div>
  )
}
