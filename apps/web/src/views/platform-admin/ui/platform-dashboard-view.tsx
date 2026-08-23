import { getTranslations } from 'next-intl/server'
import { PageHeader } from '../../../shared/ui'
import { PlatformDashboard } from '../../../widgets/platform-dashboard'

// Дашборд платформенного администратора: показатели и графики.
// Плиток-ссылок на разделы здесь нет — они дублировали сайдбар.
export async function PlatformDashboardView() {
  const tNav = await getTranslations('Nav')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={tNav('dashboard')} />
      <PlatformDashboard />
    </div>
  )
}
