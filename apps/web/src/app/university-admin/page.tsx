import { getTranslations } from 'next-intl/server'
import { StatsDashboard } from '../../widgets/stats-dashboard'
import { SetupBanner } from '../../views/onboarding'
import { PageHeader, SeasonGreeting } from '../../shared/ui'

export default async function Page() {
  const t = await getTranslations('Stats')
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} />
      <SeasonGreeting />
      {/* Пока вуз не запущен, обзор начинается с приглашения вернуться в мастер:
          статистика пустого вуза ни о чём не говорит, а настройка — говорит. */}
      <SetupBanner />
      <StatsDashboard />
    </div>
  )
}
