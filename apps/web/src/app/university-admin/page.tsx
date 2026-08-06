import { getTranslations } from 'next-intl/server'
import { StatsDashboard } from '../../widgets/stats-dashboard'

export default async function Page() {
  const t = await getTranslations('Stats')
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <StatsDashboard />
    </div>
  )
}
